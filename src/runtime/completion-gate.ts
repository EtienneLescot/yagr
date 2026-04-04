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
  const usedOnlyReadOnlyTooling = input.attemptedAnyToolCalls && !input.attemptedMaterialWork;
  // needsContinuation is true when:
  //  (a) material work was attempted but produced no concrete result, OR
  //  (b) tooling was used only for read-only exploration and still produced neither
  //      a concrete result nor a structured blocker, OR
  //  (c) the execute phase made zero tool calls AND produced no text — a blank
  //      response with no tools always requires a repair pass, but a pure-text
  //      reply (e.g. answering a conversational message) is a valid completion.
  const hasTextReply = input.text.trim().length > 0;
  const needsContinuation =
    (input.attemptedMaterialWork && !input.hasConcreteResult && blockingRequiredActions.length === 0)
    || (usedOnlyReadOnlyTooling && !input.hasConcreteResult && blockingRequiredActions.length === 0)
    || (input.executePhaseCalledNoTools && !input.hasConcreteResult && !hasTextReply && blockingRequiredActions.length === 0);

  if (blockingRequiredActions.length > 0) {
    reasons.push('Required action is still open.');
  }

  if (needsContinuation) {
    reasons.push('Run ended without a concrete result or a structured blocker.');
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
      state: 'resumable',
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
