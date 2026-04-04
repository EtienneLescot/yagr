import type { YagrAgentState, YagrCompletionAttempt, YagrRequiredAction, YagrRuntimeContext, YagrRuntimeHook } from '../types.js';
import { blockingStateForRequiredActions, splitRequiredActions } from './required-actions.js';

export interface CompletionGateInput {
  text: string;
  finishReason: string;
  requiredActions: YagrRequiredAction[];
  satisfiedRequiredActionIds?: string[];
  attemptedAnyToolCalls: boolean;
  attemptedMaterialWork: boolean;
  /** True when the execute phase made zero tool calls — treated as a violation of the
   *  "must call at least one tool" contract, which always requires a repair pass. */
  executePhaseCalledNoTools: boolean;
  hasConcreteResult: boolean;
  hasWorkflowWrites: boolean;
  successfulValidate: boolean;
  successfulPush: boolean;
  successfulVerify: boolean;
  unresolvedFailureCount: number;
  hooks?: YagrRuntimeHook[];
  context: YagrRuntimeContext;
}

export interface CompletionGateDecision {
  accepted: boolean;
  reasons: string[];
  requiredActions: YagrRequiredAction[];
  state: YagrAgentState;
  needsContinuation: boolean;
}

export async function evaluateCompletionGate(input: CompletionGateInput): Promise<CompletionGateDecision> {
  const reasons: string[] = [];
  const satisfiedRequiredActionIds = new Set(input.satisfiedRequiredActionIds ?? []);
  const requiredActions = input.requiredActions.filter((action) => !satisfiedRequiredActionIds.has(action.id));
  const { blocking: blockingRequiredActions } = splitRequiredActions(requiredActions);
  const hasBlockingWorkflowFailures = input.hasWorkflowWrites && input.unresolvedFailureCount > 0;
  const usedOnlyReadOnlyTooling = input.attemptedAnyToolCalls && !input.attemptedMaterialWork;
  const missingWorkflowSyncConfirmation = input.hasWorkflowWrites
    && (!input.successfulPush || !input.successfulVerify)
    && input.unresolvedFailureCount === 0;
  // needsContinuation is true when:
  //  (a) material work was attempted but produced no concrete result, OR
  //  (b) tooling was used only for read-only exploration and still produced neither
  //      a concrete result nor a structured blocker, OR
  //  (c) a workflow file exists locally but sync has not yet been confirmed and no
  //      structured blocker explains why, OR
  //  (d) the execute phase made zero tool calls — always requires a repair pass.
  const needsContinuation =
    (input.attemptedMaterialWork && !input.hasConcreteResult && blockingRequiredActions.length === 0)
    || (usedOnlyReadOnlyTooling && !input.hasConcreteResult && blockingRequiredActions.length === 0)
    || (missingWorkflowSyncConfirmation && blockingRequiredActions.length === 0)
    || (input.executePhaseCalledNoTools && !input.hasConcreteResult && blockingRequiredActions.length === 0);

  if (blockingRequiredActions.length > 0) {
    reasons.push('Required action is still open.');
  }

  if (needsContinuation) {
    reasons.push('Run ended without a concrete result or a structured blocker.');
  }

  if (hasBlockingWorkflowFailures) {
    reasons.push('Unresolved tool failures remain in task state.');
  }

  if (input.hasWorkflowWrites && !input.successfulValidate && !input.successfulPush) {
    reasons.push('Validation has not been confirmed.');
  }

  if (input.hasWorkflowWrites && !input.successfulPush) {
    reasons.push('Push has not been confirmed.');
  }

  if (input.hasWorkflowWrites && !input.successfulVerify) {
    reasons.push('Remote verification has not been confirmed.');
  }

  const attempt: YagrCompletionAttempt = {
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
      needsContinuation,
    };
  }

  if (reasons.length > 0) {
    return {
      accepted: false,
      reasons,
      requiredActions,
      state: hasBlockingWorkflowFailures ? 'failed_terminal' : 'resumable',
      needsContinuation,
    };
  }

  return {
    accepted: true,
    reasons: [],
    requiredActions,
    state: 'completed',
    needsContinuation: false,
  };
}
