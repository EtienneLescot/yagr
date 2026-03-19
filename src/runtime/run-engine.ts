import { randomUUID } from 'node:crypto';
import { generateText, streamText, type CoreMessage } from 'ai';
import type { Engine } from '../engine/engine.js';
import { createLanguageModel } from '../llm/create-language-model.js';
import { resolveModelContextProfile } from '../llm/create-language-model.js';
import type {
  YagrAgentState,
  YagrContextCompactionEvent,
  YagrRequiredAction,
  YagrRuntimeContext,
  YagrPhaseEvent,
  YagrRunJournalEntry,
  YagrRunOptions,
  YagrRunPhase,
  YagrRunResult,
  YagrRunStep,
  YagrStateEvent,
  YagrToolEvent,
} from '../types.js';
import { buildTools } from '../tools/index.js';
import { evaluateCompletionGate } from './completion-gate.js';
import { compactConversationContext } from './context-compaction.js';
import { analyzeRunOutcome, formatObservedAction, type RunOutcome } from './outcome.js';
import { createDefaultRuntimeHooks, wrapToolsWithRuntimeHooks } from './policy-hooks.js';
import { blockingStateForRequiredActions, collectRequiredActions } from './required-actions.js';

const INSPECT_MAX_STEPS = 4;
const EXECUTE_MAX_STEPS = 10;
const EXECUTE_RECOVERY_MAX_STEPS = 6;
const MAX_EXECUTION_ATTEMPTS = 3;
const PHASE_ORDER: YagrRunPhase[] = ['inspect', 'plan', 'edit', 'validate', 'sync', 'verify', 'summarize'];
const STREAM_FILTER_HOLDBACK = 256;

const INTERNAL_PROMPT_PATTERNS = [
  /Yagr internal phase:\s*(?:inspect|execute)\.\s*/g,
  /Yagr internal recovery pass \d+\.\s*/g,
  /Analyze the request and gather only the context needed to execute it correctly\.\s*/g,
  /Use tools to inspect the workspace, existing workflow files, workspace instructions, examples, and n8nac workspace status when needed\.\s*/g,
  /Favor correctness over speed in this phase\. If an example or rule is likely to determine the right implementation, read it before acting\.\s*/g,
  /Do not claim completion in this phase\.\s*/g,
  /Complete the task end-to-end using the gathered context\.\s*/g,
  /When appropriate, author or edit workflow files, validate them, sync them, verify them, and then summarize what changed\.\s*/g,
  /Ask the user only when a specific missing value blocks execution\.\s*/g,
  /Do not summarize yet\.\s*/g,
  /Inspect the failing tool output, correct the local files or command arguments, and retry the necessary steps now\.\s*/g,
  /Only stop if a genuine blocker remains that cannot be resolved locally in this run\.\s*/g,
  /Actions en echec:[^\n]*(?:\n|$)/g,
  /Etapes non confirmees:[^\n]*(?:\n|$)/g,
  /Original request:[^\n]*(?:\n|$)/g,
];

type AssistantStreamFilterState = {
  rawText: string;
  pendingRaw: string;
  visibleText: string;
  emittedVisibleChars: number;
};

class RepetitiveAssistantOutputError extends Error {
  constructor(
    message: string,
    readonly partialText: string,
  ) {
    super(message);
    this.name = 'RepetitiveAssistantOutputError';
  }
}

function isRepetitiveAssistantOutputError(error: unknown): error is RepetitiveAssistantOutputError {
  return error instanceof RepetitiveAssistantOutputError;
}

type ExecuteRunResult = {
  result: YagrRunResult;
  persistedMessages: CoreMessage[];
  workspaceInstructionsMayHaveChanged: boolean;
};

type RunState = {
  runId: string;
  journal: YagrRunJournalEntry[];
  compactions: YagrContextCompactionEvent[];
  currentPhase: YagrRunPhase | null;
  currentAgentState: YagrAgentState;
  stepNumber: number;
};

function createAbortError(message = 'Yagr run stopped by user.'): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === 'AbortError';
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }

  if (signal.reason instanceof Error) {
    throw signal.reason;
  }

  throw createAbortError(typeof signal.reason === 'string' && signal.reason ? signal.reason : undefined);
}

