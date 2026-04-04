import { YagrN8nConfigService } from '../config/n8n-config-service.js';
import { buildManagedN8nWorkflowOpenDataUrl } from '../n8n-local/browser-auth.js';
import { ManagedN8nOwnerCredentialService } from '../n8n-local/owner-credentials.js';
import { buildLocalWorkflowOpenBridgeUrl, ensureLocalWorkflowOpenBridgeRunning } from './local-open-bridge.js';

export interface WorkflowOpenLink {
  openUrl: string;
  targetUrl: string;
  via: 'direct' | 'self-contained-auth';
}

export function resolveWorkflowOpenLink(
  workflowUrl: string,
  options: {
    n8nConfigService?: YagrN8nConfigService;
    ownerCredentialService?: ManagedN8nOwnerCredentialService;
    /** When set, the public Cloudflare tunnel URL replaces the local origin in openUrl. */
    n8nTunnelPublicUrl?: string;
  } = {},
): WorkflowOpenLink {
  const targetUrl = normalizeUrl(workflowUrl);
  if (!targetUrl) {
    return {
      openUrl: workflowUrl,
      targetUrl: workflowUrl,
      via: 'direct',
    };
  }

  // Resolve the target origin — substitute tunnel origin if active.
  let resolvedTargetUrl = targetUrl.toString();
  const tunnelOrigin = options.n8nTunnelPublicUrl
    ? normalizeUrl(options.n8nTunnelPublicUrl)?.origin
    : undefined;
  if (tunnelOrigin && targetUrl.origin !== tunnelOrigin) {
    resolvedTargetUrl = targetUrl.toString().replace(targetUrl.origin, tunnelOrigin);
  }

  const resolvedTarget = normalizeUrl(resolvedTargetUrl)!;

  const ownerCredentialService = options.ownerCredentialService ?? new ManagedN8nOwnerCredentialService();

  // Look up owner credentials: try the resolved origin first (tunnel), then fall back
  // to the original origin (local n8n) since credentials are stored against the local URL.
  const ownerCredentials =
    ownerCredentialService.get(resolvedTarget.origin) ??
    ownerCredentialService.get(targetUrl.origin);

  // If we have credentials, generate the self-contained auth URL.
  // Use the local HTTP bridge (not data: URI) so the form POST works without
  // CORS restrictions and the page can redirect after login.
  if (ownerCredentials) {
    // Ensure the local bridge server is running
    ensureLocalWorkflowOpenBridgeRunning().catch(() => {
      // Bridge start failure is non-fatal — fall through to direct URL.
    });
    return {
      openUrl: buildLocalWorkflowOpenBridgeUrl(resolvedTarget.toString()),
      targetUrl: resolvedTarget.toString(),
      via: 'self-contained-auth',
    };
  }

  // No credentials available — fall back to direct URL.
  return {
    openUrl: resolvedTarget.toString(),
    targetUrl: resolvedTarget.toString(),
    via: 'direct',
  };
}

function normalizeUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}
