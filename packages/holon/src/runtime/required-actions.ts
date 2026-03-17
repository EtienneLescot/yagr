import type { HolonAgentState, HolonRequiredAction, HolonRunJournalEntry } from '../types.js';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function normalizeRequiredAction(value: unknown, fallbackId: string): HolonRequiredAction | undefined {
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
  };
}

export function collectRequiredActions(journal: HolonRunJournalEntry[]): HolonRequiredAction[] {
  const actions = new Map<string, HolonRequiredAction>();

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

export function agentStateForRequiredAction(action: HolonRequiredAction): HolonAgentState {
  if (action.kind === 'permission') {
    return 'waiting_for_permission';
  }

  if (action.kind === 'input') {
    return 'waiting_for_input';
  }

  return action.resumable ? 'resumable' : 'failed_terminal';
}

export function blockingStateForRequiredActions(actions: HolonRequiredAction[]): HolonAgentState | null {
  if (actions.length === 0) {
    return null;
  }

  const permissionAction = actions.find((action) => action.kind === 'permission');
  if (permissionAction) {
    return agentStateForRequiredAction(permissionAction);
  }

  const inputAction = actions.find((action) => action.kind === 'input');
  if (inputAction) {
    return agentStateForRequiredAction(inputAction);
  }

  return agentStateForRequiredAction(actions[0]);
}