function createPhasePrompt(phase: 'inspect' | 'execute', userPrompt: string): string {
  if (phase === 'inspect') {
    return [
      'Yagr internal phase: inspect.',
      'Analyze the request and gather only the context needed to execute it correctly.',
      'Use tools to inspect the workspace, existing workflow files, examples, and n8nac workspace status when needed.',
      'Do not reread the workspace AGENT.md or AGENTS.md file during inspect unless a specific later detail is missing from the current context.',
      'Favor correctness over speed in this phase. If an example or rule is likely to determine the right implementation, read it before acting.',
      'Do not claim completion in this phase.',
      `Original request: ${userPrompt}`,
    ].join('\n');
  }

  return [
    'Yagr internal phase: execute.',
    'Complete the task end-to-end using the gathered context.',
    'When appropriate, author or edit workflow files, validate them, sync them, verify them, and then summarize what changed.',
    'Ask the user only when a specific missing value blocks execution.',
    `Original request: ${userPrompt}`,
  ].join('\n');
}

function trimAssistantVisibleText(text: string, maxChars = 12_000): string {
  return text.length <= maxChars ? text : text.slice(-maxChars);
}

function hasRepeatedSuffix(text: string, minimumBlockSize = 180, maximumBlockSize = 4_000): boolean {
  const maxCandidateSize = Math.min(Math.floor(text.length / 2), maximumBlockSize);
  if (maxCandidateSize < minimumBlockSize) {
    return false;
  }

  for (let blockSize = maxCandidateSize; blockSize >= minimumBlockSize; blockSize -= 20) {
    const suffix = text.slice(-blockSize);
    const previous = text.slice(-(blockSize * 2), -blockSize);
    if (suffix === previous) {
      return true;
    }
  }

  return false;
}

function stripInternalPromptScaffolding(text: string): string {
  let next = text;

  for (const pattern of INTERNAL_PROMPT_PATTERNS) {
    next = next.replace(pattern, '');
  }

  return next;
}

export function sanitizeAssistantOutput(text: string): string {
  return stripInternalPromptScaffolding(text)
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .join('\n')
    .trim();
}

export function sanitizeAssistantMessageContent(content: CoreMessage['content']): CoreMessage['content'] {
  if (typeof content === 'string') {
    return sanitizeAssistantOutput(content);
  }

  if (!Array.isArray(content)) {
    return content;
  }

  const sanitizedParts = content.flatMap((part) => {
    if (!part || typeof part !== 'object') {
      return [];
    }

    if ('type' in part && part.type === 'text' && 'text' in part && typeof part.text === 'string') {
      const text = sanitizeAssistantOutput(part.text);
      return text ? [{ ...part, text }] : [];
    }

    return [part];
  });

  return sanitizedParts as CoreMessage['content'];
}

export function sanitizeAssistantResponseMessages(messages: readonly CoreMessage[]): CoreMessage[] {
  const sanitizedMessages: CoreMessage[] = [];

  for (const message of messages) {
    if (message.role !== 'assistant') {
      sanitizedMessages.push(message);
      continue;
    }

    const content = sanitizeAssistantMessageContent(message.content);

    if (typeof content === 'string' && !content) {
      continue;
    }

    if (Array.isArray(content) && content.length === 0) {
      continue;
    }

    sanitizedMessages.push({ ...message, content } as CoreMessage);
  }

  return sanitizedMessages;
}

export function shouldAbortForInternalPromptLeak(rawText: string, visibleText = ''): boolean {
  const internalMarkerCount = (rawText.match(/Yagr internal (?:phase|recovery pass)/g) ?? []).length;
  if (internalMarkerCount < 2) {
    return false;
  }

  return sanitizeAssistantOutput(visibleText).length === 0;
}

export function shouldAbortForRepetitiveAssistantOutput(visibleText: string): boolean {
  const normalized = visibleText.trim();
  if (normalized.length < 240) {
    return false;
  }

  if (hasRepeatedSuffix(normalized)) {
    return true;
  }

  const repeatedWorkflowBundle = [
    'Final workflow content:',
    'Final workflow status:',
    'Final workflow URL:',
  ].every((marker) => normalized.indexOf(marker) !== -1 && normalized.indexOf(marker) !== normalized.lastIndexOf(marker));

  return repeatedWorkflowBundle;
}

