import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { MemorySaver } from '@langchain/langgraph';
import { LocalShellBackend } from 'deepagents';

export function getPristineDeepAgentMemorySources(): string[] {
  return [
    '/AGENTS.md',
    '/n8n-workspace/AGENTS.md',
  ];
}

export function createPristineDeepAgentBackend(rootDir: string = process.cwd()) {
  return new LocalShellBackend({
    rootDir,
    inheritEnv: true,
  });
}

export function buildPristineDeepAgentConfig({
  model,
  checkpointer,
  rootDir = process.cwd(),
}: {
  model: BaseChatModel;
  checkpointer: MemorySaver;
  rootDir?: string;
}) {
  return {
    model,
    checkpointer,
    memory: getPristineDeepAgentMemorySources(),
    backend: createPristineDeepAgentBackend(rootDir),
  };
}