import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import {
  createYagrDeepAgent as createPublicYagrDeepAgent,
  type YagrDeepAgentHandle,
  type YagrDeepAgentRuntimeOptions,
} from '@yagr/deepagent-bootstrap';
import type { YagrConfigStoreLike } from './config/yagr-config-service.js';
import { getYagrHomeDir, getActiveMemorySourcePaths } from './config/yagr-home.js';
import { createLangChainModel } from './llm/create-langchain-model.js';
import { getDeepAgentSkillSourcePaths } from './skills/agent-skills.js';
import type { YagrRunOptions } from './types.js';

export type { YagrDeepAgentHandle, YagrDeepAgentRuntimeOptions } from '@yagr/deepagent-bootstrap';

export const getYagrAgentMemorySources = getActiveMemorySourcePaths;
export const getYagrAgentSkillSourcePaths = getDeepAgentSkillSourcePaths;

export async function createYagrDeepAgent(
  configStore?: YagrConfigStoreLike,
  modelConfig?: { provider?: string; model?: string; apiKey?: string; baseUrl?: string },
  checkpointer?: BaseCheckpointSaver,
  runOptions?: YagrRunOptions,
  runtimeOptions: YagrDeepAgentRuntimeOptions = {},
): Promise<YagrDeepAgentHandle> {
  const model = await createLangChainModel(modelConfig, configStore);
  const rootDir = runtimeOptions.rootDir ?? getYagrHomeDir();
  return createPublicYagrDeepAgent({
    model,
    checkpointer,
    defaultMemorySources: getActiveMemorySourcePaths(),
    defaultSkillSourcePaths: getDeepAgentSkillSourcePaths(),
    runtimeOptions: {
      ...runtimeOptions,
      rootDir,
      historyLimit: runOptions?.historyLimit ?? runtimeOptions.historyLimit,
    },
  });
}