function appendVisibleAssistantText(state: AssistantStreamFilterState, text: string): void {
  if (!text) {
    return;
  }

  state.visibleText = trimAssistantVisibleText(`${state.visibleText}${text}`);

  if (shouldAbortForRepetitiveAssistantOutput(state.visibleText)) {
    throw new RepetitiveAssistantOutputError(
      'Run stopped after repeated final response output. The model kept repeating the same completion block instead of finishing.',
      sanitizeAssistantOutput(state.visibleText),
    );
  }
}

function createAssistantStreamFilterState(): AssistantStreamFilterState {
  return {
    rawText: '',
    pendingRaw: '',
    visibleText: '',
    emittedVisibleChars: 0,
  };
}

function consumeAssistantTextDelta(state: AssistantStreamFilterState, delta: string): string {
  state.rawText += delta;
  state.pendingRaw += delta;

  if (shouldAbortForInternalPromptLeak(state.rawText)) {
    throw new Error('Run stopped after repeated internal prompt leakage. The model kept echoing Yagr internal instructions instead of progressing.');
  }

  if (state.pendingRaw.length <= STREAM_FILTER_HOLDBACK) {
    return '';
  }

  const processable = state.pendingRaw.slice(0, -STREAM_FILTER_HOLDBACK);
  state.pendingRaw = state.pendingRaw.slice(-STREAM_FILTER_HOLDBACK);

  const safeText = stripInternalPromptScaffolding(processable);
  appendVisibleAssistantText(state, safeText);
  state.emittedVisibleChars += safeText.length;
  return safeText;
}

function flushAssistantTextDelta(state: AssistantStreamFilterState): string {
  const safeText = sanitizeAssistantOutput(state.pendingRaw);
  state.pendingRaw = '';
  appendVisibleAssistantText(state, safeText);
  state.emittedVisibleChars += safeText.length;
  return safeText;
}

function buildJournalEntry(entry: Omit<YagrRunJournalEntry, 'timestamp'>): YagrRunJournalEntry {
  return {
    timestamp: new Date().toISOString(),
    ...entry,
  };
}

function inferPhaseFromStep(step: {
  stepType: string;
  toolCalls: Array<{ toolName: string; args: unknown }>;
  toolResults: Array<{ toolName: string; result: unknown }>;
}): YagrRunPhase {
  const n8nacActions = step.toolCalls
    .filter((toolCall) => toolCall.toolName === 'n8nac')
    .map((toolCall) => {
      if (!toolCall.args || typeof toolCall.args !== 'object') {
        return undefined;
      }

      const action = (toolCall.args as { action?: unknown }).action;
      return typeof action === 'string' ? action : undefined;
    })
    .filter((action): action is string => Boolean(action));

  if (n8nacActions.some((action) => action === 'verify')) {
    return 'verify';
  }

  if (n8nacActions.some((action) => action === 'push' || action === 'resolve')) {
    return 'sync';
  }

  if (n8nacActions.some((action) => action === 'validate')) {
    return 'validate';
  }

  if (n8nacActions.some((action) => action === 'setup_check' || action === 'init_auth' || action === 'init_project' || action === 'list' || action === 'pull' || action === 'skills' || action === 'update_ai')) {
    return 'plan';
  }

  if (step.toolCalls.some((toolCall) => toolCall.toolName === 'writeWorkspaceFile' || toolCall.toolName === 'replaceInWorkspaceFile')) {
    return 'edit';
  }

  if (step.toolCalls.some((toolCall) => toolCall.toolName === 'readWorkspaceFile' || toolCall.toolName === 'searchWorkspace' || toolCall.toolName === 'listDirectory')) {
    return 'inspect';
  }

  if (step.stepType === 'initial') {
    return 'plan';
  }

  if (step.toolResults.length === 0 && step.toolCalls.length === 0) {
    return 'summarize';
  }

  return 'plan';
}

function getPhaseIndex(phase: YagrRunPhase | null): number {
  if (!phase) {
    return -1;
  }

  return PHASE_ORDER.indexOf(phase);
}

function chooseNextPhase(currentPhase: YagrRunPhase | null, inferredPhase: YagrRunPhase): YagrRunPhase {
  if (!currentPhase) {
    return inferredPhase;
  }

  return getPhaseIndex(inferredPhase) >= getPhaseIndex(currentPhase) ? inferredPhase : currentPhase;
}

function collectToolNames(journal: YagrRunJournalEntry[]): Array<{ toolName: string }> {
  const names = new Set<string>();

  for (const entry of journal) {
    if (entry.type !== 'step' || !entry.step) {
      continue;
    }

    for (const toolCall of entry.step.toolCalls) {
      names.add(toolCall.toolName);
    }
  }

  return [...names].map((toolName) => ({ toolName }));
}

