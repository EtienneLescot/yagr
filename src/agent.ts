import type { EngineIdentityPort, EngineRuntimePort } from './engine/engine.js';
import type { CoreMessage } from 'ai';
import { buildSystemPromptSnapshot, type SystemPromptSnapshot } from './prompt/build-system-prompt.js';
import { YagrRunEngine } from './runtime/run-engine.js';
import { compactConversationContext } from './runtime/context-compaction.js';
import { resolveLanguageModelConfig, resolveModelContextProfile } from './llm/create-language-model.js';
import type {
  YagrContextCompactionEvent,
  YagrLanguageModelConfig,
  YagrRunOptions,
  YagrRunResult,
} from './types.js';

type YagrRunEngineLike = Pick<YagrRunEngine, 'execute'>;

interface YagrSessionAgentDependencies {
  buildPromptSnapshot?: (engine: EngineIdentityPort) => SystemPromptSnapshot;
  createRunner?: (engine: EngineRuntimePort, history: readonly CoreMessage[], systemPrompt: string) => YagrRunEngineLike;
  initialHistory?: readonly CoreMessage[];
}

export class YagrSessionAgent {
  private readonly history: CoreMessage[] = [];
  private promptSnapshot: SystemPromptSnapshot;

  constructor(
    protected readonly runtimeEngine: EngineRuntimePort,
    private readonly dependencies: YagrSessionAgentDependencies = {},
  ) {
    if (dependencies.initialHistory?.length) {
      this.history.push(...dependencies.initialHistory);
    }

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

  /**
   * Force-compacts the conversation history by summarising older messages
   * via an LLM call. Updates the in-memory history in place.
   * Returns the compaction event if compaction happened, undefined otherwise.
   */
  async compactHistory(config: YagrLanguageModelConfig = {}): Promise<YagrContextCompactionEvent | undefined> {
    if (this.history.length < 2) {
      return undefined;
    }

    const resolvedConfig = resolveLanguageModelConfig(config);
    const contextProfile = resolveModelContextProfile(resolvedConfig);
    const result = await compactConversationContext({
      messages: [...this.history],
      prompt: '',
      journal: [],
      systemPrompt: this.promptSnapshot.systemPrompt,
      budget: {
        contextWindowTokens: contextProfile.contextWindowTokens,
        reservedOutputTokens: contextProfile.reservedOutputTokens,
        thresholdPercent: 0, // force compaction regardless of fill level
      },
      llmConfig: resolvedConfig,
    });

    if (result.event) {
      this.history.length = 0;
      this.history.push(...result.messages);
    }

    return result.event;
  }

  get messages(): readonly CoreMessage[] {
    return this.history;
  }

  private createPromptSnapshot(): SystemPromptSnapshot {
    return (this.dependencies.buildPromptSnapshot ?? buildSystemPromptSnapshot)(this.runtimeEngine);
  }

  private createRunner(): YagrRunEngineLike {
    return (this.dependencies.createRunner ?? ((_engine, history, systemPrompt) => new YagrRunEngine(history, systemPrompt))) (
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
