import { createMiddleware, SystemMessage } from 'langchain';
import { createInjectMemoryMiddleware } from './inject-memory.js';
import { getYagrHomeDir } from '../config/yagr-home.js';
export const CODING_ORIENTATION_SYSTEM_PROMPT = [
    'Operate as a coding-focused agent.',
    'Read the relevant repository files before making changes.',
    'When the user asks for code changes, prefer making the smallest correct edit in the workspace over giving advice only.',
    'Prefer repository evidence over assumptions and verify with the smallest relevant build, typecheck, or test command after edits.',
    'Keep changes explicit and local; avoid speculative rewrites or ad-hoc scripting when normal filesystem and shell usage is sufficient.',
].join(' ');
/**
 * Returns the runtime path anchor injected into every system message.
 * Uses the yagr home directory (e.g. ~/.yagr) — not process.cwd() —
 * because n8n-workspace and all yagr-managed files live there.
 * Without this anchor the agent guesses paths like /n8n-workspace
 * instead of the correct ~/.yagr/n8n-workspace.
 */
export function getRuntimePathAnchorPrompt() {
    return `Backend working directory: ${getYagrHomeDir()}`;
}
export function createCodingOrientationMiddleware(prompt = CODING_ORIENTATION_SYSTEM_PROMPT) {
    return createMiddleware({
        name: 'YagrCodingOrientationMiddleware',
        wrapModelCall(request, handler) {
            const parts = [prompt, getRuntimePathAnchorPrompt()];
            return handler({
                ...request,
                systemMessage: request.systemMessage.concat(new SystemMessage({ content: parts.join('\n\n') })),
            });
        },
    });
}
export function getCodingOrientedDeepAgentMiddleware() {
    return [
        createCodingOrientationMiddleware(),
        createInjectMemoryMiddleware(),
    ];
}
//# sourceMappingURL=coding-orientation.js.map