function buildGroundedSummary(
  _prompt: string,
  finishReason: string,
  journal: YagrRunJournalEntry[],
  requiredActions: YagrRequiredAction[],
): string {
  const lines: string[] = [];
  const outcome = analyzeRunOutcome(journal);

  if (outcome.writtenFiles.length > 0) {
    lines.push(`Fichiers crees ou reecrits: ${outcome.writtenFiles.join(', ')}`);
  }

  if (outcome.updatedFiles.length > 0) {
    lines.push(`Fichiers modifies: ${outcome.updatedFiles.join(', ')}`);
  }

  if (outcome.successfulActions.length > 0) {
    lines.push(`Actions n8nac reussies: ${outcome.successfulActions.map(formatObservedAction).join(', ')}`);
  }

  if (outcome.unresolvedFailedActions.length > 0) {
    lines.push(`Actions n8nac en echec: ${outcome.unresolvedFailedActions.map(formatObservedAction).join(', ')}`);
  }

  if (requiredActions.length > 0) {
    lines.push(`Actions requises en attente: ${requiredActions.map((action) => `${action.title} [${action.kind}]`).join(', ')}`);
  }

  if (outcome.hasWorkflowWrites && !outcome.successfulValidate) {
    lines.push('La validation du workflow n’a pas ete confirmee.');
  }

  if (outcome.hasWorkflowWrites && !outcome.successfulPush) {
    lines.push('Le push vers n8n n’a pas ete confirme.');
  }

  if (outcome.hasWorkflowWrites && !outcome.successfulVerify) {
    lines.push('La verification distante n’a pas ete confirmee.');
  }

  if (outcome.hasWorkflowWrites && outcome.unresolvedFailedActions.length > 0) {
    lines.push('Le run s’est arrete alors que certaines actions avaient encore echoue. Une correction supplementaire reste necessaire ou un bloqueur externe persiste.');
  }

  if (finishReason !== 'stop') {
    lines.push(`Le run s’est termine avec la raison: ${finishReason}.`);
  }

  return lines.join('\n');
}

async function ensureFinalText(
  _options: YagrRunOptions,
  prompt: string,
  finishReason: string,
  journal: YagrRunJournalEntry[],
  existingText: string,
  requiredActions: YagrRequiredAction[],
  completionAccepted: boolean,
): Promise<string> {
  const groundedSummary = buildGroundedSummary(prompt, finishReason, journal, requiredActions);
  const sanitizedText = sanitizeAssistantOutput(existingText);

  if (!completionAccepted) {
    return groundedSummary;
  }

  if (!sanitizedText) {
    return groundedSummary;
  }

  return sanitizedText;
}

function buildRuntimeContext(state: RunState): YagrRuntimeContext {
  return {
    runId: state.runId,
    phase: state.currentPhase ?? undefined,
    state: state.currentAgentState,
  };
}

async function emitJournal(state: RunState, options: YagrRunOptions, entry: Omit<YagrRunJournalEntry, 'timestamp'>): Promise<void> {
  const journalEntry = buildJournalEntry(entry);
  state.journal.push(journalEntry);
  await options.onJournalEntry?.(journalEntry);
}

async function maybeCompactMessages(
  state: RunState,
  options: YagrRunOptions,
  systemPrompt: string,
  prompt: string,
  messages: CoreMessage[],
): Promise<CoreMessage[]> {
  throwIfAborted(options.abortSignal);

  if (options.autoCompactContext === false) {
    return messages;
  }

  const modelProfile = resolveModelContextProfile(options);
  const compaction = await compactConversationContext({
    messages,
    prompt,
    journal: state.journal,
    systemPrompt,
    abortSignal: options.abortSignal,
    budget: {
      contextWindowTokens: options.contextWindowTokens ?? modelProfile.contextWindowTokens,
      reservedOutputTokens: options.reservedOutputTokens ?? modelProfile.reservedOutputTokens,
      thresholdPercent: options.compactContextThresholdPercent,
      preserveRecentMessages: options.compactPreserveRecentMessages,
      charsPerToken: options.charsPerToken,
    },
    llmConfig: options,
  });

  if (!compaction.event) {
    return messages;
  }

  await transitionAgentState(state, options, 'compacting', 'Compacting runtime context before the next model call.');

  state.compactions.push(compaction.event);
  await emitJournal(state, options, {
    type: 'compaction',
    status: 'completed',
    phase: state.currentPhase ?? undefined,
    message: `Context compacted: ${compaction.event.messagesCompacted} messages folded into a checkpoint summary.`,
    compaction: compaction.event,
  });
  await options.onCompaction?.(compaction.event);
  await transitionAgentState(state, options, 'running', 'Context compaction completed.');

  return compaction.messages;
}

