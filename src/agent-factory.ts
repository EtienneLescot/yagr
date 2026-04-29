/**
 * Yagr deep-agent factory.
 *
 * Keeps the Yagr runtime close to vanilla `createDeepAgent` while composing
 * a clearly separated coding-oriented middleware overlay:
 *
 *   - pristine deepagents core: host-native backend + native memory and skills loading
 *   - coding-oriented overlay: a dedicated middleware layer with generic
 *     coding guidance only
 *   - checkpointer so per-thread (=per-session) state is maintained and
 *     can be persisted to disk for checkpoint/restore functionality
 *
 * Usage:
 *   const agentHandle = await createYagrDeepAgent(engine, configService);
 *   // agentHandle.agent is a CompiledStateGraph — call streamEvents / invoke
 *   // with { configurable: { thread_id: sessionId } }
 */
import { createDeepAgent } from 'deepagents';
import { MemorySaver } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import type { YagrConfigStoreLike } from './config/yagr-config-service.js';
import { createLangChainModel } from './llm/create-langchain-model.js';
import { getCodingOrientedDeepAgentMiddleware } from './deepagents/coding-orientation.js';
import { buildPristineDeepAgentConfig, getPristineDeepAgentMemorySources } from './deepagents/pristine.js';
import { getYagrHomeDir } from './config/yagr-home.js';
import type { YagrRunOptions } from './types.js';
import { CompactionService } from './compaction/compaction-service.js';
import { getDeepAgentSkillSourcePaths } from './skills/agent-skills.js';

/** Returned by `createYagrDeepAgent`. */
export interface YagrDeepAgentHandle {
  /** The compiled LangGraph agent — call `streamEvents` or `invoke`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent: ReturnType<typeof createDeepAgent>;
  /** The checkpointer — shared across calls so per-thread state persists. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  checkpointer: any;
  /** Compaction service — tracks context compaction events and history. */
  compactionService: CompactionService;
}

export const getYagrAgentMemorySources = getPristineDeepAgentMemorySources;
export const getYagrAgentSkillSourcePaths = getDeepAgentSkillSourcePaths;

/**
 * Instantiate a Yagr-configured deep agent.
 *
 * This should be called once per active engine instance.  When the engine
 * is invalidated by runtime configuration changes, discard the handle and call this
 * again; the new handle will use a fresh checkpointer so session history
 * starts over — matching the current behaviour where `agents.clear()` is
 * called on config change.
 *
 * @param configStore Optional config store to read LLM defaults from.
 * @param modelConfig Optional explicit model overrides (provider, model, apiKey, baseUrl).
 * @param checkpointer Optional checkpointer instance. If not provided, a new MemorySaver is created.
 * @param runOptions Optional run options including compaction configuration.
 */
export async function createYagrDeepAgent(
  configStore?: YagrConfigStoreLike,
  modelConfig?: { provider?: string; model?: string; apiKey?: string; baseUrl?: string },
  checkpointer?: BaseCheckpointSaver,
  runOptions?: YagrRunOptions,
): Promise<YagrDeepAgentHandle> {
  const model = await createLangChainModel(modelConfig, configStore);
  const checkpointerInstance = checkpointer ?? new MemorySaver();

  const compactionService = new CompactionService({
    historyLimit: runOptions?.historyLimit ?? 50,
  });

  const agent = createDeepAgent({
    ...buildPristineDeepAgentConfig({
      model,
      checkpointer: checkpointerInstance,
      rootDir: getYagrHomeDir(),
      skills: getDeepAgentSkillSourcePaths(),
    }),
    middleware: getCodingOrientedDeepAgentMiddleware(),
  });

  return { agent, checkpointer: checkpointerInstance, compactionService };
}
