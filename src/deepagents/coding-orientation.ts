import fs from 'node:fs';
import { createMiddleware, SystemMessage } from 'langchain';
import { createInjectMemoryMiddleware } from './inject-memory.js';
import { getYagrHomeDir, resolveBundledManagerInstructionsPath } from '../config/yagr-home.js';

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
export function getRuntimePathAnchorPrompt(): string {
  return `Backend working directory: ${getYagrHomeDir()}`;
}

/**
 * Load the bundled manager instructions (YAGENTS.md) at middleware creation time.
 *
 * We inject the content directly into the system message instead of loading
 * it as a deepagents memory file. When loaded via memory, deepagents prefixes
 * the system prompt with the source file path, which caused the agent to
 * anchor itself to the package dist directory instead of ~/.yagr.
 *
 * Direct injection avoids any file path being surfaced to the agent.
 */
function loadBundledManagerInstructions(): string | null {
  const bundledPath = resolveBundledManagerInstructionsPath();
  if (!bundledPath) return null;
  try {
    return fs.readFileSync(bundledPath, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

export function createCodingOrientationMiddleware(
  prompt: string = CODING_ORIENTATION_SYSTEM_PROMPT,
) {
  const managerInstructions = loadBundledManagerInstructions();

  return createMiddleware({
    name: 'YagrCodingOrientationMiddleware',
    wrapModelCall(request, handler) {
      const parts = [prompt, getRuntimePathAnchorPrompt()];
      if (managerInstructions) parts.push(managerInstructions);
      return handler({
        ...request,
        systemMessage: request.systemMessage.concat(
          new SystemMessage({ content: parts.join('\n\n') }),
        ),
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
