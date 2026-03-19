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

const UNRESOLVED_DELIBERATION_PATTERNS = [
  /\bActually\b/gi,
  /\bWait\b/gi,
  /\bLet'?s check\b/gi,
  /\bI'?ll just\b/gi,
  /\bI need to\b/gi,
  /\bOne more thing\b/gi,
  /\bStep \d+:/gi,
];

const FUTURE_INTENT_PATTERN = /\b(I'?ll|I will|Let'?s|need to|going to)\b/i;
const RESOLVED_OUTCOME_PATTERN = /\b(created|updated|validated|pushed|verified|deployed|saved|wrote|here is|workflow ready|done\b)\b/i;

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

export function looksLikeUnresolvedDeliberation(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length < 160) {
    return false;
  }

  const markerCount = UNRESOLVED_DELIBERATION_PATTERNS.reduce(
    (total, pattern) => total + (normalized.match(pattern)?.length ?? 0),
    0,
  );

  return markerCount >= 3
    && FUTURE_INTENT_PATTERN.test(normalized)
    && !RESOLVED_OUTCOME_PATTERN.test(normalized);
}

export function createUnresolvedDeliberationGuardHook(): YagrRuntimeHook {
  return {
    beforeCompletion: async (attempt) => {
      if (!looksLikeUnresolvedDeliberation(attempt.text)) {
        return;
      }

      return {
        accepted: false,
        message: 'Completion ended in unresolved internal deliberation instead of a grounded user-facing result.',
      };
    },
  };
}

export function createDefaultRuntimeHooks(): YagrRuntimeHook[] {
  return [
    createWorkflowPresentationGuardHook(),
    createUnresolvedDeliberationGuardHook(),
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