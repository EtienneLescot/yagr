import type { YagrLanguageModelConfig } from './llm/create-langchain-model.js';
import type { YagrModelProvider } from './llm/provider-registry.js';
import type {
  RuntimeContextCompactionEvent,
  RuntimeContextUsageEvent,
  RuntimeOperationCategory,
  RuntimeOperationEvent,
  RuntimePhase,
  RuntimePhaseEvent,
  RuntimeRequiredAction,
} from '@yagr/runtime-events';
import type {
  ManualCompactionOptions,
  ManualCompactionResult,
  ManualCompactionStatus,
} from '@yagr/session-service';

export type EngineName = 'local-coding';

export interface NodeSummary {
  name: string;
  type: string;
  displayName?: string;
  description?: string;
  category?: string;
}

export interface TemplateSummary {
  id: string;
  title: string;
  excerpt?: string;
  category?: string;
  url?: string;
}

export interface CredentialRequirement {
  nodeName: string;
  credentialType: string;
  displayName: string;
  required: boolean;
  status: 'missing' | 'linked' | 'unknown';
  helpUrl?: string;
}

export type { YagrLanguageModelConfig, YagrModelProvider };

export type YagrRunPhase = RuntimePhase;

export type YagrAgentState =
  | 'idle'
  | 'running'
  | 'streaming'
  | 'stopped'
  | 'waiting_for_permission'
  | 'waiting_for_input'
  | 'compacting'
  | 'resumable'
  | 'completed'
  | 'failed_terminal';

export type YagrRequiredActionKind = RuntimeRequiredAction['kind'];
export type YagrRequiredAction = RuntimeRequiredAction;

export interface YagrToolCallTrace {
  toolName: string;
  args: unknown;
}

export interface YagrToolResultTrace {
  toolName: string;
  result: unknown;
}

/**
 * Generic structured action signal embedded in any tool result.
 * Tools that represent discrete operations (e.g. CLI wrappers) can include
 * this in their result so the outcome layer can observe them without coupling
 * to a specific tool name.
 */
export interface YagrActionSignal {
  operation: string;
  success: boolean;
  exitCode?: number;
  filename?: string;
  title?: string;
  validateFile?: string;
  asyncTrigger?: boolean;
  executionConfirmed?: boolean;
}

export type YagrToolEvent =
  | {
      type: 'status';
      toolName: string;
      message: string;
    }
  | {
      type: 'command-start';
      toolName: string;
      command: string;
      cwd?: string;
      message?: string;
    }
  | {
      type: 'command-output';
      toolName: string;
      stream: 'stdout' | 'stderr';
      chunk: string;
    }
  | {
      type: 'command-end';
      toolName: string;
      exitCode: number;
      timedOut?: boolean;
      message?: string;
    }
  | {
      type: 'result';
      toolName: string;
      message: string;
    };

export interface YagrRunStep {
  stepNumber: number;
  stepType: string;
  finishReason: string;
  toolCalls: YagrToolCallTrace[];
  toolResults: YagrToolResultTrace[];
  text: string;
  phase: YagrRunPhase;
  usage?: { promptTokens: number; completionTokens: number };
}

export type YagrPhaseEvent = RuntimePhaseEvent;

export interface YagrStateEvent {
  state: YagrAgentState;
  phase?: YagrRunPhase;
  message: string;
}

export interface YagrRuntimeContext {
  runId: string;
  phase?: YagrRunPhase;
  state: YagrAgentState;
}

export interface YagrToolHookContext extends YagrRuntimeContext {
  toolName: string;
  args: unknown;
}

export interface YagrToolHookDecision {
  allowed?: boolean;
  message?: string;
  requiredAction?: YagrRequiredAction;
}

export interface YagrCompletionAttempt {
  text: string;
  finishReason: string;
  requiredActions: YagrRequiredAction[];
}

export interface YagrCompletionHookDecision {
  accepted?: boolean;
  message?: string;
  requiredAction?: YagrRequiredAction;
}

export interface YagrRuntimeHook {
  beforeTool?: (context: YagrToolHookContext) => void | YagrToolHookDecision | Promise<void | YagrToolHookDecision>;
  afterTool?: (context: YagrToolHookContext & { result: unknown }) => void | Promise<void>;
  beforeCompletion?: (
    attempt: YagrCompletionAttempt,
    context: YagrRuntimeContext,
  ) => void | YagrCompletionHookDecision | Promise<void | YagrCompletionHookDecision>;
}

export interface YagrRunJournalEntry {
  timestamp: string;
  type: 'run' | 'phase' | 'step' | 'state' | 'compaction';
  status: 'started' | 'completed' | 'failed';
  message: string;
  phase?: YagrRunPhase;
  state?: YagrAgentState;
  requiredAction?: YagrRequiredAction;
  compaction?: YagrContextCompactionEvent;
  stepNumber?: number;
  runId?: string;
  step?: YagrRunStep;
}

export type YagrContextCompactionEvent = RuntimeContextCompactionEvent;
export type YagrContextUsageEvent = RuntimeContextUsageEvent;
export type YagrManualCompactionStatus = ManualCompactionStatus;
export type YagrManualCompactionOptions = ManualCompactionOptions;
export type YagrManualCompactionResult = ManualCompactionResult;
export type YagrOperationStatus = RuntimeOperationEvent['status'];
export type YagrOperationCategory = RuntimeOperationCategory;
export type YagrOperationEvent = RuntimeOperationEvent;

export interface YagrDisplayOptions {
  showThinking?: boolean;
  showExecution?: boolean;
  showResponses?: boolean;
  showUserPrompts?: boolean;
}

export interface YagrRunOptions extends YagrLanguageModelConfig {
  abortSignal?: AbortSignal;
  maxSteps?: number;
  rememberConversation?: boolean;
  historyLimit?: number;
  charsPerToken?: number;
  contextWindowTokens?: number;
  reservedOutputTokens?: number;
  satisfiedRequiredActionIds?: string[];
  display?: YagrDisplayOptions;
  runtimeHooks?: YagrRuntimeHook[];
  onCompaction?: (event: YagrContextCompactionEvent) => void | Promise<void>;
  onContextUsage?: (event: YagrContextUsageEvent) => void | Promise<void>;
  onTextDelta?: (textDelta: string) => void | Promise<void>;
  onStepFinish?: (step: YagrRunStep) => void | Promise<void>;
  onPhaseChange?: (phase: YagrPhaseEvent) => void | Promise<void>;
  onStateChange?: (state: YagrStateEvent) => void | Promise<void>;
  onJournalEntry?: (entry: YagrRunJournalEntry) => void | Promise<void>;
  onToolEvent?: (event: YagrToolEvent) => void | Promise<void>;
}

export interface YagrRunResult {
  runId: string;
  text: string;
  finishReason: string;
  steps: number;
  toolCalls: Array<{ toolName: string }>;
  completionAccepted: boolean;
  requiredActions: YagrRequiredAction[];
  compactions: YagrContextCompactionEvent[];
  finalState: YagrAgentState;
  finalPhase: YagrRunPhase;
  journal: YagrRunJournalEntry[];
  sessionInvalidated?: boolean;
  sessionInvalidationReason?: string;
}
