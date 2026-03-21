import { YagrConfigService } from '../config/yagr-config-service.js';
import { ManagedN8nOwnerCredentialService } from '../n8n-local/owner-credentials.js';

const DEFAULT_WEBUI_HOST = '127.0.0.1';
const DEFAULT_WEBUI_PORT = 3789;

export interface WorkflowOpenLink {
  openUrl: string;
  targetUrl: string;
  via: 'direct' | 'webui-auth';
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

  const configService = options.configService ?? new YagrConfigService();
  const ownerCredentialService = options.ownerCredentialService ?? new ManagedN8nOwnerCredentialService();
  const ownerCredentials = ownerCredentialService.get(targetUrl.origin);
  const enabledSurfaces = configService.getEnabledGatewaySurfaces();
  if (!ownerCredentials || !enabledSurfaces.includes('webui')) {
    return {
      openUrl: targetUrl.toString(),
      targetUrl: targetUrl.toString(),
      via: 'direct',
    };
  }

  const webUiBaseUrl = getConfiguredWebUiBaseUrl(configService);
  return {
    openUrl: `${webUiBaseUrl}/open/n8n-workflow?target=${encodeURIComponent(targetUrl.toString())}`,
    targetUrl: targetUrl.toString(),
    via: 'webui-auth',
  };
}

function normalizeUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function getConfiguredWebUiBaseUrl(configService: YagrConfigService): string {
  const config = configService.getLocalConfig();
  const host = sanitizeHost(config.gateway?.webui?.host);
  const port = sanitizePort(config.gateway?.webui?.port);
  return `http://${host}:${port}`;
}

function sanitizeHost(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed || DEFAULT_WEBUI_HOST;
}

function sanitizePort(value: number | undefined): number {
  if (!Number.isInteger(value) || Number(value) <= 0 || Number(value) > 65535) {
    return DEFAULT_WEBUI_PORT;
  }

  return Number(value);
}
