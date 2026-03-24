import { getProviderOptionsForCapability, resolveModelCapabilityProfile, type YagrModelCapabilityProfile } from '../llm/model-capabilities.js';
import type { YagrModelProvider } from '../llm/provider-registry.js';
import {
  CORE_TOOL_NAMES,
  FULL_RUNTIME_TOOL_NAMES,
  MINIMAL_RUNTIME_TOOL_NAMES,
  POST_SYNC_RUNTIME_TOOL_NAMES,
} from '../tools/toolsets.js';

export type YagrExecutionMode = 'stream' | 'generate';
export type YagrToolCallMode = 'parallel' | 'sequential' | 'disabled';

export interface YagrToolingPolicy {
  availableToolNames: string[];
  allowedToolNamesAfterWorkflowSync: string[];
  toolCallMode: YagrToolCallMode;
  executionCriticalToolNames: string[];
}

export interface YagrToolRuntimeStrategy {
  capabilityProfile: YagrModelCapabilityProfile;
  tooling: YagrToolingPolicy;
  executionMode: YagrExecutionMode;
  toolCallStreaming: boolean;
  providerOptions?: { openai?: { strictSchemas: boolean } };
  inspectMaxSteps: number;
  executeMaxSteps: number;
  recoveryMaxSteps: number;
  inspectDirectives: string[];
  executeDirectives: string[];
  recoveryDirectives: string[];
}

function buildToolingPolicy(capabilityProfile: YagrModelCapabilityProfile): YagrToolingPolicy {
  switch (capabilityProfile.toolCalling) {
    case 'native':
      return {
        availableToolNames: [...FULL_RUNTIME_TOOL_NAMES],
        allowedToolNamesAfterWorkflowSync: [...POST_SYNC_RUNTIME_TOOL_NAMES],
        toolCallMode: capabilityProfile.supportsParallelToolCalls ? 'parallel' : 'sequential',
        executionCriticalToolNames: [...FULL_RUNTIME_TOOL_NAMES].filter((toolName) => !CORE_TOOL_NAMES.includes(toolName as any)),
      };
    case 'compatible':
      return {
        availableToolNames: [...FULL_RUNTIME_TOOL_NAMES],
        allowedToolNamesAfterWorkflowSync: [...POST_SYNC_RUNTIME_TOOL_NAMES],
        toolCallMode: 'sequential',
        executionCriticalToolNames: [...FULL_RUNTIME_TOOL_NAMES].filter((toolName) => !CORE_TOOL_NAMES.includes(toolName as any)),
      };
    case 'weak':
      return {
        availableToolNames: [...FULL_RUNTIME_TOOL_NAMES],
        allowedToolNamesAfterWorkflowSync: [...POST_SYNC_RUNTIME_TOOL_NAMES],
        toolCallMode: 'sequential',
        executionCriticalToolNames: [...FULL_RUNTIME_TOOL_NAMES].filter((toolName) => !CORE_TOOL_NAMES.includes(toolName as any)),
      };
    case 'none':
      return {
        availableToolNames: [...MINIMAL_RUNTIME_TOOL_NAMES],
        allowedToolNamesAfterWorkflowSync: [...POST_SYNC_RUNTIME_TOOL_NAMES],
        toolCallMode: 'disabled',
        executionCriticalToolNames: [],
      };
  }
}

export function resolveToolRuntimeStrategy(
  provider?: YagrModelProvider,
  model?: string,
): YagrToolRuntimeStrategy {
  const capabilityProfile = resolveModelCapabilityProfile({
    provider: provider ?? 'openai',
    model: model ?? '',
  });

  const base = {
    capabilityProfile,
    tooling: buildToolingPolicy(capabilityProfile),
    executionMode: capabilityProfile.supportsStreamingToolCalls ? 'stream' as const : 'generate' as const,
    toolCallStreaming: capabilityProfile.supportsStreamingToolCalls,
    providerOptions: getProviderOptionsForCapability(capabilityProfile),
  };

  switch (capabilityProfile.toolCalling) {
    case 'native':
      return {
        ...base,
        inspectMaxSteps: 4,
        executeMaxSteps: 10,
        recoveryMaxSteps: 6,
        inspectDirectives: [],
        executeDirectives: [
          'Tool calling is natively supported. Prefer direct, minimal tool use and stop after push and verify succeed.',
        ],
        recoveryDirectives: [],
      };
    case 'compatible':
      return {
        ...base,
        inspectMaxSteps: 4,
        executeMaxSteps: 8,
        recoveryMaxSteps: 5,
        inspectDirectives: [
          'Treat tool use as single-step and conservative. Avoid broad exploration once the required path is clear.',
        ],
        executeDirectives: [
          'Use one tool at a time when possible.',
          'Prefer direct workflow actions over repeated workspace searches.',
          'After push and verify succeed, stop and return the user-facing response.',
        ],
        recoveryDirectives: [
          'Retry only the failing step; do not restart the whole exploration sequence.',
        ],
      };
    case 'weak':
      return {
        ...base,
        inspectMaxSteps: 3,
        executeMaxSteps: 6,
        recoveryMaxSteps: 4,
        inspectDirectives: [
          'Keep inspection shallow and task-directed.',
        ],
        executeDirectives: [
          'Use a single decisive tool at a time.',
          'Avoid repeated search/list cycles.',
          'Prefer n8nac validate/push/verify over extra commentary.',
        ],
        recoveryDirectives: [
          'Do the smallest possible correction and retry exactly once per failing step.',
        ],
      };
    case 'none':
      return {
        ...base,
        executionMode: 'generate',
        toolCallStreaming: false,
        inspectMaxSteps: 2,
        executeMaxSteps: 3,
        recoveryMaxSteps: 2,
        inspectDirectives: [
          'Do not attempt tool use for execution-critical work in this mode.',
        ],
        executeDirectives: [
          'Do not call implementation tools in this mode.',
          'If the task requires workflow or filesystem execution, explain that the current model/provider path does not expose operational tool calling cleanly.',
        ],
        recoveryDirectives: [
          'Do not loop on tool attempts in this mode.',
        ],
      };
  }
}
