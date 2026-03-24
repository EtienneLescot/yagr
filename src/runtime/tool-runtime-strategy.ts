import { getProviderOptionsForCapability, resolveModelCapabilityProfile, type YagrModelCapabilityProfile } from '../llm/model-capabilities.js';
import type { YagrModelProvider } from '../llm/provider-registry.js';

export type YagrExecutionMode = 'stream' | 'generate';

export interface YagrToolRuntimeStrategy {
  capabilityProfile: YagrModelCapabilityProfile;
  executionMode: YagrExecutionMode;
  toolCallStreaming: boolean;
  providerOptions?: { openai?: { strictSchemas: boolean } };
  inspectMaxSteps: number;
  executeMaxSteps: number;
  recoveryMaxSteps: number;
  allowedToolNames?: string[];
  inspectDirectives: string[];
  executeDirectives: string[];
  recoveryDirectives: string[];
}

const FULL_TOOLSET: string[] | undefined = undefined;
const MINIMAL_TOOLSET = ['reportProgress', 'requestRequiredAction'];

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
        allowedToolNames: FULL_TOOLSET,
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
        allowedToolNames: FULL_TOOLSET,
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
        allowedToolNames: FULL_TOOLSET,
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
        allowedToolNames: MINIMAL_TOOLSET,
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
