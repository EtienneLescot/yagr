import type { YagrAgentState, YagrRequiredAction, YagrRunJournalEntry } from '../types.js';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function normalizeRequiredAction(value: unknown, fallbackId: string): YagrRequiredAction | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const kind = asString(record.kind);
  const title = asString(record.title);
  const message = asString(record.message);

  if (!kind || !title || !message || (kind !== 'input' && kind !== 'permission' && kind !== 'external')) {
    return undefined;
  }

  return {
    id: asString(record.id) ?? fallbackId,
    kind,
    title,
    message,
    detail: asString(record.detail),
    resumable: asBoolean(record.resumable) ?? true,
    blocking: asBoolean(record.blocking) ?? true,
  };
}

export function collectRequiredActions(journal: YagrRunJournalEntry[]): YagrRequiredAction[] {
  const actions = new Map<string, YagrRequiredAction>();

  for (const entry of journal) {
    if (entry.requiredAction) {
      actions.set(entry.requiredAction.id, entry.requiredAction);
    }

    if (entry.type !== 'step' || !entry.step) {
      continue;
    }

    for (let index = 0; index < entry.step.toolCalls.length; index += 1) {
      const toolCall = entry.step.toolCalls[index];
      if (toolCall.toolName !== 'requestRequiredAction') {
        continue;
      }

      const toolResult = entry.step.toolResults[index];
      const fallbackId = `${entry.step.stepNumber}:${index}`;
      const action = normalizeRequiredAction(toolResult?.result ?? toolCall.args, fallbackId);
      if (action) {
        actions.set(action.id, action);
      }
    }
  }

  return [...actions.values()];
}

export function isBlockingRequiredAction(action: YagrRequiredAction): boolean {
  return action.blocking !== false;
}

export function splitRequiredActions(actions: YagrRequiredAction[]): {
  blocking: YagrRequiredAction[];
  followUp: YagrRequiredAction[];
} {
  const blocking: YagrRequiredAction[] = [];
  const followUp: YagrRequiredAction[] = [];

  for (const action of actions) {
    if (isBlockingRequiredAction(action)) {
      blocking.push(action);
    } else {
      followUp.push(action);
    }
  }

  return { blocking, followUp };
}

export function agentStateForRequiredAction(action: YagrRequiredAction): YagrAgentState {
  if (action.kind === 'permission') {
    return 'waiting_for_permission';
  }

  if (action.kind === 'input') {
    return 'waiting_for_input';
  }

  return action.resumable ? 'resumable' : 'failed_terminal';
}

export function blockingStateForRequiredActions(actions: YagrRequiredAction[]): YagrAgentState | null {
  const blockingActions = actions.filter(isBlockingRequiredAction);

  if (blockingActions.length === 0) {
    return null;
  }

  const permissionAction = blockingActions.find((action) => action.kind === 'permission');
  if (permissionAction) {
    return agentStateForRequiredAction(permissionAction);
  }

  const inputAction = blockingActions.find((action) => action.kind === 'input');
  if (inputAction) {
    return agentStateForRequiredAction(inputAction);
  }

  return agentStateForRequiredAction(blockingActions[0]);
}
