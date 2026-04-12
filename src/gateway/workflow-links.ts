import { YagrN8nConfigService } from '../config/n8n-config-service.js';
import { buildManagedN8nWorkflowOpenDataUrl } from '../n8n-local/browser-auth.js';
import { ManagedN8nOwnerCredentialService } from '../n8n-local/owner-credentials.js';

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
    /** Local n8n origin behind the tunnel, used to recover owner credentials. */
    n8nTunnelTargetUrl?: string;
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
  const configuredHostOrigin = options.n8nConfigService
    ? normalizeUrl(options.n8nConfigService.getLocalConfig().host ?? '')?.origin
    : undefined;
  const tunnelTargetOrigin = options.n8nTunnelTargetUrl
    ? normalizeUrl(options.n8nTunnelTargetUrl)?.origin
    : undefined;
  const shouldUseConfiguredHostFallback = Boolean(options.n8nTunnelPublicUrl && configuredHostOrigin);

  // Look up owner credentials: try the resolved origin first (tunnel), then fall back
  // to the original origin (local n8n), the tunnel target origin, and the configured local host since credentials
  // are stored against the local URL even when the active instance host is tunnelized.
  const ownerCredentials =
    ownerCredentialService.get(resolvedTarget.origin) ??
    ownerCredentialService.get(targetUrl.origin) ??
    (tunnelTargetOrigin ? ownerCredentialService.get(tunnelTargetOrigin) : undefined) ??
    (shouldUseConfiguredHostFallback ? ownerCredentialService.get(configuredHostOrigin!) : undefined);

  // If we have credentials, generate the self-contained auth URL.
  // The data: URI contains a form that POSTs directly to the tunnel domain
  // via a hidden iframe — no CORS issues, cookies are set correctly.
  if (ownerCredentials) {
    const loginUrl = new URL('/rest/login', resolvedTarget.origin).toString();
    return {
      openUrl: buildManagedN8nWorkflowOpenDataUrl({
        targetUrl: resolvedTarget.toString(),
        loginUrl,
        credentials: ownerCredentials,
      }),
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
