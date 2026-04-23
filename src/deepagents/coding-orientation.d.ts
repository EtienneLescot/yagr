export declare const CODING_ORIENTATION_SYSTEM_PROMPT: string;
/**
 * Returns the runtime path anchor injected into every system message.
 * Uses the yagr home directory (e.g. ~/.yagr) — not process.cwd() —
 * because n8n-workspace and all yagr-managed files live there.
 * Without this anchor the agent guesses paths like /n8n-workspace
 * instead of the correct ~/.yagr/n8n-workspace.
 */
export declare function getRuntimePathAnchorPrompt(): string;
export declare function createCodingOrientationMiddleware(prompt?: string): import("langchain").AgentMiddleware<undefined, undefined, unknown, readonly (import("@langchain/core/tools").ClientTool | import("@langchain/core/tools").ServerTool)[]>;
export declare function getCodingOrientedDeepAgentMiddleware(): (import("langchain").AgentMiddleware<undefined, undefined, unknown, readonly [import("langchain").DynamicStructuredTool<import("zod").ZodObject<{
    path: import("zod").ZodString;
}, "strip", import("zod").ZodTypeAny, {
    path: string;
}, {
    path: string;
}>, {
    path: string;
}, {
    path: string;
}, string, unknown, "inject_memory">]> | import("langchain").AgentMiddleware<undefined, undefined, unknown, readonly (import("@langchain/core/tools").ClientTool | import("@langchain/core/tools").ServerTool)[]>)[];
//# sourceMappingURL=coding-orientation.d.ts.map