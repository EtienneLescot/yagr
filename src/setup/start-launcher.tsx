export type StartLaunchAction = 'tui' | 'webui' | 'gateway-only' | 'onboard' | 'cancel';

export function resolveStartLaunchAction(answer: string, hasBackgroundGateways = false): StartLaunchAction {
  const trimmed = answer.trim().toLowerCase();

  if (trimmed === '1' || trimmed === 'tui' || trimmed === 'terminal' || trimmed === 'terminal-ui') {
    return 'tui';
  }

  if (trimmed === '2' || trimmed === 'webui' || trimmed === 'web' || trimmed === 'web-ui') {
    return 'webui';
  }

  if (hasBackgroundGateways && trimmed === '3') {
    return 'gateway-only';
  }

  if (trimmed === 'gateway-only' || trimmed === 'gateway' || trimmed === 'gateways') {
    return hasBackgroundGateways ? 'gateway-only' : 'tui';
  }

  if (
    trimmed === (hasBackgroundGateways ? '4' : '3')
    || trimmed === 'onboard'
    || trimmed === 'setup'
    || trimmed === 'reconfigure'
    || trimmed === 'configure'
  ) {
    return 'onboard';
  }

  if (trimmed === 'cancel' || trimmed === 'exit' || trimmed === 'quit') {
    return 'cancel';
  }

  return 'tui';
}
