import type {
  DeployedWorkflow,
  GeneratedWorkflow,
  NodeSummary,
  TemplateSummary,
  WorkflowSpec,
  WorkflowValidationResult,
} from '../types.js';

export interface EngineIdentityPort {
  readonly name: 'n8n' | 'yagr-engine';
}

export interface NodeCatalogPort extends EngineIdentityPort {
  searchNodes(query: string): Promise<NodeSummary[]>;
  nodeInfo(type: string): Promise<unknown>;
}

export interface TemplateCatalogPort extends EngineIdentityPort {
  searchTemplates(query: string): Promise<TemplateSummary[]>;
}

export interface WorkflowCompilerPort extends EngineIdentityPort {
  generateWorkflow(spec: WorkflowSpec): Promise<GeneratedWorkflow>;
}

export interface WorkflowValidatorPort extends EngineIdentityPort {
  validate(workflow: GeneratedWorkflow): Promise<WorkflowValidationResult>;
}

export interface WorkflowLifecyclePort extends EngineIdentityPort {
  deploy(workflow: GeneratedWorkflow): Promise<DeployedWorkflow>;
  listWorkflows(): Promise<DeployedWorkflow[]>;
  activateWorkflow(id: string): Promise<void>;
  deactivateWorkflow(id: string): Promise<void>;
  deleteWorkflow(id: string): Promise<void>;
}

export interface EngineRuntimePort extends
  EngineIdentityPort,
  NodeCatalogPort,
  TemplateCatalogPort,
  WorkflowLifecyclePort {}

export interface Engine extends
  NodeCatalogPort,
  TemplateCatalogPort,
  WorkflowCompilerPort,
  WorkflowValidatorPort,
  WorkflowLifecyclePort {}
