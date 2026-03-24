import type { Engine, EngineIdentityPort, EngineRuntimePort } from './engine/engine.js';
import type { CoreMessage } from 'ai';
import { buildSystemPromptSnapshot, type SystemPromptSnapshot } from './prompt/build-system-prompt.js';
import { YagrRunEngine } from './runtime/run-engine.js';
import type {
  DeployedWorkflow,
  GeneratedWorkflow,
  YagrRunOptions,
  YagrRunResult,
  WorkflowSpec,
  WorkflowValidationResult,
} from './types.js';

type YagrRunEngineLike = Pick<YagrRunEngine, 'execute'>;

interface YagrSessionAgentDependencies {
  buildPromptSnapshot?: (engine: EngineIdentityPort) => SystemPromptSnapshot;
  createRunner?: (engine: EngineRuntimePort, history: readonly CoreMessage[], systemPrompt: string) => YagrRunEngineLike;
}

export class YagrSessionAgent {
  private readonly history: CoreMessage[] = [];
  private promptSnapshot: SystemPromptSnapshot;

  constructor(
    protected readonly runtimeEngine: EngineRuntimePort,
    private readonly dependencies: YagrSessionAgentDependencies = {},
  ) {
    this.promptSnapshot = this.createPromptSnapshot();
  }

  async run(prompt: string, options: YagrRunOptions = {}): Promise<YagrRunResult> {
    this.syncPromptSnapshotBeforeRun();

    const runner = this.createRunner();
    const { result, persistedMessages, workspaceInstructionsMayHaveChanged } = await runner.execute(prompt, options);

    if (workspaceInstructionsMayHaveChanged) {
      const nextSnapshot = this.createPromptSnapshot();
      const promptChanged = nextSnapshot.systemPrompt !== this.promptSnapshot.systemPrompt;

      this.promptSnapshot = nextSnapshot;

      if (promptChanged) {
        this.history.length = 0;
        result.sessionInvalidated = true;
        result.sessionInvalidationReason = 'Workspace instructions changed during the run. Conversation history was cleared and future runs will use the refreshed instruction set.';
      }
    }

    if (options.rememberConversation !== false && !result.sessionInvalidated) {
      this.history.push(...persistedMessages);
    }

    return result;
  }

  clearConversation(): void {
    this.history.length = 0;
    this.promptSnapshot = this.createPromptSnapshot();
  }

  private createPromptSnapshot(): SystemPromptSnapshot {
    return (this.dependencies.buildPromptSnapshot ?? buildSystemPromptSnapshot)(this.runtimeEngine);
  }

  private createRunner(): YagrRunEngineLike {
    return (this.dependencies.createRunner ?? ((engine, history, systemPrompt) => new YagrRunEngine(engine, history, systemPrompt))) (
      this.runtimeEngine,
      this.history,
      this.promptSnapshot.systemPrompt,
    );
  }

  private syncPromptSnapshotBeforeRun(): void {
    const nextSnapshot = this.createPromptSnapshot();
    if (nextSnapshot.systemPrompt === this.promptSnapshot.systemPrompt) {
      return;
    }

    this.history.length = 0;
    this.promptSnapshot = nextSnapshot;
  }
}

export class YagrAgent extends YagrSessionAgent {
  constructor(
    private readonly engine: Engine,
    dependencies: YagrSessionAgentDependencies = {},
  ) {
    super(engine, dependencies);
  }

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
}
