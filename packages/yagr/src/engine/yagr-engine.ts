import type {
  DeployedWorkflow,
  GeneratedWorkflow,
  NodeSummary,
  TemplateSummary,
  WorkflowSpec,
  WorkflowValidationResult,
} from '../types.js';
import type { Engine } from './engine.js';

export class YagrNativeEngine implements Engine {
  public readonly name = 'yagr-engine' as const;

  private unsupported(): never {
    throw new Error('YagrNativeEngine is a V2 stub and is not implemented yet.');
  }

  async searchNodes(_query: string): Promise<NodeSummary[]> {
    this.unsupported();
  }

  async nodeInfo(_type: string): Promise<unknown> {
    this.unsupported();
  }

  async searchTemplates(_query: string): Promise<TemplateSummary[]> {
    this.unsupported();
  }

  async generateWorkflow(_spec: WorkflowSpec): Promise<GeneratedWorkflow> {
    this.unsupported();
  }

  async validate(_workflow: GeneratedWorkflow): Promise<WorkflowValidationResult> {
    this.unsupported();
  }

  async deploy(_workflow: GeneratedWorkflow): Promise<DeployedWorkflow> {
    this.unsupported();
  }

  async listWorkflows(): Promise<DeployedWorkflow[]> {
    this.unsupported();
  }

  async activateWorkflow(_id: string): Promise<void> {
    this.unsupported();
  }

  async deactivateWorkflow(_id: string): Promise<void> {
    this.unsupported();
  }

  async deleteWorkflow(_id: string): Promise<void> {
    this.unsupported();
  }
}
