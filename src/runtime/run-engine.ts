import { randomUUID } from 'node:crypto';
import { generateText, streamText, type CoreMessage } from 'ai';
import type { EngineRuntimePort } from '../engine/engine.js';
import { createLanguageModel } from '../llm/create-language-model.js';
import { resolveLanguageModelConfig, resolveModelContextProfile } from '../llm/create-language-model.js';
import { getProviderPlugin } from '../llm/provider-plugin.js';
import type { YagrModelProvider } from '../llm/provider-registry.js';
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
import { resolveWorkflowOpenLink } from '../gateway/workflow-links.js';
import { resolveWorkflowDiagramFromFilePath } from '../tools/present-workflow-result.js';
import { evaluateCompletionGate } from './completion-gate.js';
import { compactConversationContext } from './context-compaction.js';
import { analyzeRunOutcome, formatObservedAction, type RunOutcome } from './outcome.js';
import { createDefaultRuntimeHooksForStrategy, wrapToolsWithRuntimeHooks } from './policy-hooks.js';
import { blockingStateForRequiredActions, collectRequiredActions } from './required-actions.js';
import { resolveToolRuntimeStrategy, type YagrToolRuntimeStrategy } from './tool-runtime-strategy.js';

const MAX_EXECUTION_ATTEMPTS = 3;
const PHASE_ORDER: YagrRunPhase[] = ['inspect', 'plan', 'edit', 'validate', 'sync', 'verify', 'summarize'];
const STREAM_FILTER_HOLDBACK = 256;

/**
 * Structural delimiters injected around every internal prompt (phase instructions,
 * recovery prompts). The stream filter strips everything between an open and a close
 * tag — one single regex, no coupling to the prompt wording.
 */
export const INTERNAL_TAG_OPEN = '\u200B\u27E8yagr:internal\u27E9\u200B';
export const INTERNAL_TAG_CLOSE = '\u200B\u27E8/yagr:internal\u27E9\u200B';

