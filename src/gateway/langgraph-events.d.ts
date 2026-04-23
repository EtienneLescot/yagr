/**
 * LangGraph event adapter.
 *
 * Translates the `StreamEvent` objects emitted by `agent.streamEvents()`
 * into the Yagr gateway contracts used by WebUI, Telegram, and TUI:
 *
 *   - Text delta accumulation
 *   - `YagrUserVisibleUpdate` for progress / phase events
 *   - `YagrRequiredAction` collection from `requestRequiredAction` tool output
 *   - Workflow embed extraction from `presentWorkflowResult` tool output
 *   - `write_todos` (deepagents planning tool) mapped to a plan-phase update
 *   - `YagrOperationEvent` for per-tool and thinking operation cards
 *   - `YagrContextCompactionEvent` for context compaction events
 */
import type { StreamEvent } from '@langchain/core/tracers/log_stream';
import type { YagrContextCompactionEvent, YagrOperationEvent, YagrRequiredAction } from '../types.js';
import { type YagrUserVisibleUpdate } from '../runtime/user-visible-updates.js';
import type { WorkflowEmbedPayload } from '../manager-tooling/present-workflow.js';
export interface LangGraphRunAccumulator {
    /** Concatenated response text built from `on_chat_model_stream` deltas. */
    responseText: string;
    /** Required actions raised via `requestRequiredAction` tool calls. */
    requiredActions: YagrRequiredAction[];
    /** Workflow embeds raised via `presentWorkflowResult` tool calls. */
    workflowEmbeds: WorkflowEmbedPayload[];
    /** Accumulated thinking text across the current turn. */
    thinkingText: string;
    /** When the current thinking block started (ms). */
    thinkingStartedAt: number;
    /** Map of event-scoped tool run keys → operation metadata for in-flight tool calls. */
    activeOperations: Map<string, YagrOperationEvent>;
    /** Set to true when a file-modifying tool completes successfully. */
    fileModificationDetected: boolean;
    /** Compaction events that occurred during this run. */
    compactions: YagrContextCompactionEvent[];
}
export interface LangGraphEventCallbacks {
    onTextDelta?: (delta: string) => void | Promise<void>;
    /** Called with each reasoning/thinking text delta from the LLM. */
    onThinkingDelta?: (delta: string) => void | Promise<void>;
    onUserVisibleUpdate?: (update: YagrUserVisibleUpdate) => void | Promise<void>;
    onWorkflowEmbed?: (embed: WorkflowEmbedPayload) => void | Promise<void>;
    /**
     * Called when an operation card is created or updated.
     * Callers patch by `operationId` — a second call for the same id is an update.
     */
    onOperation?: (event: YagrOperationEvent) => void | Promise<void>;
    /** Called when a context compaction event occurs. */
    onCompaction?: (event: YagrContextCompactionEvent) => void | Promise<void>;
}
export declare function createRunAccumulator(): LangGraphRunAccumulator;
export declare function processStreamEvent(event: StreamEvent, accumulator: LangGraphRunAccumulator, callbacks?: LangGraphEventCallbacks): Promise<void>;
/**
 * Extract the text content from the last AI message in a LangGraph invoke result.
 */
export declare function extractLastAiMessage(result: Record<string, unknown>): string;
//# sourceMappingURL=langgraph-events.d.ts.map