import { createDeepAgent } from 'deepagents';

export type CreateDeepAgentRuntimeParams = Parameters<typeof createDeepAgent>[0];

export function createDeepAgentRuntime(
  params: CreateDeepAgentRuntimeParams,
): ReturnType<typeof createDeepAgent> {
  return createDeepAgent(params);
}