const INTERNAL_TAG_REGEX = new RegExp(
  `${INTERNAL_TAG_OPEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${INTERNAL_TAG_CLOSE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
  'g',
);

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

type SyntheticN8nacIntent = {
  tool?: string;
  action: string;
  filename?: string;
  validateFile?: string;
  workflowId?: string;
  listScope?: string;
  n8nHost?: string;
  n8nApiKey?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  projectIndex?: number | null;
  skillsArgs?: string | null;
  skillsArgv?: string[] | null;
  syncFolder?: string | null;
  resolveMode?: string | null;
};

type SyntheticWriteWorkspaceFileIntent = {
  tool: 'writeWorkspaceFile';
  path: string;
  content: string;
  mode?: 'create' | 'overwrite' | 'append';
};

type SyntheticToolIntent = SyntheticN8nacIntent | SyntheticWriteWorkspaceFileIntent;

function isSyntheticWriteWorkspaceFileIntent(intent: SyntheticToolIntent): intent is SyntheticWriteWorkspaceFileIntent {
  return intent.tool === 'writeWorkspaceFile';
}

function isSyntheticN8nacIntent(intent: SyntheticToolIntent): intent is SyntheticN8nacIntent {
  return intent.tool !== 'writeWorkspaceFile';
}

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

function wrapInternal(text: string): string {
  return `${INTERNAL_TAG_OPEN}${text}${INTERNAL_TAG_CLOSE}`;
}

function looksLikeRawToolIntentText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) {
    return false;
  }

  const blocks = extractJsonObjectBlocks(trimmed);
  if (blocks.length === 0) {
    return false;
  }

  return blocks.join('') === trimmed && blocks.every((block) => {
    try {
      const parsed = JSON.parse(block) as Record<string, unknown>;
      return typeof parsed.action === 'string' || parsed.tool === 'writeWorkspaceFile';
    } catch {
      return false;
    }
  });
}

function extractJsonObjectBlocks(text: string): string[] {
  const blocks: string[] = [];
  let depth = 0;
  let inString = false;
  let escaping = false;
  let start = -1;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (escaping) {
      escaping = false;
      continue;
    }

    if (character === '\\') {
      escaping = true;
      continue;
    }

    if (character === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (character === '{') {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }

    if (character === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        blocks.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return blocks;
}

function parseSyntheticToolIntents(text: string): SyntheticToolIntent[] {
  const intents: SyntheticToolIntent[] = [];
  for (const block of extractJsonObjectBlocks(text)) {
    try {
      const parsed = JSON.parse(block) as Record<string, unknown>;
      if (parsed.tool === 'writeWorkspaceFile') {
        if (typeof parsed.path !== 'string' || typeof parsed.content !== 'string') {
          continue;
        }
        intents.push({
          tool: 'writeWorkspaceFile',
          path: parsed.path,
          content: parsed.content,
          mode: parsed.mode === 'create' || parsed.mode === 'append' ? parsed.mode : 'overwrite',
        });
        continue;
      }

      if (typeof parsed.action !== 'string') {
        continue;
      }
      intents.push({
        tool: typeof parsed.tool === 'string' ? parsed.tool : 'n8nac',
        action: parsed.action,
        filename: typeof parsed.filename === 'string' ? parsed.filename : undefined,
        validateFile: typeof parsed.validateFile === 'string' ? parsed.validateFile : undefined,
        workflowId: typeof parsed.workflowId === 'string' ? parsed.workflowId : undefined,
        listScope: typeof parsed.listScope === 'string' ? parsed.listScope : undefined,
        n8nHost: typeof parsed.n8nHost === 'string' ? parsed.n8nHost : undefined,
        n8nApiKey: typeof parsed.n8nApiKey === 'string' || parsed.n8nApiKey === null ? parsed.n8nApiKey as string | null : undefined,
        projectId: typeof parsed.projectId === 'string' || parsed.projectId === null ? parsed.projectId as string | null : undefined,
        projectName: typeof parsed.projectName === 'string' || parsed.projectName === null ? parsed.projectName as string | null : undefined,
        projectIndex: typeof parsed.projectIndex === 'number' ? parsed.projectIndex : undefined,
        skillsArgs: typeof parsed.skillsArgs === 'string' || parsed.skillsArgs === null ? parsed.skillsArgs as string | null : undefined,
        skillsArgv: Array.isArray(parsed.skillsArgv) ? parsed.skillsArgv.filter((value): value is string => typeof value === 'string') : undefined,
        syncFolder: typeof parsed.syncFolder === 'string' || parsed.syncFolder === null ? parsed.syncFolder as string | null : undefined,
        resolveMode: typeof parsed.resolveMode === 'string' || parsed.resolveMode === null ? parsed.resolveMode as string | null : undefined,
      });
    } catch {
      continue;
    }
  }

  return intents;
}

async function maybeExecuteSyntheticToolIntents(
  state: RunState,
  options: YagrRunOptions,
  strategy: YagrToolRuntimeStrategy,
  tools: ReturnType<typeof buildTools>,
  phaseResult: {
    text: string;
    toolCalls: Array<{ toolName: string }>;
  },
): Promise<boolean> {
  if (!['weak', 'none'].includes(strategy.capabilityProfile.toolCalling)) {
    return false;
  }

  if (phaseResult.toolCalls.length > 0) {
    return false;
  }

  const intents = parseSyntheticToolIntents(phaseResult.text)
    .filter((intent) => (
      isSyntheticWriteWorkspaceFileIntent(intent)
      || (isSyntheticN8nacIntent(intent) && ['validate', 'push', 'verify'].includes(intent.action))
    ))
    .slice(0, strategy.capabilityProfile.toolCalling === 'none' ? 4 : 3);

  if (intents.length === 0) {
    return false;
  }

  for (const intent of intents) {
    if (isSyntheticWriteWorkspaceFileIntent(intent)) {
      const writeTool = tools.writeWorkspaceFile as unknown as {
        execute: (toolArgs: Record<string, unknown>, toolOptions?: unknown) => Promise<unknown>;
      };
      const args = {
        path: intent.path,
        content: intent.content,
        mode: intent.mode ?? 'overwrite',
      };
      const result = await writeTool.execute(args, undefined);
      await recordStep(state, options, {
        stepType: 'tool-result',
        finishReason: 'tool-calls',
        toolCalls: [{ toolName: 'writeWorkspaceFile', args }],
        toolResults: [{ toolName: 'writeWorkspaceFile', result }],
        text: '',
      });
      continue;
    }

    if (!isSyntheticN8nacIntent(intent)) {
      continue;
    }

    const args = {
      ...intent,
      validateFile: intent.validateFile || (intent.action === 'validate' ? intent.filename : undefined),
    };
    const n8nacTool = tools.n8nac as unknown as {
      execute: (toolArgs: Record<string, unknown>, toolOptions?: unknown) => Promise<unknown>;
    };
    const result = await n8nacTool.execute(args, undefined);
    await recordStep(state, options, {
      stepType: 'tool-result',
      finishReason: 'tool-calls',
      toolCalls: [{ toolName: 'n8nac', args }],
      toolResults: [{ toolName: 'n8nac', result }],
      text: '',
    });
  }

  return true;
}

function createPhasePrompt(
  phase: 'inspect' | 'execute',
  userPrompt: string,
  strategy: YagrToolRuntimeStrategy,
): string {
  const toolUseInstruction = strategy.tooling.toolCallMode === 'disabled'
    ? 'Do not call tools in this phase. Reason from the current context only.'
    : 'Use tools to inspect the workspace, existing workflow files, examples, and n8nac workspace status when needed.';

  if (phase === 'inspect') {
    return wrapInternal([
      'Yagr internal phase: inspect.',
      'Analyze the request and gather only the context needed to execute it correctly.',
      toolUseInstruction,
      'Do not reread the workspace AGENT.md or AGENTS.md file during inspect unless a specific later detail is missing from the current context.',
      'Favor correctness over speed in this phase. If an example or rule is likely to determine the right implementation, read it before acting.',
      'Do not claim completion in this phase.',
      ...strategy.inspectDirectives,
      `Original request: ${userPrompt}`,
    ].join('\n'));
  }

  return wrapInternal([
    'Yagr internal phase: execute.',
    'Complete the task end-to-end using the gathered context.',
    'When appropriate, author or edit workflow files, validate them, sync them, verify them, and then summarize what changed.',
    'Ask the user only when a specific missing value blocks execution.',
    ...strategy.executeDirectives,
    `Original request: ${userPrompt}`,
  ].join('\n'));
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
  return text.replace(INTERNAL_TAG_REGEX, '');
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
  const tagCount = (rawText.match(INTERNAL_TAG_REGEX) ?? []).length;
  if (tagCount < 2) {
    return false;
  }

  return sanitizeAssistantOutput(visibleText).length === 0;
}

export function shouldAbortForRepetitiveAssistantOutput(visibleText: string): boolean {
  const normalized = visibleText.trim();
  if (normalized.length < 240) {
    return false;
  }

  return hasRepeatedSuffix(normalized);
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

  if (shouldAbortForInternalPromptLeak(state.rawText, state.visibleText)) {
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

function collectPresentedWorkflow(result: unknown): { workflowId?: string; workflowUrl?: string; title?: string } | undefined {
  if (!result || typeof result !== 'object') {
    return undefined;
  }

  const record = result as Record<string, unknown>;
  const workflowId = typeof record.workflowId === 'string' ? record.workflowId : undefined;
  const workflowUrl = typeof record.workflowUrl === 'string' ? record.workflowUrl : undefined;
  const title = typeof record.title === 'string' ? record.title : undefined;

  if (!workflowId && !workflowUrl && !title) {
    return undefined;
  }

  return { workflowId, workflowUrl, title };
}

function collectWorkflowPresentationFromOutcome(outcome: RunOutcome): { workflowId?: string; workflowUrl?: string; title?: string } | undefined {
  const workflowId = outcome.successfulVerify?.workflowId ?? outcome.successfulPush?.workflowId;
  const workflowUrl = outcome.successfulVerify?.workflowUrl ?? outcome.successfulPush?.workflowUrl;
  const title = outcome.successfulVerify?.title ?? outcome.successfulPush?.title;

  if (!workflowId && !workflowUrl && !title) {
    return undefined;
  }

  return { workflowId, workflowUrl, title };
}

function extractWorkflowLabel(outcome: RunOutcome, journal: YagrRunJournalEntry[]): string | undefined {
  const successfulPushTarget = outcome.successfulPush?.filename;
  const workflowFilePath = successfulPushTarget
    || outcome.writtenFiles.find((filePath) => filePath.endsWith('.workflow.ts'))
    || outcome.updatedFiles.find((filePath) => filePath.endsWith('.workflow.ts'));

  if (!workflowFilePath) {
    return undefined;
  }

  const baseName = workflowFilePath.split('/').pop() ?? workflowFilePath;
  return baseName.replace(/\.workflow\.ts$/i, '');
}

function extractPresentedWorkflowFromJournal(journal: YagrRunJournalEntry[]): { workflowId?: string; workflowUrl?: string; title?: string } | undefined {
  for (let index = journal.length - 1; index >= 0; index -= 1) {
    const entry = journal[index];
    if (entry.type !== 'step' || !entry.step) {
      continue;
    }

    for (let toolIndex = entry.step.toolCalls.length - 1; toolIndex >= 0; toolIndex -= 1) {
      if (entry.step.toolCalls[toolIndex]?.toolName !== 'presentWorkflowResult') {
        continue;
      }

      const presented = collectPresentedWorkflow(entry.step.toolResults[toolIndex]?.result);
      if (presented) {
        return presented;
      }
    }
  }

  return undefined;
}

async function maybeEmitSyntheticWorkflowEmbed(
  outcome: RunOutcome,
  journal: YagrRunJournalEntry[],
  onToolEvent: YagrRunOptions['onToolEvent'],
): Promise<void> {
  if (!onToolEvent) {
    return;
  }

  const presentedWorkflow = extractPresentedWorkflowFromJournal(journal);
  if (presentedWorkflow?.workflowUrl) {
    return;
  }

  const fallbackWorkflow = collectWorkflowPresentationFromOutcome(outcome);
  if (!fallbackWorkflow?.workflowId || !fallbackWorkflow.workflowUrl) {
    return;
  }

  const workflowLink = resolveWorkflowOpenLink(fallbackWorkflow.workflowUrl);
  const pushTarget = outcome.successfulPush?.filename;
  const diagram = (pushTarget ? resolveWorkflowDiagramFromFilePath(pushTarget) : undefined)
    || [
      '<workflow-map>',
      `// Workflow : ${fallbackWorkflow.title || fallbackWorkflow.workflowId || 'Workflow'}`,
      '// ROUTING MAP',
      '// Diagram unavailable in source; link card synthesized from successful push/verify facts.',
      '</workflow-map>',
    ].join('\n');

  await onToolEvent({
    type: 'embed',
    toolName: 'presentWorkflowResult',
    kind: 'workflow',
    workflowId: fallbackWorkflow.workflowId,
    url: workflowLink.openUrl,
    targetUrl: workflowLink.targetUrl,
    title: fallbackWorkflow.title,
    diagram,
  });
}

