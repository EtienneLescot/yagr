import type { HolonRunJournalEntry } from '../types.js';

export type ObservedN8nacAction = {
  action: string;
  success: boolean;
  filename?: string;
  workflowId?: string;
  validateFile?: string;
  exitCode?: number;
};

export type RunOutcome = {
  writtenFiles: string[];
  updatedFiles: string[];
  successfulActions: ObservedN8nacAction[];
  failedActions: ObservedN8nacAction[];
  unresolvedFailedActions: ObservedN8nacAction[];
  successfulValidate?: ObservedN8nacAction;
  successfulPush?: ObservedN8nacAction;
  successfulVerify?: ObservedN8nacAction;
  hasWorkflowWrites: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function extractObservedFacts(journal: HolonRunJournalEntry[]) {
  const writtenFiles = new Set<string>();
  const updatedFiles = new Set<string>();
  const n8nacActions: ObservedN8nacAction[] = [];

  for (const entry of journal) {
    if (entry.type !== 'step' || !entry.step) {
      continue;
    }

    const step = entry.step;

    for (let index = 0; index < step.toolCalls.length; index += 1) {
      const toolCall = step.toolCalls[index];
      const toolResult = step.toolResults[index];
      const args = asRecord(toolCall.args);
      const result = asRecord(toolResult?.result);

      if (toolCall.toolName === 'writeWorkspaceFile') {
        const filePath = asString(result?.path) ?? asString(args?.path);
        if (filePath) {
          writtenFiles.add(filePath);
        }
        continue;
      }

      if (toolCall.toolName === 'replaceInWorkspaceFile') {
        const filePath = asString(result?.path) ?? asString(args?.path);
        if (filePath) {
          updatedFiles.add(filePath);
        }
        continue;
      }

      if (toolCall.toolName === 'n8nac') {
        const action = asString(args?.action) ?? 'unknown';
        n8nacActions.push({
          action,
          success: (asNumber(result?.exitCode) ?? 1) === 0,
          filename: asString(args?.filename),
          workflowId: asString(args?.workflowId),
          validateFile: asString(args?.validateFile),
          exitCode: asNumber(result?.exitCode),
        });
      }
    }
  }

  return {
    writtenFiles: [...writtenFiles],
    updatedFiles: [...updatedFiles],
    n8nacActions,
  };
}

function findSuccessfulAction(actions: ObservedN8nacAction[], actionName: string): ObservedN8nacAction | undefined {
  return actions.find((action) => action.action === actionName && action.success);
}

function actionKey(action: ObservedN8nacAction): string {
  return `${action.action}::${action.filename ?? action.validateFile ?? action.workflowId ?? ''}`;
}

export function formatObservedAction(action: ObservedN8nacAction): string {
  const target = action.filename ?? action.validateFile ?? action.workflowId;
  return target ? `${action.action} (${target})` : action.action;
}

export function analyzeRunOutcome(journal: HolonRunJournalEntry[]): RunOutcome {
  const facts = extractObservedFacts(journal);
  const successfulActions = facts.n8nacActions.filter((action) => action.success);
  const failedActions = facts.n8nacActions.filter((action) => !action.success);
  const resolvedFailureKeys = new Set(successfulActions.map(actionKey));
  const unresolvedFailedActions = failedActions.filter((action) => !resolvedFailureKeys.has(actionKey(action)));
  const hasWorkflowWrites = [...facts.writtenFiles, ...facts.updatedFiles].some((filePath) => filePath.endsWith('.workflow.ts'));
  const successfulPush = findSuccessfulAction(facts.n8nacActions, 'push');
  const successfulValidate = findSuccessfulAction(facts.n8nacActions, 'validate') ?? successfulPush;
  const successfulVerify = findSuccessfulAction(facts.n8nacActions, 'verify') ?? successfulPush;

  return {
    writtenFiles: facts.writtenFiles,
    updatedFiles: facts.updatedFiles,
    successfulActions,
    failedActions,
    unresolvedFailedActions,
    successfulValidate,
    successfulPush,
    successfulVerify,
    hasWorkflowWrites,
  };
}