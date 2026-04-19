import type { N8nWorkflow } from '@n8n-as-code/transformer';
import type { ValidationResult as SkillsValidationResult } from '@n8n-as-code/skills';
import type { YagrLanguageModelConfig } from './llm/create-langchain-model.js';
import type { YagrModelProvider } from './llm/provider-registry.js';

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

export type YagrRunPhase = 'inspect' | 'plan' | 'edit' | 'summarize';

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
  blocking?: boolean;
}

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
  workflowId?: string;
  workflowUrl?: string;
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
    }
  | {
      type: 'embed';
      toolName: string;
      kind: 'workflow';
      workflowId: string;
      url: string;
      targetUrl?: string;
      via?: 'direct' | 'self-contained-auth';
      title?: string;
      diagram?: string;
      executionResult?: {
        status: 'success' | 'error' | 'waiting';
        executionId?: string;
        summary?: string;
        data?: string;
      };
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

export interface YagrContextUsageEvent {
  /** Tokens used by the prompt (input), as reported by the API or estimated from content length. */
  promptTokens: number;
  /** Tokens generated in the last completion step. */
  completionTokens: number;
  /** Maximum context window for the active model. */
  contextWindowTokens: number;
  /** Percentage of the context window consumed by the current prompt (0–100). */
  fillPercent: number;
  /** Whether the counts come from the API response or from a character-length estimate. */
  source: 'api' | 'estimated';
}

export type YagrOperationStatus = 'running' | 'done' | 'error';

export type YagrOperationCategory =
  | 'file-read'
  | 'file-write'
  | 'shell'
  | 'web'
  | 'tool'
  | 'agent'
  | 'phase'
  | 'thinking';

export interface YagrOperationEvent {
  kind: 'operation';
  /** Unique identifier for this operation instance. */
  operationId: string;
  /** Human-readable label: "Read src/foo.ts", "Shell: npm test", "Thinking…" */
  label: string;
  /** Semantic category driving icon and colour. */
  category: YagrOperationCategory;
  status: YagrOperationStatus;
  /** Full body: stdout, file excerpt, thinking tokens… May be capped depending on the producer. */
  body?: string;
  /** One-line summary for compact views (≤ 120 chars). */
  summary?: string;
  startedAt: number;
  endedAt?: number;
  phase?: YagrRunPhase;
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