export function buildGroundedSummary(
  _prompt: string,
  finishReason: string,
  journal: YagrRunJournalEntry[],
  requiredActions: YagrRequiredAction[],
): string {
  const lines: string[] = [];
  const outcome = analyzeRunOutcome(journal);
  const workflowLabel = extractWorkflowLabel(outcome, journal);
  const presentedWorkflow = extractPresentedWorkflowFromJournal(journal) ?? collectWorkflowPresentationFromOutcome(outcome);
  const presentedWorkflowUrl = presentedWorkflow?.workflowUrl;

  if (outcome.hasWorkflowWrites && outcome.successfulPush) {
    const workflowName = presentedWorkflow?.title || workflowLabel || 'the workflow';
    const completionBits = [
      `The workflow ${workflowName === 'the workflow' ? workflowName : `\`${workflowName}\``} is ready`,
      outcome.successfulValidate ? 'validated' : undefined,
      outcome.successfulPush ? 'pushed to n8n' : undefined,
      outcome.successfulVerify ? 'verified' : undefined,
    ].filter(Boolean);

    if (completionBits.length > 0) {
      lines.push(`${completionBits.join(', ')}.`);
    }

    if (presentedWorkflowUrl) {
      lines.push(`Workflow link: ${presentedWorkflowUrl}`);
    }
  }

  if (lines.length === 0 && presentedWorkflowUrl) {
    const workflowName = presentedWorkflow.title || workflowLabel || 'the workflow';
    lines.push(
      workflowName === 'the workflow'
        ? 'The workflow is ready.'
        : `The workflow \`${workflowName}\` is ready.`,
    );
    lines.push(`Workflow link: ${presentedWorkflowUrl}`);
  } else if (lines.length === 0 && presentedWorkflow?.title) {
    lines.push(`The workflow \`${presentedWorkflow.title}\` is ready.`);
  }

  if (lines.length > 0 && presentedWorkflowUrl && !lines.some((line) => line.includes(presentedWorkflowUrl))) {
    lines.push(`Workflow link: ${presentedWorkflowUrl}`);
  }

  if (lines.length > 0 && lines.every((line) => !/^The workflow card below/i.test(line)) && presentedWorkflow) {
    if (presentedWorkflow.workflowUrl) {
      lines.push('The workflow card below includes the direct link and the diagram.');
    } else {
      lines.push('The workflow card below includes the associated diagram.');
    }
  }

  if (lines.length === 0 && outcome.writtenFiles.length > 0) {
    lines.push(`Files created or rewritten: ${outcome.writtenFiles.join(', ')}`);
  }

  if (lines.length === 0 && outcome.updatedFiles.length > 0) {
    lines.push(`Files modified: ${outcome.updatedFiles.join(', ')}`);
  }

  if (lines.length === 0 && outcome.successfulActions.length > 0) {
    lines.push(`Successful n8nac actions: ${outcome.successfulActions.map(formatObservedAction).join(', ')}`);
  }

  if (outcome.blockingUnresolvedFailedActions.length > 0) {
    lines.push(`Failed n8nac actions: ${outcome.blockingUnresolvedFailedActions.map(formatObservedAction).join(', ')}`);
  }

  if (requiredActions.length > 0 && !(outcome.successfulPush && outcome.successfulVerify)) {
    lines.push(`Pending required actions: ${requiredActions.map((action) => `${action.title} [${action.kind}]`).join(', ')}`);
  }

  if (outcome.hasWorkflowWrites && !outcome.successfulValidate) {
    lines.push('Workflow validation was not confirmed.');
  }

  if (outcome.hasWorkflowWrites && !outcome.successfulPush) {
    lines.push('Push to n8n was not confirmed.');
  }

  if (outcome.hasWorkflowWrites && !outcome.successfulVerify) {
    lines.push('Remote verification was not confirmed.');
  }

  if (outcome.hasWorkflowWrites && outcome.blockingUnresolvedFailedActions.length > 0) {
    lines.push('The run stopped while some actions were still failing. More fixes are needed or an external blocker is still present.');
  }

  if (lines.length === 0 && finishReason !== 'stop') {
    lines.push(`The run ended with reason: ${finishReason}.`);
  }

  return lines.join('\n');
}

