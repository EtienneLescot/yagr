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

  // When a tunnel is active, expose the public URL directly.
  // The self-contained auth bridge is a local data: URI — not useful externally.
  if (options.n8nTunnelPublicUrl) {
    const tunnelOrigin = normalizeUrl(options.n8nTunnelPublicUrl)?.origin;
    if (tunnelOrigin) {
      const publicUrl = targetUrl.toString().replace(targetUrl.origin, tunnelOrigin);
      return {
        openUrl: publicUrl,
        targetUrl: targetUrl.toString(),
        via: 'direct',
      };
    }
  }

  const n8nConfigService = options.n8nConfigService ?? new YagrN8nConfigService();
  const configuredHost = n8nConfigService.getLocalConfig().host;
  if (configuredHost) {
    const configuredOrigin = normalizeUrl(configuredHost)?.origin;
    if (configuredOrigin && configuredOrigin !== targetUrl.origin) {
      return {
        openUrl: targetUrl.toString(),
        targetUrl: targetUrl.toString(),
        via: 'direct',
      };
    }
  }

  const ownerCredentialService = options.ownerCredentialService ?? new ManagedN8nOwnerCredentialService();
  const ownerCredentials = ownerCredentialService.get(targetUrl.origin);
  if (!ownerCredentials) {
    return {
      openUrl: targetUrl.toString(),
      targetUrl: targetUrl.toString(),
      via: 'direct',
    };
  }

  const loginUrl = new URL('/rest/login', targetUrl.origin).toString();
  return {
    openUrl: buildManagedN8nWorkflowOpenDataUrl({
      targetUrl: targetUrl.toString(),
      loginUrl,
      credentials: ownerCredentials,
    }),
    targetUrl: targetUrl.toString(),
    via: 'self-contained-auth',
  };
}

function normalizeUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}
