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
 * Uses the yagr home directory (e.g. ~/.yagr), not process.cwd(),
 * so the local coding agent resolves relative paths from a stable runtime root.
 */
export function getRuntimePathAnchorPrompt(): string {
  return `Backend working directory: ${getYagrHomeDir()}`;
}

export interface CodingOrientationMiddlewareOptions {
  runtimePathAnchor?: string;
}

export function createCodingOrientationMiddleware(
  prompt: string = CODING_ORIENTATION_SYSTEM_PROMPT,
  options: CodingOrientationMiddlewareOptions = {},
) {
  return createMiddleware({
    name: 'YagrCodingOrientationMiddleware',
    wrapModelCall(request, handler) {
      const parts = [prompt, options.runtimePathAnchor ?? getRuntimePathAnchorPrompt()];
      return handler({
        ...request,
        systemMessage: request.systemMessage.concat(
          new SystemMessage({ content: parts.join('\n\n') }),
        ),
      });
    },
  });
}

export function createEditFileToolInputNormalizerMiddleware() {
  return createMiddleware({
    name: 'YagrEditFileToolInputNormalizerMiddleware',
    wrapToolCall(request, handler) {
      if (request.toolCall.name !== 'edit_file') {
        return handler(request);
      }

      const args = request.toolCall.args;
      if (!args || typeof args !== 'object' || Array.isArray(args) || (args as Record<string, unknown>).replace_all !== null) {
        return handler(request);
      }

      const normalizedArgs = { ...(args as Record<string, unknown>) };
      delete normalizedArgs.replace_all;
      return handler({
        ...request,
        toolCall: {
          ...request.toolCall,
          args: normalizedArgs,
        },
      });
    },
  });
}

export function getCodingOrientedDeepAgentMiddleware(options: CodingOrientationMiddlewareOptions = {}) {
  return [
    createCodingOrientationMiddleware(CODING_ORIENTATION_SYSTEM_PROMPT, options),
    createEditFileToolInputNormalizerMiddleware(),
    createInjectMemoryMiddleware(),
  ];
}