export function shouldForceGroundedFinalAnswer(
  journal: YagrRunJournalEntry[],
  requiredActions: YagrRequiredAction[] = [],
): boolean {
  const outcome = analyzeRunOutcome(journal);
  const presentedWorkflow = extractPresentedWorkflowFromJournal(journal) ?? collectWorkflowPresentationFromOutcome(outcome);

  if (requiredActions.length > 0) {
    return true;
  }

  if (presentedWorkflow?.workflowUrl) {
    return true;
  }

  return Boolean(outcome.hasWorkflowWrites && (outcome.successfulPush || outcome.successfulVerify));
}

export function finalAnswerSatisfiesGroundedWorkflowFacts(
  text: string,
  journal: YagrRunJournalEntry[],
): boolean {
  const normalizedText = sanitizeAssistantOutput(text);
  if (!normalizedText) {
    return false;
  }

  const outcome = analyzeRunOutcome(journal);
  const presentedWorkflow = extractPresentedWorkflowFromJournal(journal) ?? collectWorkflowPresentationFromOutcome(outcome);
  if (presentedWorkflow?.workflowUrl && !normalizedText.includes(presentedWorkflow.workflowUrl)) {
    return false;
  }

  return true;
}

function buildFinalAnswerFacts(
  finishReason: string,
  journal: YagrRunJournalEntry[],
  requiredActions: YagrRequiredAction[],
): string {
  const outcome = analyzeRunOutcome(journal);
  const workflowLabel = extractWorkflowLabel(outcome, journal);
  const presentedWorkflow = extractPresentedWorkflowFromJournal(journal) ?? collectWorkflowPresentationFromOutcome(outcome);
  const lines: string[] = [];

  lines.push(`finish_reason=${finishReason}`);
  lines.push(`workflow_writes=${outcome.hasWorkflowWrites ? 'yes' : 'no'}`);
  lines.push(`validate_confirmed=${outcome.successfulValidate ? 'yes' : 'no'}`);
  lines.push(`push_confirmed=${outcome.successfulPush ? 'yes' : 'no'}`);
  lines.push(`verify_confirmed=${outcome.successfulVerify ? 'yes' : 'no'}`);

  if (workflowLabel) {
    lines.push(`workflow_label=${workflowLabel}`);
  }
  if (presentedWorkflow?.title) {
    lines.push(`workflow_title=${presentedWorkflow.title}`);
  }
  if (presentedWorkflow?.workflowUrl) {
    lines.push(`workflow_url=${presentedWorkflow.workflowUrl}`);
  }
  if (outcome.writtenFiles.length > 0) {
    lines.push(`written_files=${outcome.writtenFiles.join(', ')}`);
  }
  if (outcome.updatedFiles.length > 0) {
    lines.push(`updated_files=${outcome.updatedFiles.join(', ')}`);
  }
  if (outcome.successfulActions.length > 0) {
    lines.push(`successful_actions=${outcome.successfulActions.map(formatObservedAction).join(', ')}`);
  }
  if (outcome.blockingUnresolvedFailedActions.length > 0) {
    lines.push(`blocking_failed_actions=${outcome.blockingUnresolvedFailedActions.map(formatObservedAction).join(', ')}`);
  }
  if (requiredActions.length > 0) {
    lines.push(`required_actions=${requiredActions.map((action) => `${action.title} [${action.kind}]`).join(', ')}`);
  }

  return lines.join('\n');
}

