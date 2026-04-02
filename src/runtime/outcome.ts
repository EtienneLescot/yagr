import type { YagrRunJournalEntry } from '../types.js';
import { extractN8nacOperation, extractN8nacTargetMeta } from '../tools/n8nac-command.js';

export type ObservedN8nacAction = {
  action: string;
  success: boolean;
  filename?: string;
  workflowId?: string;
  workflowUrl?: string;
  title?: string;
  validateFile?: string;
  exitCode?: number;
  testOutput?: string;
};

export type RunOutcome = {
  writtenFiles: string[];
  updatedFiles: string[];
  deletedFiles: string[];
  successfulActions: ObservedN8nacAction[];
  failedActions: ObservedN8nacAction[];
  unresolvedFailedActions: ObservedN8nacAction[];
  blockingUnresolvedFailedActions: ObservedN8nacAction[];
  successfulValidate?: ObservedN8nacAction;
  successfulTest?: ObservedN8nacAction;
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

function extractObservedFacts(journal: YagrRunJournalEntry[]) {
  const writtenFiles = new Set<string>();
  const updatedFiles = new Set<string>();
  const deletedFiles = new Set<string>();
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

      if (toolCall.toolName === 'writeFile') {
        const filePath = asString(result?.path) ?? asString(args?.path);
        if (filePath) {
          writtenFiles.add(filePath);
        }
        continue;
      }

      if (toolCall.toolName === 'replaceInFile') {
        const filePath = asString(result?.path) ?? asString(args?.path);
        if (filePath) {
          updatedFiles.add(filePath);
        }
        continue;
      }

      if (toolCall.toolName === 'deleteFile') {
        const deleted = result?.deleted === true;
        const filePath = asString(result?.path) ?? asString(args?.path);
        if (deleted && filePath) {
          deletedFiles.add(filePath);
        }
        continue;
      }

      if (toolCall.toolName === 'n8nac') {
        const action = extractN8nacOperation(toolCall.args) ?? 'unknown';
        if (action === 'setup_check') {
          continue;
        }

        const targetMeta = extractN8nacTargetMeta(toolCall.args);

        const observedAction: ObservedN8nacAction = {
          action,
          success: (asNumber(result?.exitCode) ?? 1) === 0,
          filename: asString(result?.pushTarget) ?? targetMeta.filename,
          workflowId: asString(result?.workflowId) ?? targetMeta.workflowId,
          workflowUrl: asString(result?.workflowUrl),
          title: asString(result?.title),
          validateFile: targetMeta.validateFile,
          exitCode: asNumber(result?.exitCode),
          testOutput: action === 'test' ? (asString(result?.stdout) ?? undefined) : undefined,
        };

        n8nacActions.push(observedAction);

        if (
          action === 'push'
          && observedAction.success
          && observedAction.workflowId
          && result?.verified === true
        ) {
          n8nacActions.push({
            action: 'verify',
            success: true,
            workflowId: observedAction.workflowId,
            workflowUrl: observedAction.workflowUrl,
            title: observedAction.title,
            exitCode: observedAction.exitCode,
          });
        }
      }
    }
  }

  return {
    writtenFiles: [...writtenFiles],
    updatedFiles: [...updatedFiles],
    deletedFiles: [...deletedFiles],
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

export function analyzeRunOutcome(journal: YagrRunJournalEntry[]): RunOutcome {
  const facts = extractObservedFacts(journal);
  const successfulActions = facts.n8nacActions.filter((action) => action.success);
  const failedActions = facts.n8nacActions.filter((action) => !action.success);
  const resolvedFailureKeys = new Set(successfulActions.map(actionKey));
  const unresolvedFailedActions = failedActions.filter((action) => !resolvedFailureKeys.has(actionKey(action)));
  const hasWorkflowWrites = [...facts.writtenFiles, ...facts.updatedFiles].some((filePath) => filePath.endsWith('.workflow.ts'));
  const successfulPush = findSuccessfulAction(facts.n8nacActions, 'push');
  const successfulValidate = findSuccessfulAction(facts.n8nacActions, 'validate') ?? successfulPush;
  const successfulVerify = findSuccessfulAction(facts.n8nacActions, 'verify') ?? successfulPush;
  const successfulTest = findSuccessfulAction(facts.n8nacActions, 'test');
  const blockingUnresolvedFailedActions = unresolvedFailedActions.filter((action) => {
    if (!(successfulPush && successfulVerify)) {
      return true;
    }

    if (action.action === 'push') {
      return false;
    }

    if ([
      'init_auth',
      'init_project',
      'setup_check',
      'list',
      'pull',
      'skills',
      'update_ai',
    ].includes(action.action)) {
      return false;
    }

    return true;
  });

  return {
    writtenFiles: facts.writtenFiles,
    updatedFiles: facts.updatedFiles,
    deletedFiles: facts.deletedFiles,
    successfulActions,
    failedActions,
    unresolvedFailedActions,
    blockingUnresolvedFailedActions,
    successfulValidate,
    successfulPush,
    successfulVerify,
    successfulTest,
    hasWorkflowWrites,
  };
}
