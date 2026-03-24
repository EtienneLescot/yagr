import { tool } from 'ai';
import type { YagrToolRuntimeStrategy } from './tool-runtime-strategy.js';
import type { YagrAgentState, YagrRunPhase, YagrRuntimeContext, YagrRuntimeHook } from '../types.js';
import { resolveLocalWorkflowDiagram } from '../tools/present-workflow-result.js';

type ToolLike = {
  description?: string;
  parameters: any;
  experimental_toToolResultContent?: ((result: any) => any) | undefined;
  execute?: (args: any, options: any) => PromiseLike<any>;
};

type ToolMap = Record<string, ToolLike>;

const DEFAULT_POST_SYNC_ALLOWED_TOOL_NAMES = [
  'presentWorkflowResult',
  'reportProgress',
  'requestRequiredAction',
];

function createFallbackRuntimeStrategy(): YagrToolRuntimeStrategy {
  return {
    capabilityProfile: {
      provider: 'openai',
      model: 'fallback',
      toolCalling: 'native',
      supportsParallelToolCalls: true,
      supportsStructuredOutputs: true,
      supportsStreamingToolCalls: true,
      supportsForcedToolChoice: true,
      prefersStrictToolSchemas: false,
    },
    tooling: {
      allowedToolNamesAfterWorkflowSync: DEFAULT_POST_SYNC_ALLOWED_TOOL_NAMES,
      availableToolNames: [],
      toolCallMode: 'parallel',
      executionCriticalToolNames: [],
    },
    executionMode: 'stream',
    toolCallStreaming: true,
    inspectMaxSteps: 0,
    executeMaxSteps: 0,
    recoveryMaxSteps: 0,
    inspectDirectives: [],
    executeDirectives: [],
    recoveryDirectives: [],
  };
}

function buildWorkflowPresentationRequiredAction(workflowId: string) {
  return {
    id: `pull-workflow-${workflowId}`,
    kind: 'external' as const,
    title: 'Pull workflow before presenting it',
    message: `Pull workflow ${workflowId} before calling presentWorkflowResult so the card uses the canonical local workflow-map.`,
    detail: 'This workflow is not currently available as a local .workflow.ts file in the active Yagr workspace or Yagr home. Run n8nac pull for the workflow ID first, then present it.',
    resumable: true,
  };
}

export function createWorkflowPresentationGuardHook(): YagrRuntimeHook {
  return {
    beforeTool: async ({ toolName, args }) => {
      if (toolName !== 'presentWorkflowResult' || !args || typeof args !== 'object') {
        return;
      }

      const workflowId = typeof (args as { workflowId?: unknown }).workflowId === 'string'
        ? (args as { workflowId: string }).workflowId
        : undefined;

      const providedDiagram = typeof (args as { diagram?: unknown }).diagram === 'string'
        ? (args as { diagram: string }).diagram.trim()
        : '';

      if (providedDiagram) {
        return;
      }

      if (!workflowId || resolveLocalWorkflowDiagram(workflowId)) {
        return;
      }

      return {
        allowed: false,
        message: `Workflow ${workflowId} must be pulled locally before it can be presented.`,
        requiredAction: buildWorkflowPresentationRequiredAction(workflowId),
      };
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

export function createWorkflowSyncCompletionGuardHook(strategy: YagrToolRuntimeStrategy): YagrRuntimeHook {
  let workflowSyncSettled = false;
  const toolsAllowedAfterSuccessfulSync = new Set(strategy.tooling.allowedToolNamesAfterWorkflowSync);

  return {
    beforeTool: async ({ toolName }) => {
      if (!workflowSyncSettled) {
        return;
      }

      if (toolsAllowedAfterSuccessfulSync.has(toolName)) {
        return;
      }

      return {
        allowed: false,
        message: 'Workflow already pushed and verified. Stop using tools now and return the final user-facing response.',
      };
    },
    afterTool: async ({ toolName, args, result }) => {
      if (toolName !== 'n8nac') {
        return;
      }

      const normalizedArgs = asRecord(args);
      const normalizedResult = asRecord(result);
      const action = asString(normalizedArgs?.action);
      const exitCode = asNumber(normalizedResult?.exitCode);

      if (exitCode !== 0) {
        return;
      }

      if (action === 'push' || action === 'verify') {
        workflowSyncSettled = true;
      }
    },
  };
}

export function createDefaultRuntimeHooks(): YagrRuntimeHook[] {
  return createDefaultRuntimeHooksForStrategy(createFallbackRuntimeStrategy());
}

export function createDefaultRuntimeHooksForStrategy(strategy: YagrToolRuntimeStrategy): YagrRuntimeHook[] {
  return [
    createWorkflowPresentationGuardHook(),
    createWorkflowSyncCompletionGuardHook(strategy),
  ];
}

export function wrapToolsWithRuntimeHooks<T extends ToolMap>(
  tools: T,
  hooks: YagrRuntimeHook[] | undefined,
  getContext: () => { runId: string; phase: YagrRunPhase | null; state: YagrAgentState },
  satisfiedRequiredActionIds: string[] | undefined = [],
): T {
  if (!hooks || hooks.length === 0) {
    return tools;
  }

  const approvedActionIds = new Set(satisfiedRequiredActionIds);

  const wrappedEntries = Object.entries(tools).map(([toolName, originalTool]) => {
    if (typeof originalTool.execute !== 'function') {
      return [toolName, originalTool];
    }

    const wrappedTool = tool({
      description: originalTool.description,
      parameters: originalTool.parameters,
      experimental_toToolResultContent: originalTool.experimental_toToolResultContent,
      execute: async (args: any, toolOptions: any) => {
        const runtimeContext: YagrRuntimeContext = {
          runId: getContext().runId,
          phase: getContext().phase ?? undefined,
          state: getContext().state,
        };
        const hookContext = {
          ...runtimeContext,
          toolName,
          args,
        };

        for (const hook of hooks) {
          const decision = await hook.beforeTool?.(hookContext);
          if (decision && decision.allowed === false) {
            if (decision.requiredAction && approvedActionIds.has(decision.requiredAction.id)) {
              continue;
            }

            return {
              ok: false,
              blocked: true,
              error: decision.message ?? `Tool ${toolName} blocked by runtime policy.`,
              requiredAction: decision.requiredAction,
            };
          }
        }

        const result = await originalTool.execute?.(args, toolOptions);

        for (const hook of hooks) {
          await hook.afterTool?.({
            ...hookContext,
            result,
          });
        }
        return result;
      },
    } as any);

    return [toolName, wrappedTool];
  });

  return Object.fromEntries(wrappedEntries) as T;
}