async function transitionAgentState(
  state: RunState,
  options: YagrRunOptions,
  nextState: YagrAgentState,
  message: string,
): Promise<void> {
  if (state.currentAgentState === nextState) {
    return;
  }

  state.currentAgentState = nextState;

  const event: YagrStateEvent = {
    state: nextState,
    phase: state.currentPhase ?? undefined,
    message,
  };

  await emitJournal(state, options, {
    type: 'state',
    status: nextState === 'failed_terminal' ? 'failed' : 'completed',
    phase: state.currentPhase ?? undefined,
    state: nextState,
    message,
  });
  await options.onStateChange?.(event);
}

function withRuntimeToolEvents(state: RunState, options: YagrRunOptions) {
  return async (event: YagrToolEvent): Promise<void> => {
    if (event.type === 'command-start') {
      await transitionAgentState(state, options, 'streaming', `Streaming command output for ${event.toolName}.`);
    } else if (event.type === 'command-end') {
      await transitionAgentState(state, options, 'running', `Command finished for ${event.toolName}.`);
    }

    await options.onToolEvent?.(event);
  };
}

function shouldAttemptRecovery(outcome: RunOutcome, attemptNumber: number, requiredActions: YagrRequiredAction[]): boolean {
  if (attemptNumber >= MAX_EXECUTION_ATTEMPTS) {
    return false;
  }

  if (requiredActions.length > 0) {
    return false;
  }

  if (outcome.unresolvedFailedActions.length > 0) {
    return true;
  }

  if (outcome.hasWorkflowWrites && (!outcome.successfulValidate || !outcome.successfulPush)) {
    return true;
  }

  return false;
}

function buildRecoveryPrompt(outcome: RunOutcome, attemptNumber: number): string {
  const failedActions = outcome.failedActions.map(formatObservedAction).join(', ');
  const missingChecks: string[] = [];

  if (outcome.hasWorkflowWrites && !outcome.successfulValidate) {
    missingChecks.push('validation');
  }

  if (outcome.hasWorkflowWrites && !outcome.successfulPush) {
    missingChecks.push('push');
  }

  if (outcome.hasWorkflowWrites && !outcome.successfulVerify) {
    missingChecks.push('verification distante');
  }

  const issues = [
    failedActions ? `Actions en echec: ${failedActions}.` : '',
    missingChecks.length > 0 ? `Etapes non confirmees: ${missingChecks.join(', ')}.` : '',
  ].filter(Boolean).join(' ');

  return [
    `Yagr internal recovery pass ${attemptNumber}.`,
    issues,
    'Do not summarize yet.',
    'Inspect the failing tool output, correct the local files or command arguments, and retry the necessary steps now.',
    'Only stop if a genuine blocker remains that cannot be resolved locally in this run.',
  ].join(' ');
}

