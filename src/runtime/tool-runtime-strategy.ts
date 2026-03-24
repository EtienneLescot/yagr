import { getProviderOptionsForCapability, resolveModelCapabilityProfile, type YagrModelCapabilityProfile } from '../llm/model-capabilities.js';
import type { YagrModelProvider } from '../llm/provider-registry.js';
import {
  CORE_TOOL_NAMES,
  FULL_RUNTIME_TOOL_NAMES,
  MINIMAL_RUNTIME_TOOL_NAMES,
  POST_SYNC_RUNTIME_TOOL_NAMES,
  SYNTHETIC_RUNTIME_TOOL_NAMES,
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
        availableToolNames: [...SYNTHETIC_RUNTIME_TOOL_NAMES],
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
        inspectMaxSteps: 1,
        executeMaxSteps: 1,
        recoveryMaxSteps: 1,
        inspectDirectives: [
          'Do not attempt direct tool use in this mode.',
          'Infer the smallest possible execution plan without tool calls.',
        ],
        executeDirectives: [
          'Tool calling is unavailable in this mode.',
          'Respond with JSON objects only, no markdown and no prose.',
          'Supported JSON intents are limited to:',
          '{"tool":"writeWorkspaceFile","path":"<workspace-relative .workflow.ts path>","content":"<full file content>","mode":"overwrite"}',
          '{"tool":"n8nac","action":"validate","validateFile":"<same .workflow.ts path>"}',
          '{"tool":"n8nac","action":"push","filename":"<same .workflow.ts path>"}',
          'Use the smallest sequence needed to complete the task. Prefer one workflow file write, then validate, then push.',
        ],
        recoveryDirectives: [
          'If the previous JSON intents were invalid, emit a corrected JSON-only sequence.',
        ],
      };
  }
}
