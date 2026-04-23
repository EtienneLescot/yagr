import { createDeepAgent } from 'deepagents';

export interface CreateDeepAgentRuntimeParams {
  model: unknown;
  checkpointer?: unknown;
  tools?: unknown[];
  systemPrompt?: string;
  middleware?: unknown;
  backend?: unknown;
  memory?: string[];
}

export function createDeepAgentRuntime(
  params: CreateDeepAgentRuntimeParams,
): ReturnType<typeof createDeepAgent> {
  return createDeepAgent({
    model: params.model,
    ...(params.checkpointer ? { checkpointer: params.checkpointer } : {}),
    ...(params.tools ? { tools: params.tools } : {}),
    ...(params.systemPrompt ? { systemPrompt: params.systemPrompt } : {}),
    ...(params.middleware ? { middleware: params.middleware } : {}),
    ...(params.backend ? { backend: params.backend } : {}),
    ...(params.memory ? { memory: params.memory } : {}),
  } as Parameters<typeof createDeepAgent>[0]);
}