async function executePhase(
  state: RunState,
  options: YagrRunOptions,
  systemPrompt: string,
  tools: ReturnType<typeof buildTools>,
  messages: CoreMessage[],
  maxSteps: number,
): Promise<{
  text: string;
  finishReason: string;
  steps: number;
  toolCalls: Array<{ toolName: string }>;
  responseMessages: CoreMessage[];
}> {
  throwIfAborted(options.abortSignal);

  let recordedSteps = 0;
  const recordedToolNames = new Set<string>();

  const result = streamText({
    abortSignal: options.abortSignal,
    model: createLanguageModel(options),
    system: systemPrompt,
    tools,
    messages,
    maxSteps,
    toolCallStreaming: true,
    onStepFinish: async (stepResult) => {
      recordedSteps += 1;
      for (const toolCall of stepResult.toolCalls) {
        recordedToolNames.add(toolCall.toolName);
      }

      await recordStep(state, options, {
        stepType: stepResult.stepType,
        finishReason: String(stepResult.finishReason),
        toolCalls: stepResult.toolCalls.map((toolCall) => ({
          toolName: toolCall.toolName,
          args: toolCall.args,
        })),
        toolResults: stepResult.toolResults.map((toolResult) => ({
          toolName: toolResult.toolName,
          result: toolResult.result,
        })),
        text: stepResult.text,
      });
    },
  });

  const streamState = createAssistantStreamFilterState();
  try {
    for await (const textDelta of result.textStream) {
      throwIfAborted(options.abortSignal);
      consumeAssistantTextDelta(streamState, textDelta);
    }
  } catch (error) {
    if (!isRepetitiveAssistantOutputError(error)) {
      throw error;
    }

    return {
      text: error.partialText,
      finishReason: 'stop',
      steps: recordedSteps,
      toolCalls: [...recordedToolNames].map((toolName) => ({ toolName })),
      responseMessages: [],
    };
  }

  flushAssistantTextDelta(streamState);

  const response = await result.response;
  const resolved = await Promise.all([
    result.text,
    result.finishReason,
    result.steps,
    result.toolCalls,
  ]);

  const finalText = sanitizeAssistantOutput(resolved[0]);
  if (finalText) {
    await options.onTextDelta?.(finalText);
  }

  return {
    text: finalText,
    finishReason: String(resolved[1]),
    steps: resolved[2].length,
    toolCalls: resolved[3].map((toolCall) => ({ toolName: toolCall.toolName })),
    responseMessages: response.messages,
  };
}

async function transitionPhase(state: RunState, options: YagrRunOptions, phase: YagrRunPhase, status: YagrPhaseEvent['status'], message: string): Promise<void> {
  if (status === 'started') {
    state.currentPhase = phase;
  }

  const event: YagrPhaseEvent = {
    phase,
    status,
    message,
  };

  await emitJournal(state, options, {
    type: 'phase',
    phase,
    status,
    message,
  });
  await options.onPhaseChange?.(event);
}

async function recordStep(
  state: RunState,
  options: YagrRunOptions,
  step: {
    stepType: string;
    finishReason: string;
    toolCalls: Array<{ toolName: string; args: unknown }>;
    toolResults: Array<{ toolName: string; result: unknown }>;
    text: string;
  },
): Promise<YagrRunStep> {
  state.stepNumber += 1;
  const phase = chooseNextPhase(state.currentPhase, inferPhaseFromStep(step));

  if (state.currentPhase !== phase) {
    if (state.currentPhase) {
      await transitionPhase(state, options, state.currentPhase, 'completed', `${state.currentPhase} phase completed.`);
    }
    await transitionPhase(state, options, phase, 'started', `${phase} phase started.`);
  }

  const trace: YagrRunStep = {
    stepNumber: state.stepNumber,
    stepType: step.stepType,
    finishReason: step.finishReason,
    toolCalls: step.toolCalls,
    toolResults: step.toolResults,
    text: step.text,
    phase,
  };

  await emitJournal(state, options, {
    type: 'step',
    phase,
    stepNumber: trace.stepNumber,
    status: 'completed',
    message: `Step ${trace.stepNumber} completed in ${phase}.`,
    step: trace,
  });
  await options.onStepFinish?.(trace);

  return trace;
}

export class YagrRunEngine {
  constructor(
    private readonly engine: Engine,
    private readonly history: readonly CoreMessage[],
    private readonly systemPrompt: string,
  ) {}

