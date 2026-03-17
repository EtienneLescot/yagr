import { tool } from 'ai';
import type { HolonAgentState, HolonRunPhase, HolonRuntimeContext, HolonRuntimeHook } from '../types.js';

type ToolLike = {
  description?: string;
  parameters: any;
  experimental_toToolResultContent?: ((result: any) => any) | undefined;
  execute?: (args: any, options: any) => PromiseLike<any>;
};

type ToolMap = Record<string, ToolLike>;

export function wrapToolsWithRuntimeHooks<T extends ToolMap>(
  tools: T,
  hooks: HolonRuntimeHook[] | undefined,
  getContext: () => { runId: string; phase: HolonRunPhase | null; state: HolonAgentState },
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
        const runtimeContext: HolonRuntimeContext = {
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