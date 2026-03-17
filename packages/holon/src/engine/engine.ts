import type {
  DeployedWorkflow,
  GeneratedWorkflow,
  NodeSummary,
  TemplateSummary,
  WorkflowSpec,
  WorkflowValidationResult,
} from '../types.js';

export interface Engine {
  readonly name: 'n8n' | 'holon-engine';

  searchNodes(query: string): Promise<NodeSummary[]>;
  nodeInfo(type: string): Promise<unknown>;
  searchTemplates(query: string): Promise<TemplateSummary[]>;

  generateWorkflow(spec: WorkflowSpec): Promise<GeneratedWorkflow>;
  validate(workflow: GeneratedWorkflow): Promise<WorkflowValidationResult>;

  deploy(workflow: GeneratedWorkflow): Promise<DeployedWorkflow>;
  listWorkflows(): Promise<DeployedWorkflow[]>;
  activateWorkflow(id: string): Promise<void>;
  deactivateWorkflow(id: string): Promise<void>;
  deleteWorkflow(id: string): Promise<void>;
}