async function ensureFinalText(
  prompt: string,
  finishReason: string,
  journal: YagrRunJournalEntry[],
  existingText: string,
  requiredActions: YagrRequiredAction[],
  completionAccepted: boolean,
  options: YagrRunOptions,
  strategy: YagrToolRuntimeStrategy,
): Promise<string> {
  const sanitizedText = sanitizeAssistantOutput(existingText);
  const forceGroundedFinalAnswer = shouldForceGroundedFinalAnswer(journal, requiredActions);

  if (completionAccepted && !forceGroundedFinalAnswer && sanitizedText && !looksLikeRawToolIntentText(sanitizedText)) {
    return sanitizedText;
  }

  const finalAnswerFacts = buildFinalAnswerFacts(finishReason, journal, requiredActions);

  try {
    const result = await generateText({
      abortSignal: options.abortSignal,
      model: createLanguageModel(options),
      system: [
        'You are writing the final answer to the user after an agent run.',
        'Use only the grounded facts you are given.',
        'Do not mention internal prompts, phases, journals, or tool names such as n8nac, list, skills, validate, push, or verify unless the user explicitly asked for internals.',
        'If the workflow is ready, say so briefly and include the workflow URL if it is useful.',
        'Do not describe UI elements, cards, banners, embeds, diagrams, or presentation widgets.',
        'If the task is not complete, explain the real blocker briefly and concretely.',
        'Never invent success. Never mention unsupported details.',
        'Keep the answer concise and user-facing.',
      ].join('\n'),
      messages: [
        {
          role: 'user',
          content: [
            `Original user request:\n${prompt}`,
            '',
            `Grounded run facts:\n${finalAnswerFacts}`,
            '',
            'Write the final user-facing answer now.',
          ].join('\n'),
        },
      ],
      maxSteps: 1,
      providerOptions: strategy.providerOptions,
    });

    const finalText = sanitizeAssistantOutput(result.text);
    if (
      finalText
      && !looksLikeRawToolIntentText(finalText)
      && finalAnswerSatisfiesGroundedWorkflowFacts(finalText, journal)
    ) {
      return finalText;
    }
  } catch {
    // Fall through to the last-resort grounded summary.
  }

  return buildGroundedSummary(prompt, finishReason, journal, requiredActions)
    || 'Run stopped before producing a grounded result.';
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

  if (outcome.blockingUnresolvedFailedActions.length > 0) {
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
    missingChecks.push('remote verification');
  }

  const issues = [
    failedActions ? `Failed actions: ${failedActions}.` : '',
    missingChecks.length > 0 ? `Unconfirmed steps: ${missingChecks.join(', ')}.` : '',
  ].filter(Boolean).join(' ');

  return wrapInternal([
    `Yagr internal recovery pass ${attemptNumber}.`,
    issues,
    'Do not summarize yet.',
    'Inspect the failing tool output, correct the local files or command arguments, and retry the necessary steps now.',
    'Only stop if a genuine blocker remains that cannot be resolved locally in this run.',
  ].join(' '));
}

