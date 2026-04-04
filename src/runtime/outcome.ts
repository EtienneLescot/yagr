import type { YagrRunJournalEntry } from '../types.js';

export type ObservedN8nacAction = {
  action: string;
  success: boolean;
  filename?: string;
  workflowId?: string;
  workflowUrl?: string;
  title?: string;
  validateFile?: string;
  exitCode?: number;
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

function detectN8nacOperationFromCommand(command: string): string | undefined {
  const match = /\bn8nac\s+(\S+)(?:\s+(\S+))?/.exec(command);
  if (!match) {
    return undefined;
  }
  const op = match[1];
  const sub = match[2];
  // 'credential' is a subcommand group (credential list, credential create, ...) used for
  // manager-side lifecycle ops; not a workflow operation we want to track here.
  if (op === 'credential') {
    return undefined;
  }
  // 'skills validate' maps to the validate operation.
  if (op === 'skills' && sub === 'validate') {
    return 'validate';
  }
  return op;
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

      if (toolCall.toolName === 'runScript') {
        const command = asString(args?.command);
        if (!command) {
          continue;
        }

        const action = detectN8nacOperationFromCommand(command);
        if (!action || action === 'setup_check') {
          continue;
        }

        const exitCode = asNumber(result?.exitCode) ?? 1;
        const stdout = asString(result?.stdout) ?? '';
        const asyncTrigger = action === 'test' && /workflow was started/i.test(stdout);
        const pushTargetMatch = action === 'push' && exitCode === 0
          ? /✔ Pushed workflow (.+?)\.?\s*$/.exec(stdout.trim())
          : null;

        const observedAction: ObservedN8nacAction = {
          action,
          success: exitCode === 0 && (!asyncTrigger || false),
          filename: pushTargetMatch ? pushTargetMatch[1].trim() : undefined,
          exitCode,
        };

        n8nacActions.push(observedAction);
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
