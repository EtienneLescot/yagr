/**
 * Yagr deep-agent factory.
 *
 * Keeps the Yagr runtime close to vanilla `createDeepAgent` while composing
 * a clearly separated coding-oriented middleware overlay:
 *
 *   - pristine deepagents core: host-native backend + native memory loading
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
import { createLangChainModel } from './llm/create-langchain-model.js';
import { getCodingOrientedDeepAgentMiddleware } from './deepagents/coding-orientation.js';
import { buildPristineDeepAgentConfig, getPristineDeepAgentMemorySources } from './deepagents/pristine.js';
import { getYagrHomeDir } from './config/yagr-home.js';
import { CompactionService } from './compaction/compaction-service.js';
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
 * @param checkpointer Optional checkpointer instance. If not provided, a new MemorySaver is created.
 * @param runOptions Optional run options including compaction configuration.
 */
export async function createYagrDeepAgent(configStore, modelConfig, checkpointer, runOptions) {
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
        }),
        middleware: getCodingOrientedDeepAgentMiddleware(),
    });
    return { agent, checkpointer: checkpointerInstance, compactionService };
}
//# sourceMappingURL=agent-factory.js.map