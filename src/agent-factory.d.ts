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
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import type { YagrConfigStoreLike } from './config/yagr-config-service.js';
import { getPristineDeepAgentMemorySources } from './deepagents/pristine.js';
import type { YagrRunOptions } from './types.js';
import { CompactionService } from './compaction/compaction-service.js';
/** Returned by `createYagrDeepAgent`. */
export interface YagrDeepAgentHandle {
    /** The compiled LangGraph agent — call `streamEvents` or `invoke`. */
    agent: ReturnType<typeof createDeepAgent>;
    /** The checkpointer — shared across calls so per-thread state persists. */
    checkpointer: any;
    /** Compaction service — tracks context compaction events and history. */
    compactionService: CompactionService;
}
export declare const getYagrAgentMemorySources: typeof getPristineDeepAgentMemorySources;
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
export declare function createYagrDeepAgent(configStore?: YagrConfigStoreLike, modelConfig?: {
    provider?: string;
    model?: string;
    apiKey?: string;
    baseUrl?: string;
}, checkpointer?: BaseCheckpointSaver, runOptions?: YagrRunOptions): Promise<YagrDeepAgentHandle>;
//# sourceMappingURL=agent-factory.d.ts.map