/**
 * Yagr deep-agent factory.
 *
 * Keeps the Yagr runtime close to vanilla `createDeepAgent` while composing
 * a clearly separated coding-oriented middleware overlay:
 *
 *   - pristine deepagents core: host-native backend + native memory loading
 *   - coding-oriented overlay: a dedicated middleware layer with generic
 *     coding guidance only
 *   - `MemorySaver` checkpointer so per-thread (=per-session) state is
 *     maintained within the process lifetime
 *
 * Usage:
 *   const agentHandle = await createYagrDeepAgent(engine, configService);
 *   // agentHandle.agent is a CompiledStateGraph — call streamEvents / invoke
 *   // with { configurable: { thread_id: sessionId } }
 */
import { createDeepAgent } from 'deepagents';
import { MemorySaver } from '@langchain/langgraph';
import type { YagrConfigStoreLike } from './config/yagr-config-service.js';
import { createLangChainModel } from './llm/create-langchain-model.js';
import { getCodingOrientedDeepAgentMiddleware } from './deepagents/coding-orientation.js';
import { buildPristineDeepAgentConfig, getPristineDeepAgentMemorySources } from './deepagents/pristine.js';
import { getYagrHomeDir } from './config/yagr-home.js';

/** Returned by `createYagrDeepAgent`. */
export interface YagrDeepAgentHandle {
  /** The compiled LangGraph agent — call `streamEvents` or `invoke`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent: ReturnType<typeof createDeepAgent>;
  /** The checkpointer — shared across calls so per-thread state persists. */
  checkpointer: MemorySaver;
}

export const getYagrAgentMemorySources = getPristineDeepAgentMemorySources;

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
 */
export async function createYagrDeepAgent(
  configStore?: YagrConfigStoreLike,
  modelConfig?: { provider?: string; model?: string; apiKey?: string; baseUrl?: string },
): Promise<YagrDeepAgentHandle> {
  const model = await createLangChainModel(modelConfig, configStore);
  const checkpointer = new MemorySaver();

  const agent = createDeepAgent({
    ...buildPristineDeepAgentConfig({
      model,
      checkpointer,
      // Use the yagr home directory as the shell root so the agent starts
      // in the same directory that the runtime path anchor advertises.
      // This avoids the mismatch where the anchor says ~/.yagr but the shell
      // was actually at process.cwd() (the yagr launch directory).
      rootDir: getYagrHomeDir(),
    }),
    middleware: getCodingOrientedDeepAgentMiddleware(),
  });

  return { agent, checkpointer };
}
