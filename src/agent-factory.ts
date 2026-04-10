/**
 * Yagr deep-agent factory.
 *
 * Keeps the Yagr runtime as close as possible to vanilla `createDeepAgent`:
 *
 *   - `LocalShellBackend` — host-native filesystem I/O + shell execution
 *   - Deepagents native `memory` loading for manager and workspace AGENTS files
 *   - `MemorySaver` checkpointer so per-thread (=per-session) state is
 *     maintained within the process lifetime
 *
 * Usage:
 *   const agentHandle = await createYagrDeepAgent(engine, configService);
 *   // agentHandle.agent is a CompiledStateGraph — call streamEvents / invoke
 *   // with { configurable: { thread_id: sessionId } }
 */
import { createDeepAgent, LocalShellBackend } from 'deepagents';
import { MemorySaver } from '@langchain/langgraph';
import type { EngineRuntimePort } from './engine/engine.js';
import type { YagrConfigStoreLike } from './config/yagr-config-service.js';
import { createLangChainModel } from './llm/create-langchain-model.js';

/** Returned by `createYagrDeepAgent`. */
export interface YagrDeepAgentHandle {
  /** The compiled LangGraph agent — call `streamEvents` or `invoke`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent: ReturnType<typeof createDeepAgent>;
  /** The checkpointer — shared across calls so per-thread state persists. */
  checkpointer: MemorySaver;
}

export function getYagrAgentMemorySources(): string[] {
  return [
    '/AGENTS.md',
    '/n8n-workspace/AGENTS.md',
  ];
}

/**
 * Instantiate a Yagr-configured deep agent.
 *
 * This should be called once per active engine instance.  When the engine
 * is invalidated by runtime configuration changes, discard the handle and call this
 * again; the new handle will use a fresh checkpointer so session history
 * starts over — matching the current behaviour where `agents.clear()` is
 * called on config change.
 *
 * @param engine The engine runtime port.
 * @param configStore Optional config store to read LLM defaults from.
 * @param modelConfig Optional explicit model overrides (provider, model, apiKey, baseUrl).
 */
export async function createYagrDeepAgent(
  _engine: EngineRuntimePort,
  configStore?: YagrConfigStoreLike,
  modelConfig?: { provider?: string; model?: string; apiKey?: string; baseUrl?: string },
): Promise<YagrDeepAgentHandle> {
  const model = await createLangChainModel(modelConfig, configStore);
  const checkpointer = new MemorySaver();
  const rootDir = process.cwd();

  const agent = createDeepAgent({
    model,
    checkpointer,
    memory: getYagrAgentMemorySources(),
    backend: new LocalShellBackend({
      rootDir,
      inheritEnv: true,
      // The Yagr home is the real cwd for both file tools and shell commands.
      // Relative paths resolve from YAGR_HOME; absolute paths remain host paths.
    }),
  });

  return { agent, checkpointer };
}
