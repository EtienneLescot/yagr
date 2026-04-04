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
  // The data: URI works via tunnels too — the browser POSTs through the tunnel to n8n.
  if (ownerCredentials) {
    // Build the login URL using the resolved target origin (tunnel if active)
    // so the POST request goes through the same origin as the workflow URL.
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
