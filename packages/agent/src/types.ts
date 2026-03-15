import type { N8nWorkflow } from '@n8n-as-code/transformer';
import type { ValidationResult as SkillsValidationResult } from '@n8n-as-code/skills';
import type { HolonLanguageModelConfig, HolonModelProvider } from './llm/create-language-model.js';

export type EngineName = 'n8n' | 'holon-engine';

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
  sourceType: 'n8n-json' | 'holon-python';
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

export type { HolonLanguageModelConfig, HolonModelProvider };

export type HolonRunPhase = 'inspect' | 'plan' | 'edit' | 'validate' | 'sync' | 'verify' | 'summarize';

export interface HolonToolCallTrace {
  toolName: string;
  args: unknown;
}

export interface HolonToolResultTrace {
  toolName: string;
  result: unknown;
}

export type HolonToolEvent =
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

export interface HolonRunStep {
  stepNumber: number;
  stepType: string;
  finishReason: string;
  toolCalls: HolonToolCallTrace[];
  toolResults: HolonToolResultTrace[];
  text: string;
  phase: HolonRunPhase;
}

export interface HolonPhaseEvent {
  phase: HolonRunPhase;
  status: 'started' | 'completed';
  message: string;
}

export interface HolonRunJournalEntry {
  timestamp: string;
  type: 'run' | 'phase' | 'step';
  status: 'started' | 'completed' | 'failed';
  message: string;
  phase?: HolonRunPhase;
  stepNumber?: number;
  runId?: string;
  step?: HolonRunStep;
}

export interface HolonRunOptions extends HolonLanguageModelConfig {
  maxSteps?: number;
  rememberConversation?: boolean;
  onTextDelta?: (textDelta: string) => void | Promise<void>;
  onStepFinish?: (step: HolonRunStep) => void | Promise<void>;
  onPhaseChange?: (phase: HolonPhaseEvent) => void | Promise<void>;
  onJournalEntry?: (entry: HolonRunJournalEntry) => void | Promise<void>;
  onToolEvent?: (event: HolonToolEvent) => void | Promise<void>;
}

export interface HolonRunResult {
  runId: string;
  text: string;
  finishReason: string;
  steps: number;
  toolCalls: Array<{ toolName: string }>;
  finalPhase: HolonRunPhase;
  journal: HolonRunJournalEntry[];
}
