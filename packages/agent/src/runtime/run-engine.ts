import { randomUUID } from 'node:crypto';
import { generateText, streamText, type CoreMessage } from 'ai';
import type { Engine } from '../engine/engine.js';
import { createLanguageModel } from '../llm/create-language-model.js';
import type {
  HolonAgentState,
  HolonRequiredAction,
  HolonRuntimeContext,
  HolonPhaseEvent,
  HolonRunJournalEntry,
  HolonRunOptions,
  HolonRunPhase,
  HolonRunResult,
  HolonRunStep,
  HolonStateEvent,
  HolonToolEvent,
} from '../types.js';
import { buildSystemPrompt } from '../prompt/build-system-prompt.js';
import { buildTools } from '../tools/index.js';
import { evaluateCompletionGate } from './completion-gate.js';
import { analyzeRunOutcome, formatObservedAction, type RunOutcome } from './outcome.js';
import { wrapToolsWithRuntimeHooks } from './policy-hooks.js';
import { blockingStateForRequiredActions, collectRequiredActions } from './required-actions.js';

const INSPECT_MAX_STEPS = 2;
const EXECUTE_MAX_STEPS = 10;
const EXECUTE_RECOVERY_MAX_STEPS = 6;
const MAX_EXECUTION_ATTEMPTS = 3;
const PHASE_ORDER: HolonRunPhase[] = ['inspect', 'plan', 'edit', 'validate', 'sync', 'verify', 'summarize'];

type ExecuteRunResult = {
  result: HolonRunResult;
  persistedMessages: CoreMessage[];
};

type RunState = {
  runId: string;
  journal: HolonRunJournalEntry[];
  currentPhase: HolonRunPhase | null;
  currentAgentState: HolonAgentState;
  stepNumber: number;
};

function createPhasePrompt(phase: 'inspect' | 'execute', userPrompt: string): string {
  if (phase === 'inspect') {
    return [
      'Holon internal phase: inspect.',
      'Analyze the request and gather only the context needed to execute it correctly.',
      'Use tools to inspect the workspace, existing workflow files, and n8nac workspace status when needed.',
      'Do not claim completion in this phase.',
      `Original request: ${userPrompt}`,
    ].join('\n');
  }

  return [
    'Holon internal phase: execute.',
    'Complete the task end-to-end using the gathered context.',
    'When appropriate, author or edit workflow files, validate them, sync them, verify them, and then summarize what changed.',
    'Ask the user only when a specific missing value blocks execution.',
    `Original request: ${userPrompt}`,
  ].join('\n');
}

function buildJournalEntry(entry: Omit<HolonRunJournalEntry, 'timestamp'>): HolonRunJournalEntry {
  return {
    timestamp: new Date().toISOString(),
    ...entry,
  };
}

function inferPhaseFromStep(step: {
  stepType: string;
  toolCalls: Array<{ toolName: string; args: unknown }>;
  toolResults: Array<{ toolName: string; result: unknown }>;
}): HolonRunPhase {
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

function getPhaseIndex(phase: HolonRunPhase | null): number {
  if (!phase) {
    return -1;
  }

  return PHASE_ORDER.indexOf(phase);
}

function chooseNextPhase(currentPhase: HolonRunPhase | null, inferredPhase: HolonRunPhase): HolonRunPhase {
  if (!currentPhase) {
    return inferredPhase;
  }

  return getPhaseIndex(inferredPhase) >= getPhaseIndex(currentPhase) ? inferredPhase : currentPhase;
}

function collectToolNames(journal: HolonRunJournalEntry[]): Array<{ toolName: string }> {
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
  prompt: string,
  finishReason: string,
  journal: HolonRunJournalEntry[],
  requiredActions: HolonRequiredAction[],
): string {
  const lines: string[] = [];
  const outcome = analyzeRunOutcome(journal);

  lines.push(`Demande: ${prompt}`);

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

  if (!outcome.successfulValidate) {
    lines.push('La validation du workflow n’a pas ete confirmee.');
  }

  if (!outcome.successfulPush) {
    lines.push('Le push vers n8n n’a pas ete confirme.');
  }

  if (!outcome.successfulVerify) {
    lines.push('La verification distante n’a pas ete confirmee.');
  }

  if (outcome.unresolvedFailedActions.length > 0) {
    lines.push('Le run s’est arrete alors que certaines actions avaient encore echoue. Une correction supplementaire reste necessaire ou un bloqueur externe persiste.');
  }

  if (finishReason !== 'stop') {
    lines.push(`Le run s’est termine avec la raison: ${finishReason}.`);
  }

  return lines.join('\n');
}

async function ensureFinalText(
  _options: HolonRunOptions,
  prompt: string,
  finishReason: string,
  journal: HolonRunJournalEntry[],
  existingText: string,
  requiredActions: HolonRequiredAction[],
  completionAccepted: boolean,
): Promise<string> {
  const groundedSummary = buildGroundedSummary(prompt, finishReason, journal, requiredActions);
  const sanitizedText = existingText
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0
        && !trimmed.startsWith('Holon internal phase:')
        && trimmed !== 'think silently.'
        && trimmed !== 'Complete the task end-to-end using the gathered context.'
        && trimmed !== 'When appropriate, author or edit workflow files, validate them, sync them, verify them, and then summarize what changed.'
        && trimmed !== 'Ask the user only when a specific missing value blocks execution.'
        && !trimmed.startsWith('Original request:');
    })
    .join('\n')
    .trim();

  if (!sanitizedText) {
    return groundedSummary;
  }

  if (!completionAccepted) {
    return groundedSummary;
  }

  return `${groundedSummary}\n\nReponse du modele:\n${sanitizedText}`;
}

