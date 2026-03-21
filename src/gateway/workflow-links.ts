import { YagrConfigService } from '../config/yagr-config-service.js';
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
    configService?: YagrConfigService;
    ownerCredentialService?: ManagedN8nOwnerCredentialService;
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

  void (options.configService ?? new YagrConfigService());
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
