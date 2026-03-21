import type { LocalN8nBootstrapAssessment, LocalN8nBootstrapStrategy } from './detect.js';

export type N8nBootstrapTarget = 'local-managed' | 'existing-instance';
export type N8nBootstrapAutomationLevel = 'silent' | 'assisted' | 'guided';

export interface N8nBootstrapPlan {
  target: N8nBootstrapTarget;
  runtimeStrategy?: LocalN8nBootstrapStrategy;
  automationLevel: N8nBootstrapAutomationLevel;
  canProceed: boolean;
  preferredUrl?: string;
  reasons: string[];
}

export function createN8nBootstrapPlan(input: {
  target: N8nBootstrapTarget;
  assessment?: LocalN8nBootstrapAssessment;
}): N8nBootstrapPlan {
  if (input.target === 'existing-instance') {
    return {
      target: input.target,
      automationLevel: 'guided',
      canProceed: true,
      reasons: [
        'Existing n8n instances stay available as a guided integration path.',
      ],
    };
  }

  if (!input.assessment) {
    return {
      target: input.target,
      automationLevel: 'assisted',
      canProceed: false,
      reasons: [
        'Local bootstrap requires a machine assessment before Yagr can choose a runtime strategy.',
      ],
    };
  }

  const { assessment } = input;

  if (assessment.recommendedStrategy === 'docker' || assessment.recommendedStrategy === 'direct') {
    return {
      target: input.target,
      runtimeStrategy: assessment.recommendedStrategy,
      automationLevel: 'silent',
      canProceed: true,
      preferredUrl: assessment.preferredUrl,
      reasons: [
        `A ${assessment.recommendedStrategy} runtime is available for a Yagr-managed local n8n instance.`,
        'Silent local bootstrap is the primary target for Yagr-managed instances.',
      ],
    };
  }

  return {
    target: input.target,
    runtimeStrategy: assessment.recommendedStrategy,
    automationLevel: 'assisted',
    canProceed: false,
    preferredUrl: assessment.preferredUrl,
    reasons: [
      ...assessment.blockers,
      'Yagr should fall back to an assisted local bootstrap path until the missing prerequisite is installed.',
    ],
  };
}