function buildRuntimeContext(state: RunState): HolonRuntimeContext {
  return {
    runId: state.runId,
    phase: state.currentPhase ?? undefined,
    state: state.currentAgentState,
  };
}

async function emitJournal(state: RunState, options: HolonRunOptions, entry: Omit<HolonRunJournalEntry, 'timestamp'>): Promise<void> {
  const journalEntry = buildJournalEntry(entry);
  state.journal.push(journalEntry);
  await options.onJournalEntry?.(journalEntry);
}

async function transitionAgentState(
  state: RunState,
  options: HolonRunOptions,
  nextState: HolonAgentState,
  message: string,
): Promise<void> {
  if (state.currentAgentState === nextState) {
    return;
  }

  state.currentAgentState = nextState;

  const event: HolonStateEvent = {
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

function withRuntimeToolEvents(state: RunState, options: HolonRunOptions) {
  return async (event: HolonToolEvent): Promise<void> => {
    if (event.type === 'command-start') {
      await transitionAgentState(state, options, 'streaming', `Streaming command output for ${event.toolName}.`);
    } else if (event.type === 'command-end') {
      await transitionAgentState(state, options, 'running', `Command finished for ${event.toolName}.`);
    }

    await options.onToolEvent?.(event);
  };
}

function shouldAttemptRecovery(outcome: RunOutcome, attemptNumber: number, requiredActions: HolonRequiredAction[]): boolean {
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
    `Holon internal recovery pass ${attemptNumber}.`,
    issues,
    'Do not summarize yet.',
    'Inspect the failing tool output, correct the local files or command arguments, and retry the necessary steps now.',
    'Only stop if a genuine blocker remains that cannot be resolved locally in this run.',
  ].join(' ');
}

async function executePhase(
  state: RunState,
  options: HolonRunOptions,
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
  if (options.onTextDelta || options.onStepFinish || options.onPhaseChange || options.onJournalEntry) {
    const result = streamText({
      model: createLanguageModel(options),
      system: systemPrompt,
      tools,
      messages,
      maxSteps,
      toolCallStreaming: true,
      onStepFinish: async (stepResult) => {
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

    for await (const textDelta of result.textStream) {
      await options.onTextDelta?.(textDelta);
    }

    const response = await result.response;
    const resolved = await Promise.all([
      result.text,
      result.finishReason,
      result.steps,
      result.toolCalls,
    ]);

    return {
      text: resolved[0],
      finishReason: String(resolved[1]),
      steps: resolved[2].length,
      toolCalls: resolved[3].map((toolCall) => ({ toolName: toolCall.toolName })),
      responseMessages: response.messages,
    };
  }

  const result = await generateText({
    model: createLanguageModel(options),
    system: systemPrompt,
    tools,
    messages,
    maxSteps,
  });

  for (const step of result.steps) {
    await recordStep(state, options, {
      stepType: step.stepType,
      finishReason: String(step.finishReason),
      toolCalls: step.toolCalls.map((toolCall) => ({
        toolName: toolCall.toolName,
        args: toolCall.args,
      })),
      toolResults: step.toolResults.map((toolResult) => ({
        toolName: toolResult.toolName,
        result: toolResult.result,
      })),
      text: step.text,
    });
  }

  return {
    text: result.text,
    finishReason: String(result.finishReason),
    steps: result.steps.length,
    toolCalls: result.toolCalls.map((toolCall) => ({ toolName: toolCall.toolName })),
    responseMessages: result.response.messages,
  };
}

async function transitionPhase(state: RunState, options: HolonRunOptions, phase: HolonRunPhase, status: HolonPhaseEvent['status'], message: string): Promise<void> {
  if (status === 'started') {
    state.currentPhase = phase;
  }

  const event: HolonPhaseEvent = {
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
  options: HolonRunOptions,
  step: {
    stepType: string;
    finishReason: string;
    toolCalls: Array<{ toolName: string; args: unknown }>;
    toolResults: Array<{ toolName: string; result: unknown }>;
    text: string;
  },
): Promise<HolonRunStep> {
  state.stepNumber += 1;
  const phase = chooseNextPhase(state.currentPhase, inferPhaseFromStep(step));

  if (state.currentPhase !== phase) {
    if (state.currentPhase) {
      await transitionPhase(state, options, state.currentPhase, 'completed', `${state.currentPhase} phase completed.`);
    }
    await transitionPhase(state, options, phase, 'started', `${phase} phase started.`);
  }

  const trace: HolonRunStep = {
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

export class HolonRunEngine {
  constructor(
    private readonly engine: Engine,
    private readonly history: readonly CoreMessage[],
  ) {}

  async execute(prompt: string, options: HolonRunOptions = {}): Promise<ExecuteRunResult> {
    const state: RunState = {
      runId: randomUUID(),
      journal: [],
      currentPhase: null,
      currentAgentState: 'idle',
      stepNumber: 0,
    };

    const currentUserMessage: CoreMessage = {
      role: 'user',
      content: prompt,
    };
    const systemPrompt = buildSystemPrompt(this.engine);
    const baseTools = buildTools(this.engine, {
      onToolEvent: withRuntimeToolEvents(state, options),
    });
    const tools = wrapToolsWithRuntimeHooks(baseTools as any, options.runtimeHooks, () => ({
      runId: state.runId,
      phase: state.currentPhase,
      state: state.currentAgentState,
    })) as typeof baseTools;
    const persistedMessages: CoreMessage[] = [currentUserMessage];
    const executionContext: CoreMessage[] = [...this.history, currentUserMessage];

    await emitJournal(state, options, {
      type: 'run',
      status: 'started',
      message: 'Holon run started.',
      runId: state.runId,
    });
    await transitionAgentState(state, options, 'running', 'Task execution started.');

    try {
      await transitionPhase(state, options, 'inspect', 'started', 'Inspecting workspace and task context.');

      const inspectInstruction: CoreMessage = {
        role: 'user',
        content: createPhasePrompt('inspect', prompt),
      };
      const inspectResult = await generateText({
        model: createLanguageModel(options),
        system: systemPrompt,
        tools,
        messages: [...executionContext, inspectInstruction],
        maxSteps: Math.min(options.maxSteps ?? 8, INSPECT_MAX_STEPS),
      });

      for (const step of inspectResult.steps) {
        await recordStep(state, options, {
          stepType: step.stepType,
          finishReason: String(step.finishReason),
          toolCalls: step.toolCalls.map((toolCall) => ({
            toolName: toolCall.toolName,
            args: toolCall.args,
          })),
          toolResults: step.toolResults.map((toolResult) => ({
            toolName: toolResult.toolName,
            result: toolResult.result,
          })),
          text: step.text,
        });
      }

      if (state.currentPhase === 'inspect') {
        await transitionPhase(state, options, 'inspect', 'completed', 'Inspection completed.');
      }

      executionContext.push(inspectInstruction, ...inspectResult.response.messages);

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
        const phaseResult = await executePhase(
          state,
          options,
          systemPrompt,
          tools,
          executeMessages,
          attemptNumber === 1 ? (options.maxSteps ?? EXECUTE_MAX_STEPS) : Math.min(options.maxSteps ?? EXECUTE_MAX_STEPS, EXECUTE_RECOVERY_MAX_STEPS),
        );

        text = phaseResult.text;
        finishReason = phaseResult.finishReason;
        steps += phaseResult.steps;
        toolCalls = phaseResult.toolCalls;
        responseMessages = [...responseMessages, ...phaseResult.responseMessages];

        const outcome = analyzeRunOutcome(state.journal);
        const requiredActions = collectRequiredActions(state.journal);
        if (!shouldAttemptRecovery(outcome, attemptNumber, requiredActions)) {
          break;
        }

        await emitJournal(state, options, {
          type: 'phase',
          phase: state.currentPhase ?? 'plan',
          status: 'started',
          message: `Recovery pass ${attemptNumber + 1} triggered after failed or incomplete execution steps.`,
        });

        executeMessages = [
          ...executeMessages,
          ...phaseResult.responseMessages,
          {
            role: 'user',
            content: buildRecoveryPrompt(outcome, attemptNumber + 1),
          },
        ];
      }

      persistedMessages.push(...responseMessages);
      steps += inspectResult.steps.length;
      const requiredActions = collectRequiredActions(state.journal);
      const completionDecision = await evaluateCompletionGate({
        text,
        finishReason,
        requiredActions,
        hasWorkflowWrites: analyzeRunOutcome(state.journal).hasWorkflowWrites,
        successfulValidate: Boolean(analyzeRunOutcome(state.journal).successfulValidate),
        successfulPush: Boolean(analyzeRunOutcome(state.journal).successfulPush),
        unresolvedFailureCount: analyzeRunOutcome(state.journal).unresolvedFailedActions.length,
        hooks: options.runtimeHooks,
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
        message: 'Holon run completed.',
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
          finalState: state.currentAgentState,
          finalPhase: 'summarize',
          journal: state.journal,
        },
        persistedMessages,
      };
    } catch (error) {
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