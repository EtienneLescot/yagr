import { tool } from 'ai';
import type { YagrAgentState, YagrRunPhase, YagrRuntimeContext, YagrRuntimeHook } from '../types.js';
import { resolveLocalWorkflowDiagram } from '../tools/present-workflow-result.js';

type ToolLike = {
  description?: string;
  parameters: any;
  experimental_toToolResultContent?: ((result: any) => any) | undefined;
  execute?: (args: any, options: any) => PromiseLike<any>;
};

type ToolMap = Record<string, ToolLike>;

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

export function createDefaultRuntimeHooks(): YagrRuntimeHook[] {
  return [createWorkflowPresentationGuardHook()];
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