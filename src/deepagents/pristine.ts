import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import { LocalShellBackend } from 'deepagents';
import { getActiveMemorySourcePaths } from '../config/yagr-home.js';

export function getPristineDeepAgentMemorySources(): string[] {
  return getActiveMemorySourcePaths();
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
  checkpointer: BaseCheckpointSaver;
  rootDir?: string;
}) {
  return {
    model,
    checkpointer,
    memory: getPristineDeepAgentMemorySources(),
    backend: createPristineDeepAgentBackend(rootDir),
  };
}
