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
import fs from 'node:fs/promises';
import path from 'node:path';
import { tool } from '@langchain/core/tools';
import { createMiddleware, SystemMessage } from 'langchain';
import { z } from 'zod';
const INJECT_MEMORY_TOOL_NAME = 'inject_memory';
export function createInjectMemoryMiddleware() {
    // Closure Map: survives the full process session (same lifetime as the agent).
    const injected = new Map();
    const injectMemoryTool = tool(async ({ path: filePath }) => {
        const resolved = path.resolve(filePath);
        if (injected.has(resolved)) {
            return (`✅ Already active: "${resolved}" is already injected and governing this session. ` +
                `Do NOT call inject_memory again — proceed directly with the user's request.`);
        }
        try {
            const content = await fs.readFile(resolved, 'utf-8');
            injected.set(resolved, content);
            return (`✅ Injected: "${resolved}" (${content.length} chars) is now active for this session. ` +
                `Do NOT call inject_memory again — proceed directly with the user's request.`);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return `❌ inject_memory failed for "${resolved}": ${msg}`;
        }
    }, {
        name: INJECT_MEMORY_TOOL_NAME,
        description: 'Inject an AGENTS.md or instruction file into persistent session memory. ' +
            'Call this ONCE before any other action when a workspace-specific AGENTS.md is required. ' +
            'If the tool returns "Already active", do NOT call it again — the instructions are already in effect.',
        schema: z.object({
            path: z
                .string()
                .describe('Absolute path to the instruction file to inject (e.g. AGENTS.md).'),
        }),
    });
    return createMiddleware({
        name: 'YagrInjectMemoryMiddleware',
        tools: [injectMemoryTool],
        wrapModelCall(request, handler) {
            if (injected.size === 0) {
                return handler(request);
            }
            const sections = Array.from(injected.entries())
                .map(([p, content]) => `<!-- source: ${p} -->\n${content}`)
                .join('\n\n');
            const injectedSection = new SystemMessage({
                content: `<injected_context>\n${sections}\n</injected_context>`,
            });
            return handler({
                ...request,
                systemMessage: request.systemMessage.concat(injectedSection),
            });
        },
    });
}
//# sourceMappingURL=inject-memory.js.map