/**
 * Inject Memory middleware for yagr-agent.
 *
 * Exposes an `inject_memory` tool the agent can call to load an AGENTS.md
 * (or any instruction file) into persistent session memory.  Once injected,
 * the file content is re-appended to the system prompt on every subsequent
 * model call for the lifetime of the middleware instance (= process session).
 *
 * Design:
 *   - An in-memory Map (closure) stores injected paths → content.
 *     This avoids returning a LangGraph `Command` from the tool, which can
 *     confuse deepagents' tool-result handling and cause the LLM to loop.
 *   - The tool is idempotent: calling it twice on the same path returns a
 *     clear "already active" confirmation so the LLM does not retry.
 *   - `wrapModelCall` reads the Map and appends an `<injected_context>`
 *     block to the system message on every LLM call.
 */
import { z } from 'zod';
export declare function createInjectMemoryMiddleware(): import("langchain").AgentMiddleware<undefined, undefined, unknown, readonly [import("langchain").DynamicStructuredTool<z.ZodObject<{
    path: z.ZodString;
}, "strip", z.ZodTypeAny, {
    path: string;
}, {
    path: string;
}>, {
    path: string;
}, {
    path: string;
}, string, unknown, "inject_memory">]>;
//# sourceMappingURL=inject-memory.d.ts.map