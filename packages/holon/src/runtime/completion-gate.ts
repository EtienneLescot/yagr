import type { HolonAgentState, HolonCompletionAttempt, HolonRequiredAction, HolonRuntimeContext, HolonRuntimeHook } from '../types.js';
import { blockingStateForRequiredActions } from './required-actions.js';

export interface CompletionGateInput {
  text: string;
  finishReason: string;
  requiredActions: HolonRequiredAction[];
  satisfiedRequiredActionIds?: string[];
  hasWorkflowWrites: boolean;
  successfulValidate: boolean;
  successfulPush: boolean;
  unresolvedFailureCount: number;
  hooks?: HolonRuntimeHook[];
  context: HolonRuntimeContext;
}

export interface CompletionGateDecision {
  accepted: boolean;
  reasons: string[];
  requiredActions: HolonRequiredAction[];
  state: HolonAgentState;
}

export async function evaluateCompletionGate(input: CompletionGateInput): Promise<CompletionGateDecision> {
  const reasons: string[] = [];
  const satisfiedRequiredActionIds = new Set(input.satisfiedRequiredActionIds ?? []);
  const requiredActions = input.requiredActions.filter((action) => !satisfiedRequiredActionIds.has(action.id));

  if (requiredActions.length > 0) {
    reasons.push('Required action is still open.');
  }

  if (input.unresolvedFailureCount > 0) {
    reasons.push('Unresolved tool failures remain in task state.');
  }

  if (input.hasWorkflowWrites && !input.successfulValidate && !input.successfulPush) {
    reasons.push('Validation has not been confirmed.');
  }

  if (input.hasWorkflowWrites && !input.successfulPush) {
    reasons.push('Push has not been confirmed.');
  }

  const attempt: HolonCompletionAttempt = {
    text: input.text,
    finishReason: input.finishReason,
    requiredActions,
  };

  for (const hook of input.hooks ?? []) {
    const decision = await hook.beforeCompletion?.(attempt, input.context);
    if (!decision) {
      continue;
    }

    if (decision.requiredAction && !satisfiedRequiredActionIds.has(decision.requiredAction.id)) {
      requiredActions.push(decision.requiredAction);
    }

    if (decision.accepted === false && (!decision.requiredAction || !satisfiedRequiredActionIds.has(decision.requiredAction.id))) {
      reasons.push(decision.message ?? 'Completion rejected by runtime hook.');
    }
  }

  const blockingState = blockingStateForRequiredActions(requiredActions);
  if (blockingState) {
    return {
      accepted: false,
      reasons,
      requiredActions,
      state: blockingState,
    };
  }

  if (reasons.length > 0) {
    return {
      accepted: false,
      reasons,
      requiredActions,
      state: input.unresolvedFailureCount > 0 ? 'failed_terminal' : 'running',
    };
  }

  return {
    accepted: true,
    reasons: [],
    requiredActions,
    state: 'completed',
  };
}