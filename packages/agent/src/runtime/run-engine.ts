import { randomUUID } from 'node:crypto';
import { generateText, streamText, type CoreMessage } from 'ai';
import type { Engine } from '../engine/engine.js';
import { createLanguageModel } from '../llm/create-language-model.js';
import type {
  HolonPhaseEvent,
  HolonRunJournalEntry,
  HolonRunOptions,
  HolonRunPhase,
  HolonRunResult,
  HolonRunStep,
} from '../types.js';
import { buildSystemPrompt } from '../prompt/build-system-prompt.js';
import { buildTools } from '../tools/index.js';

const INSPECT_MAX_STEPS = 2;
const EXECUTE_MAX_STEPS = 10;
const PHASE_ORDER: HolonRunPhase[] = ['inspect', 'plan', 'edit', 'validate', 'sync', 'verify', 'summarize'];

type ExecuteRunResult = {
  result: HolonRunResult;
  persistedMessages: CoreMessage[];
};

type RunState = {
  runId: string;
  journal: HolonRunJournalEntry[];
  currentPhase: HolonRunPhase | null;
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

type ObservedN8nacAction = {
  action: string;
  success: boolean;
  filename?: string;
  workflowId?: string;
  validateFile?: string;
  exitCode?: number;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function extractObservedFacts(journal: HolonRunJournalEntry[]) {
  const writtenFiles = new Set<string>();
  const updatedFiles = new Set<string>();
  const n8nacActions: ObservedN8nacAction[] = [];

  for (const entry of journal) {
    if (entry.type !== 'step' || !entry.step) {
      continue;
    }

    const step = entry.step;

    for (let index = 0; index < step.toolCalls.length; index += 1) {
      const toolCall = step.toolCalls[index];
      const toolResult = step.toolResults[index];
      const args = asRecord(toolCall.args);
      const result = asRecord(toolResult?.result);

      if (toolCall.toolName === 'writeWorkspaceFile') {
        const path = asString(result?.path) ?? asString(args?.path);
        if (path) {
          writtenFiles.add(path);
        }
        continue;
      }

      if (toolCall.toolName === 'replaceInWorkspaceFile') {
        const path = asString(result?.path) ?? asString(args?.path);
        if (path) {
          updatedFiles.add(path);
        }
        continue;
      }

      if (toolCall.toolName === 'n8nac') {
        const action = asString(args?.action) ?? 'unknown';
        n8nacActions.push({
          action,
          success: (asNumber(result?.exitCode) ?? 1) === 0,
          filename: asString(args?.filename),
          workflowId: asString(args?.workflowId),
          validateFile: asString(args?.validateFile),
          exitCode: asNumber(result?.exitCode),
        });
      }
    }
  }

  return {
    writtenFiles: [...writtenFiles],
    updatedFiles: [...updatedFiles],
    n8nacActions,
  };
}

function findSuccessfulAction(actions: ObservedN8nacAction[], actionName: string): ObservedN8nacAction | undefined {
  return actions.find((action) => action.action === actionName && action.success);
}

function formatAction(action: ObservedN8nacAction): string {
  const target = action.filename ?? action.validateFile ?? action.workflowId;
  return target ? `${action.action} (${target})` : action.action;
}

function buildGroundedSummary(prompt: string, finishReason: string, journal: HolonRunJournalEntry[]): string {
  const facts = extractObservedFacts(journal);
  const lines: string[] = [];
  const successfulActions = facts.n8nacActions.filter((action) => action.success);
  const failedActions = facts.n8nacActions.filter((action) => !action.success);
  const successfulValidate = findSuccessfulAction(facts.n8nacActions, 'validate');
  const successfulPush = findSuccessfulAction(facts.n8nacActions, 'push');
  const successfulVerify = findSuccessfulAction(facts.n8nacActions, 'verify');

  lines.push(`Demande: ${prompt}`);

  if (facts.writtenFiles.length > 0) {
    lines.push(`Fichiers crees ou reecrits: ${facts.writtenFiles.join(', ')}`);
  }

  if (facts.updatedFiles.length > 0) {
    lines.push(`Fichiers modifies: ${facts.updatedFiles.join(', ')}`);
  }

  if (successfulActions.length > 0) {
    lines.push(`Actions n8nac reussies: ${successfulActions.map(formatAction).join(', ')}`);
  }

  if (failedActions.length > 0) {
    lines.push(`Actions n8nac en echec: ${failedActions.map(formatAction).join(', ')}`);
  }

  if (!successfulValidate) {
    lines.push('La validation du workflow n’a pas ete confirmee.');
  }

  if (!successfulPush) {
    lines.push('Le push vers n8n n’a pas ete confirme.');
  }

  if (!successfulVerify) {
    lines.push('La verification distante n’a pas ete confirmee.');
  }

  if (finishReason !== 'stop') {
    lines.push(`Le run s’est termine avec la raison: ${finishReason}.`);
  }

  return lines.join('\n');
}

async function ensureFinalText(
  _engine: Engine,
  _options: HolonRunOptions,
  prompt: string,
  finishReason: string,
  journal: HolonRunJournalEntry[],
  existingText: string,
): Promise<string> {
  const groundedSummary = buildGroundedSummary(prompt, finishReason, journal);

  if (!existingText.trim()) {
    return groundedSummary;
  }

  return `${groundedSummary}\n\nReponse du modele:\n${existingText.trim()}`;
}

async function emitJournal(state: RunState, options: HolonRunOptions, entry: Omit<HolonRunJournalEntry, 'timestamp'>): Promise<void> {
  const journalEntry = buildJournalEntry(entry);
  state.journal.push(journalEntry);
  await options.onJournalEntry?.(journalEntry);
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
      stepNumber: 0,
    };

    const currentUserMessage: CoreMessage = {
      role: 'user',
      content: prompt,
    };
    const systemPrompt = buildSystemPrompt(this.engine);
    const tools = buildTools(this.engine, {
      onToolEvent: options.onToolEvent,
    });
    const persistedMessages: CoreMessage[] = [currentUserMessage];
    const executionContext: CoreMessage[] = [...this.history, currentUserMessage];

    await emitJournal(state, options, {
      type: 'run',
      status: 'started',
      message: 'Holon run started.',
      runId: state.runId,
    });

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
      const executeMessages = [...executionContext, executeInstruction];

      let text = '';
      let finishReason = 'stop';
      let steps = 0;
      let toolCalls: Array<{ toolName: string }> = [];
      let responseMessages: CoreMessage[] = [];

      if (options.onTextDelta || options.onStepFinish || options.onPhaseChange || options.onJournalEntry) {
        const result = streamText({
          model: createLanguageModel(options),
          system: systemPrompt,
          tools,
          messages: executeMessages,
          maxSteps: options.maxSteps ?? EXECUTE_MAX_STEPS,
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

        text = resolved[0];
        finishReason = String(resolved[1]);
        steps = resolved[2].length + inspectResult.steps.length;
        toolCalls = resolved[3].map((toolCall) => ({ toolName: toolCall.toolName }));
        responseMessages = response.messages;
      } else {
        const result = await generateText({
          model: createLanguageModel(options),
          system: systemPrompt,
          tools,
          messages: executeMessages,
          maxSteps: options.maxSteps ?? EXECUTE_MAX_STEPS,
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

        text = result.text;
        finishReason = String(result.finishReason);
        steps = result.steps.length + inspectResult.steps.length;
        toolCalls = result.toolCalls.map((toolCall) => ({ toolName: toolCall.toolName }));
        responseMessages = result.response.messages;
      }

      persistedMessages.push(...responseMessages);
      text = await ensureFinalText(this.engine, options, prompt, finishReason, state.journal, text);

      if (state.currentPhase && state.currentPhase !== 'summarize') {
        await transitionPhase(state, options, state.currentPhase, 'completed', `${state.currentPhase} phase completed.`);
      }

      await transitionPhase(state, options, 'summarize', 'started', 'Summarizing run outcome.');
      await transitionPhase(state, options, 'summarize', 'completed', 'Run summary ready.');

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
          finalPhase: 'summarize',
          journal: state.journal,
        },
        persistedMessages,
      };
    } catch (error) {
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