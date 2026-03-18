import type { N8nWorkflow } from '@n8n-as-code/transformer';
import type { ValidationResult as SkillsValidationResult } from '@n8n-as-code/skills';
import type { YagrLanguageModelConfig, YagrModelProvider } from './llm/create-language-model.js';

export type EngineName = 'n8n' | 'yagr-engine';

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

export interface WorkflowSpecNode {
  name: string;
  type: string;
  parameters: Record<string, unknown>;
  typeVersion?: number;
  position?: [number, number];
  credentials?: Record<string, { id?: string; name?: string }>;
}

export interface WorkflowSpecConnection {
  from: string;
  to: string;
  type?: string;
  index?: number;
}

export type WorkflowSpecConnections =
  | WorkflowSpecConnection[]
  | Record<string, Record<string, Array<Array<{ node: string; type: string; index?: number }>>>>
  | Record<string, WorkflowSpecConnection[]>;

export interface WorkflowSpec {
  name: string;
  nodes: WorkflowSpecNode[];
  connections: WorkflowSpecConnections;
  active?: boolean;
}

export interface CredentialRequirement {
  nodeName: string;
  credentialType: string;
  displayName: string;
  required: boolean;
  status: 'missing' | 'linked' | 'unknown';
  helpUrl?: string;
}

export interface GeneratedWorkflow {
  engine: EngineName;
  name: string;
  sourceType: 'n8n-json' | 'yagr-python';
  definition: N8nWorkflow | string;
  credentialRequirements: CredentialRequirement[];
}

export interface DeployedWorkflow {
  id: string;
  engine: EngineName;
  name: string;
  active: boolean;
  workflowUrl?: string;
  credentialRequirements: CredentialRequirement[];
}

export interface WorkflowValidationResult {
  valid: boolean;
  errors: SkillsValidationResult['errors'];
  warnings: SkillsValidationResult['warnings'];
}

export interface N8nEngineConfig {
  host: string;
  apiKey: string;
  syncFolder: string;
  projectId: string;
  projectName: string;
  instanceIdentifier?: string;
}

export type { YagrLanguageModelConfig, YagrModelProvider };

export type YagrRunPhase = 'inspect' | 'plan' | 'edit' | 'validate' | 'sync' | 'verify' | 'summarize';

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

export type YagrRequiredActionKind = 'input' | 'permission' | 'external';

export interface YagrRequiredAction {
  id: string;
  kind: YagrRequiredActionKind;
  title: string;
  message: string;
  detail?: string;
  resumable: boolean;
}

export interface YagrToolCallTrace {
  toolName: string;
  args: unknown;
}

export interface YagrToolResultTrace {
  toolName: string;
  result: unknown;
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
    }
  | {
      type: 'embed';
      toolName: string;
      kind: 'workflow';
      workflowId: string;
      url: string;
      title?: string;
      diagram?: string;
    };

export interface YagrRunStep {
  stepNumber: number;
  stepType: string;
  finishReason: string;
  toolCalls: YagrToolCallTrace[];
  toolResults: YagrToolResultTrace[];
  text: string;
  phase: YagrRunPhase;
}

export interface YagrPhaseEvent {
  phase: YagrRunPhase;
  status: 'started' | 'completed';
  message: string;
}

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

export interface YagrContextCompactionEvent {
  summary: string;
  source: 'llm' | 'fallback';
  estimatedTokens: number;
  thresholdTokens: number;
  messagesCompacted: number;
  preservedRecentMessages: number;
  fallbackReason?: string;
}

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
  autoCompactContext?: boolean;
  compactContextThresholdPercent?: number;
  compactPreserveRecentMessages?: number;
  charsPerToken?: number;
  contextWindowTokens?: number;
  reservedOutputTokens?: number;
  satisfiedRequiredActionIds?: string[];
  display?: YagrDisplayOptions;
  runtimeHooks?: YagrRuntimeHook[];
  onCompaction?: (event: YagrContextCompactionEvent) => void | Promise<void>;
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
}