async function executePhase(
  state: RunState,
  options: YagrRunOptions,
  strategy: YagrToolRuntimeStrategy,
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
  const modelInvocationTools = strategy.tooling.toolCallMode === 'disabled' ? undefined : tools;

  if (strategy.executionMode === 'generate') {
    const result = await generateText({
      abortSignal: options.abortSignal,
      model: createLanguageModel(options),
      system: systemPrompt,
      ...(modelInvocationTools ? { tools: modelInvocationTools } : {}),
      messages,
      maxSteps,
      providerOptions: strategy.providerOptions,
    });

    for (const step of result.steps) {
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

    const finalText = sanitizeAssistantOutput(result.text);
    if (finalText) {
      await options.onTextDelta?.(finalText);
    }

    return {
      text: finalText,
      finishReason: String(result.finishReason),
      steps: result.steps.length,
      toolCalls: result.toolCalls.map((toolCall: { toolName: string }) => ({ toolName: toolCall.toolName })),
      responseMessages: result.response.messages,
    };
  }

  let recordedSteps = 0;
  const recordedToolNames = new Set<string>();

  const result = streamText({
    abortSignal: options.abortSignal,
    model: createLanguageModel(options),
    system: systemPrompt,
    ...(modelInvocationTools ? { tools: modelInvocationTools } : {}),
    messages,
    maxSteps,
    toolCallStreaming: strategy.toolCallStreaming,
    providerOptions: strategy.providerOptions,
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
    private readonly engine: EngineRuntimePort,
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
    const resolvedModelConfig = resolveLanguageModelConfig(options);
    await getProviderPlugin(resolvedModelConfig.provider).metadata?.primeModelMetadata?.({
      model: resolvedModelConfig.model,
      apiKey: resolvedModelConfig.apiKey,
      baseUrl: resolvedModelConfig.baseUrl,
    });
    const runtimeStrategy = resolveToolRuntimeStrategy(resolvedModelConfig.provider, resolvedModelConfig.model);
    const runtimeHooks = [...createDefaultRuntimeHooksForStrategy(runtimeStrategy), ...(options.runtimeHooks ?? [])];
    const baseTools = buildTools(this.engine, {
      onToolEvent: withRuntimeToolEvents(state, options),
    }, {
      allowedToolNames: runtimeStrategy.tooling.availableToolNames,
    });
    const tools = wrapToolsWithRuntimeHooks(baseTools as any, runtimeHooks, () => ({
      runId: state.runId,
      phase: state.currentPhase,
      state: state.currentAgentState,
    }), options.satisfiedRequiredActionIds) as typeof baseTools;
    const modelInvocationTools = runtimeStrategy.tooling.toolCallMode === 'disabled' ? undefined : tools;
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
        content: createPhasePrompt('inspect', prompt, runtimeStrategy),
      };
      const inspectResult = await generateText({
        abortSignal: options.abortSignal,
        model: createLanguageModel(options),
        system: this.systemPrompt,
        ...(modelInvocationTools ? { tools: modelInvocationTools } : {}),
        messages: [...executionContext, inspectInstruction],
        maxSteps: Math.min(options.maxSteps ?? 8, runtimeStrategy.inspectMaxSteps),
        providerOptions: runtimeStrategy.providerOptions,
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
        content: createPhasePrompt('execute', prompt, runtimeStrategy),
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
          runtimeStrategy,
          this.systemPrompt,
          tools,
          executeMessages,
          attemptNumber === 1
            ? (options.maxSteps ?? runtimeStrategy.executeMaxSteps)
            : Math.min(options.maxSteps ?? runtimeStrategy.executeMaxSteps, runtimeStrategy.recoveryMaxSteps),
        );

        if (phaseResult.text) {
          text = phaseResult.text;
        }
        finishReason = phaseResult.finishReason;
        steps += phaseResult.steps;
        toolCalls = phaseResult.toolCalls;
        responseMessages = [...responseMessages, ...sanitizeAssistantResponseMessages(phaseResult.responseMessages)];

        const executedSyntheticIntents = await maybeExecuteSyntheticToolIntents(
          state,
          options,
          runtimeStrategy,
          tools,
          phaseResult,
        );

        const outcome = analyzeRunOutcome(state.journal);
        const requiredActions = collectRequiredActions(state.journal);
        if (!shouldAttemptRecovery(outcome, attemptNumber, requiredActions) || executedSyntheticIntents) {
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
      const finalOutcome = analyzeRunOutcome(state.journal);
      const completionDecision = await evaluateCompletionGate({
        text,
        finishReason,
        requiredActions,
        satisfiedRequiredActionIds: options.satisfiedRequiredActionIds,
        hasWorkflowWrites: finalOutcome.hasWorkflowWrites,
        successfulValidate: Boolean(finalOutcome.successfulValidate),
        successfulPush: Boolean(finalOutcome.successfulPush),
        successfulVerify: Boolean(finalOutcome.successfulVerify),
        unresolvedFailureCount: finalOutcome.blockingUnresolvedFailedActions.length,
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
      await maybeEmitSyntheticWorkflowEmbed(finalOutcome, state.journal, options.onToolEvent);
      text = await ensureFinalText(
        prompt,
        finishReason,
        state.journal,
        text,
        completionDecision.requiredActions,
        completionDecision.accepted,
        options,
        runtimeStrategy,
      );

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
