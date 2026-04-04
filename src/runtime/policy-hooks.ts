import { tool } from 'ai';
import type { YagrAgentState, YagrRunPhase, YagrRuntimeContext, YagrRuntimeHook } from '../types.js';
import { resolveLocalWorkflowDiagram } from '../manager-tooling/present-workflow.js';
import { resolveN8nRuntimeState, YagrN8nConfigService } from '../config/n8n-config-service.js';

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

function isConfiguredWorkspaceAvailable(configService = new YagrN8nConfigService()): boolean {
  return resolveN8nRuntimeState(configService, process.env, {
    allowEnvironmentFallback: process.env.YAGR_ALLOW_N8N_ENV === '1',
  }).initialized;
}

export function createN8nSetupGuardHook(): YagrRuntimeHook {
  let setupCheckKnown = false;
  let workspaceInitialized = isConfiguredWorkspaceAvailable();
  let credentialsAvailable = resolveN8nRuntimeState(new YagrN8nConfigService(), process.env, {
    allowEnvironmentFallback: process.env.YAGR_ALLOW_N8N_ENV === '1',
  }).credentialsAvailable;

  return {
    beforeTool: async ({ toolName, args }) => {
      if (toolName !== 'n8nac') {
        return;
      }

      const normalizedArgs = asRecord(args);
      const argv = Array.isArray(normalizedArgs?.commandArgv) ? normalizedArgs.commandArgv as string[] : [];
      const command = argv[0];
      if (command !== 'init-auth' && command !== 'init-project') {
        return;
      }

      if (command === 'init-auth' && credentialsAvailable) {
        return {
          allowed: false,
          message: 'n8n credentials are already available. Do not rerun init_auth. Continue with setup_check or init_project.',
        };
      }

      if (workspaceInitialized) {
        return {
          allowed: false,
          message: 'The n8n workspace is already initialized. Do not rerun init_auth or init_project. Continue directly with workflow file creation, validate, push, and verify.',
        };
      }

      if (!setupCheckKnown) {
        return {
          allowed: false,
          message: 'Do not run init_auth or init_project speculatively. Call n8nac setup_check first, and only continue with setup if it reports that the workspace is not initialized.',
        };
      }
    },
    afterTool: async ({ toolName, args, result }) => {
      if (toolName !== 'n8nac') {
        return;
      }

      const normalizedArgs = asRecord(args);
      const argv = Array.isArray(normalizedArgs?.commandArgv) ? normalizedArgs.commandArgv as string[] : [];
      if (argv[0] !== 'setup-check') {
        return;
      }

      const normalizedResult = asRecord(result);
      setupCheckKnown = true;
      workspaceInitialized = normalizedResult?.initialized === true;
      credentialsAvailable = normalizedResult?.credentialsAvailable === true || credentialsAvailable;
    },
  };
}

export function createDefaultRuntimeHooks(): YagrRuntimeHook[] {
  return createDefaultRuntimeHooksForStrategy();
}

export function createDefaultRuntimeHooksForStrategy(_strategy?: unknown): YagrRuntimeHook[] {
  return [
    createN8nSetupGuardHook(),
    createWorkflowPresentationGuardHook(),
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
