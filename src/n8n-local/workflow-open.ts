import { YagrN8nConfigService } from '../config/n8n-config-service.js';
import { buildManagedN8nWorkflowOpenPage } from './browser-auth.js';
import { ManagedN8nOwnerCredentialService, type ManagedN8nOwnerCredentials } from './owner-credentials.js';

export type ManagedWorkflowOpenPayload =
  | { mode: 'direct'; targetUrl: string }
  | {
      mode: 'managed';
      targetUrl: string;
      loginUrl: string;
      credentials: ManagedN8nOwnerCredentials;
      fallbackPage: string;
    };

export type ManagedWorkflowOpenResolution =
  | { ok: true; payload: ManagedWorkflowOpenPayload }
  | { ok: false; statusCode: number; error: string };

export function resolveManagedN8nWorkflowOpen(target: string): ManagedWorkflowOpenResolution {
  if (!target) {
    return { ok: false, statusCode: 400, error: 'Workflow target URL is required.' };
  }

  const n8nConfig = new YagrN8nConfigService().getLocalConfig();
  if (!n8nConfig.host) {
    return { ok: false, statusCode: 400, error: 'n8n is not configured yet.' };
  }

  let targetUrl: URL;
  let configuredHost: URL;
  try {
    targetUrl = new URL(target);
    configuredHost = new URL(n8nConfig.host);
  } catch {
    return { ok: false, statusCode: 400, error: 'Workflow target URL is invalid.' };
  }

  if (targetUrl.origin !== configuredHost.origin) {
    return { ok: false, statusCode: 400, error: 'Workflow target URL does not match the configured n8n host.' };
  }

  const ownerCredentials = new ManagedN8nOwnerCredentialService().get(configuredHost.origin);
  if (!ownerCredentials) {
    return {
      ok: true,
      payload: {
        mode: 'direct',
        targetUrl: targetUrl.toString(),
      },
    };
  }

  const loginUrl = new URL('/rest/login', configuredHost.origin).toString();
  return {
    ok: true,
    payload: {
      mode: 'managed',
      targetUrl: targetUrl.toString(),
      loginUrl,
      credentials: ownerCredentials,
      fallbackPage: buildManagedN8nWorkflowOpenPage({
        targetUrl: targetUrl.toString(),
        loginUrl,
        credentials: ownerCredentials,
      }),
    },
  };
}