  async execute(prompt: string, options: YagrRunOptions = {}): Promise<ExecuteRunResult> {
    const state: RunState = {
      runId: randomUUID(),
      journal: [],
      compactions: [],
      currentPhase: null,
      currentAgentState: 'idle',
      stepNumber: 0,
    };

    const currentUserMessage: CoreMessage = {
      role: 'user',
      content: prompt,
    };
    const runtimeHooks = [...createDefaultRuntimeHooks(), ...(options.runtimeHooks ?? [])];
    const baseTools = buildTools(this.engine, {
      onToolEvent: withRuntimeToolEvents(state, options),
    });
    const tools = wrapToolsWithRuntimeHooks(baseTools as any, runtimeHooks, () => ({
      runId: state.runId,
      phase: state.currentPhase,
      state: state.currentAgentState,
    }), options.satisfiedRequiredActionIds) as typeof baseTools;
    const persistedMessages: CoreMessage[] = [currentUserMessage];
    let executionContext: CoreMessage[] = [...this.history, currentUserMessage];

    await emitJournal(state, options, {
      type: 'run',
      status: 'started',
      message: 'Yagr run started.',
      runId: state.runId,
    });
    await transitionAgentState(state, options, 'running', 'Task execution started.');

    try {
      throwIfAborted(options.abortSignal);
      await transitionPhase(state, options, 'inspect', 'started', 'Inspecting workspace and task context.');

      executionContext = await maybeCompactMessages(state, options, this.systemPrompt, prompt, executionContext);

      const inspectInstruction: CoreMessage = {
        role: 'user',
        content: createPhasePrompt('inspect', prompt),
      };
      const inspectResult = await generateText({
        abortSignal: options.abortSignal,
        model: createLanguageModel(options),
        system: this.systemPrompt,
        tools,
        messages: [...executionContext, inspectInstruction],
        maxSteps: Math.min(options.maxSteps ?? 8, INSPECT_MAX_STEPS),
      });

      for (const step of inspectResult.steps) {
        await recordStep(state, options, {
          stepType: step.stepType,
          finishReason: String(step.finishReason),
          toolCalls: step.toolCalls.map((toolCall: { toolName: string; args: unknown }) => ({
            toolName: toolCall.toolName,
            args: toolCall.args,
          })),
          toolResults: step.toolResults.map((toolResult: { toolName: string; result: unknown }) => ({
            toolName: toolResult.toolName,
            result: toolResult.result,
          })),
          text: step.text,
        });
      }

      if (state.currentPhase === 'inspect') {
        await transitionPhase(state, options, 'inspect', 'completed', 'Inspection completed.');
      }

      executionContext.push(...sanitizeAssistantResponseMessages(inspectResult.response.messages));
      throwIfAborted(options.abortSignal);

      await transitionPhase(state, options, 'plan', 'started', 'Preparing execution plan.');
      await transitionPhase(state, options, 'plan', 'completed', 'Execution plan ready.');

      const executeInstruction: CoreMessage = {
        role: 'user',
        content: createPhasePrompt('execute', prompt),
      };
      let executeMessages = [...executionContext, executeInstruction];

      let text = '';
      let finishReason = 'stop';
      let steps = 0;
      let toolCalls: Array<{ toolName: string }> = [];
      let responseMessages: CoreMessage[] = [];

      for (let attemptNumber = 1; attemptNumber <= MAX_EXECUTION_ATTEMPTS; attemptNumber += 1) {
        throwIfAborted(options.abortSignal);
        executeMessages = await maybeCompactMessages(state, options, this.systemPrompt, prompt, executeMessages);

        const phaseResult = await executePhase(
          state,
          options,
          this.systemPrompt,
          tools,
          executeMessages,
          attemptNumber === 1 ? (options.maxSteps ?? EXECUTE_MAX_STEPS) : Math.min(options.maxSteps ?? EXECUTE_MAX_STEPS, EXECUTE_RECOVERY_MAX_STEPS),
        );

        text = phaseResult.text;
        finishReason = phaseResult.finishReason;
        steps += phaseResult.steps;
        toolCalls = phaseResult.toolCalls;
        responseMessages = [...responseMessages, ...sanitizeAssistantResponseMessages(phaseResult.responseMessages)];

        const outcome = analyzeRunOutcome(state.journal);
        const requiredActions = collectRequiredActions(state.journal);
        if (!shouldAttemptRecovery(outcome, attemptNumber, requiredActions)) {
          break;
        }

        throwIfAborted(options.abortSignal);

        await emitJournal(state, options, {
          type: 'phase',
          phase: state.currentPhase ?? 'plan',
          status: 'started',
          message: `Recovery pass ${attemptNumber + 1} triggered after failed or incomplete execution steps.`,
        });

        executeMessages = [
          ...executeMessages,
          ...sanitizeAssistantResponseMessages(phaseResult.responseMessages),
          {
            role: 'user',
            content: buildRecoveryPrompt(outcome, attemptNumber + 1),
          },
        ];
      }

      persistedMessages.push(...responseMessages);
      steps += inspectResult.steps.length;
      throwIfAborted(options.abortSignal);
      const requiredActions = collectRequiredActions(state.journal);
      const completionDecision = await evaluateCompletionGate({
        text,
        finishReason,
        requiredActions,
        satisfiedRequiredActionIds: options.satisfiedRequiredActionIds,
        hasWorkflowWrites: analyzeRunOutcome(state.journal).hasWorkflowWrites,
        successfulValidate: Boolean(analyzeRunOutcome(state.journal).successfulValidate),
        successfulPush: Boolean(analyzeRunOutcome(state.journal).successfulPush),
        unresolvedFailureCount: analyzeRunOutcome(state.journal).unresolvedFailedActions.length,
        hooks: runtimeHooks,
        context: buildRuntimeContext(state),
      });

      for (const requiredAction of completionDecision.requiredActions) {
        await emitJournal(state, options, {
          type: 'state',
          status: 'completed',
          phase: state.currentPhase ?? undefined,
          state: blockingStateForRequiredActions([requiredAction]) ?? undefined,
          message: requiredAction.message,
          requiredAction,
        });
      }

      throwIfAborted(options.abortSignal);
      text = await ensureFinalText(options, prompt, finishReason, state.journal, text, completionDecision.requiredActions, completionDecision.accepted);

      if (state.currentPhase && state.currentPhase !== 'summarize') {
        await transitionPhase(state, options, state.currentPhase, 'completed', `${state.currentPhase} phase completed.`);
      }

      await transitionPhase(state, options, 'summarize', 'started', 'Summarizing run outcome.');
      await transitionPhase(state, options, 'summarize', 'completed', 'Run summary ready.');

      if (completionDecision.accepted) {
        await transitionAgentState(state, options, 'completed', 'Task execution completed.');
      } else {
        await transitionAgentState(state, options, completionDecision.state, completionDecision.reasons[0] ?? 'Task requires further action before completion.');
      }

      await emitJournal(state, options, {
        type: 'run',
        status: 'completed',
        phase: 'summarize',
        message: 'Yagr run completed.',
        runId: state.runId,
      });

      return {
        result: {
          runId: state.runId,
          text,
          finishReason,
          steps,
          toolCalls: collectToolNames(state.journal).length > 0 ? collectToolNames(state.journal) : toolCalls,
          completionAccepted: completionDecision.accepted,
          requiredActions: completionDecision.requiredActions,
          compactions: state.compactions,
          finalState: state.currentAgentState,
          finalPhase: 'summarize',
          journal: state.journal,
        },
        persistedMessages,
        workspaceInstructionsMayHaveChanged: hasSuccessfulWorkspaceInstructionsRefresh(state.journal),
      };
    } catch (error) {
      if (isAbortError(error)) {
        const abortMessage = error.message || 'Yagr run stopped by user.';
        await transitionAgentState(state, options, 'stopped', abortMessage);
        await emitJournal(state, options, {
          type: 'run',
          status: 'completed',
          phase: state.currentPhase ?? undefined,
          message: abortMessage,
          runId: state.runId,
        });
        throw error;
      }

      await transitionAgentState(state, options, 'failed_terminal', 'Task execution failed with a terminal blocker.');
      await emitJournal(state, options, {
        type: 'run',
        status: 'failed',
        phase: state.currentPhase ?? undefined,
        message: error instanceof Error ? error.message : String(error),
        runId: state.runId,
      });
      throw error;
    }
  }
}

function hasSuccessfulWorkspaceInstructionsRefresh(journal: readonly YagrRunJournalEntry[]): boolean {
  return journal.some((entry) => {
    if (entry.type !== 'step' || !entry.step) {
      return false;
    }

    const n8nacActions = entry.step.toolCalls
      .filter((toolCall) => toolCall.toolName === 'n8nac' && toolCall.args && typeof toolCall.args === 'object')
      .map((toolCall) => {
        const action = (toolCall.args as { action?: unknown }).action;
        return typeof action === 'string' ? action : undefined;
      })
      .filter((action): action is string => Boolean(action));

    if (n8nacActions.includes('init_project')) {
      return entry.step.toolResults.some((toolResult) => (
        toolResult.toolName === 'n8nac'
        && toolResult.result
        && typeof toolResult.result === 'object'
        && (toolResult.result as { aiContextRefreshed?: unknown }).aiContextRefreshed === true
      ));
    }

    if (n8nacActions.includes('update_ai')) {
      return entry.step.toolResults.some((toolResult) => (
        toolResult.toolName === 'n8nac'
        && toolResult.result
        && typeof toolResult.result === 'object'
        && (toolResult.result as { exitCode?: unknown }).exitCode === 0
      ));
    }

    return false;
  });
}