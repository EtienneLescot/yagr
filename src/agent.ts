import type { Engine } from './engine/engine.js';
import type { CoreMessage } from 'ai';
import { YagrRunEngine } from './runtime/run-engine.js';
import type {
  DeployedWorkflow,
  GeneratedWorkflow,
  YagrRunOptions,
  YagrRunResult,
  WorkflowSpec,
  WorkflowValidationResult,
} from './types.js';

export class YagrAgent {
  private readonly history: CoreMessage[] = [];

  constructor(private readonly engine: Engine) {}

  async plan(spec: WorkflowSpec): Promise<GeneratedWorkflow> {
    return this.engine.generateWorkflow(spec);
  }

  async validate(generatedWorkflow: GeneratedWorkflow): Promise<WorkflowValidationResult> {
    return this.engine.validate(generatedWorkflow);
  }

  async create(spec: WorkflowSpec): Promise<{ workflow: GeneratedWorkflow; validation: WorkflowValidationResult; deployed?: DeployedWorkflow }> {
    const workflow = await this.plan(spec);
    const validation = await this.validate(workflow);

    if (!validation.valid) {
      return { workflow, validation };
    }

    const deployed = await this.engine.deploy(workflow);
    return { workflow, validation, deployed };
  }

  async list(): Promise<DeployedWorkflow[]> {
    return this.engine.listWorkflows();
  }

  async activate(id: string): Promise<void> {
    return this.engine.activateWorkflow(id);
  }

  async deactivate(id: string): Promise<void> {
    return this.engine.deactivateWorkflow(id);
  }

  async delete(id: string): Promise<void> {
    return this.engine.deleteWorkflow(id);
  }

  async run(prompt: string, options: YagrRunOptions = {}): Promise<YagrRunResult> {
    const runner = new YagrRunEngine(this.engine, this.history);
    const { result, persistedMessages } = await runner.execute(prompt, options);

    if (options.rememberConversation !== false) {
      this.history.push(...persistedMessages);
    }

    return result;
  }

  clearConversation(): void {
    this.history.length = 0;
  }
}
