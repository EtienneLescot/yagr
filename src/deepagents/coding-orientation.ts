import { createMiddleware, SystemMessage } from 'langchain';

export const CODING_ORIENTATION_SYSTEM_PROMPT = [
  'Operate as a coding-focused agent.',
  'Read the relevant repository files before making changes.',
  'When the user asks for code changes, prefer making the smallest correct edit in the workspace over giving advice only.',
  'Prefer repository evidence over assumptions and verify with the smallest relevant build, typecheck, or test command after edits.',
  'Keep changes explicit and local; avoid speculative rewrites or ad-hoc scripting when normal filesystem and shell usage is sufficient.',
].join(' ');

export function createCodingOrientationMiddleware(
  prompt: string = CODING_ORIENTATION_SYSTEM_PROMPT,
) {
  return createMiddleware({
    name: 'YagrCodingOrientationMiddleware',
    wrapModelCall(request, handler) {
      return handler({
        ...request,
        systemMessage: request.systemMessage.concat(
          new SystemMessage({ content: prompt }),
        ),
      });
    },
  });
}

export function getCodingOrientedDeepAgentMiddleware() {
  return [createCodingOrientationMiddleware()];
}