import { deriveSessionTitle, type DeepAgentSessionScope, type SessionService } from '@yagr/session-service';

export type GatewaySurface = 'tui' | 'webui' | 'telegram' | 'api' | 'cli';

export interface BeginGatewayTurnParams {
  sessions: SessionService;
  surface: GatewaySurface;
  scopeKey: string;
  message: string;
  rotate?: boolean;
}

export interface BeginGatewayTurnResult {
  sessionId: string;
  scope: DeepAgentSessionScope;
  title: string;
  isNewSession: boolean;
}

export function beginGatewayTurn(params: BeginGatewayTurnParams): BeginGatewayTurnResult {
  const scope: DeepAgentSessionScope = {
    kind: params.surface,
    key: params.scopeKey,
  };
  const title = deriveSessionTitle(params.message);
  const before = params.sessions.getActiveForScope(scope);
  const record = params.rotate
    ? params.sessions.rotateForScope(scope, { title })
    : params.sessions.getOrCreateForScope(scope, { title });

  return {
    sessionId: record.id,
    scope,
    title: record.title,
    isNewSession: before?.id !== record.id,
  };
}

export function finalizeGatewayTurn(
  sessions: SessionService,
  sessionId: string,
  displayThread?: unknown[],
): void {
  sessions.touch(sessionId);
  if (displayThread) {
    sessions.syncDisplayThread(sessionId, displayThread);
  }
}
