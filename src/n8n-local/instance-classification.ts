import { YagrN8nConfigService, type YagrN8nInstanceProfile, type YagrN8nLocalConfig } from '../config/n8n-config-service.js';
import { readManagedN8nState, type ManagedN8nInstanceState } from './state.js';

export type N8nInstanceTag = 'YAGR_MANAGED' | 'DOCKER' | 'CLOUD';

export type N8nInstanceKind = 'unconfigured' | 'yagr-managed-local' | 'local' | 'cloud';

export interface N8nInstanceCapabilities {
  supportsManagedTunnel: boolean;
  requiresLlmProxyTunnel: boolean;
  shouldProvisionYagrLlmProxy: boolean;
  shouldAutoStartManagedRuntime: boolean;
}

export interface N8nInstanceClassification {
  kind: N8nInstanceKind;
  host?: string;
  instanceProfile?: YagrN8nInstanceProfile;
  tags: N8nInstanceTag[];
  managedState?: ManagedN8nInstanceState;
  capabilities: N8nInstanceCapabilities;
}

export function normalizeN8nUrlOrigin(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }

  try {
    return new URL(url).origin;
  } catch {
    return url.replace(/\/$/, '');
  }
}

export function isLocalN8nUrl(urlString: string | undefined): boolean {
  if (!urlString) {
    return false;
  }

  try {
    const { hostname } = new URL(urlString);
    return (
      hostname === 'localhost' ||
      hostname === '[::1]' ||
      hostname === '::1' ||
      /^127\./.test(hostname) ||
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    );
  } catch {
    return false;
  }
}

function buildCapabilities(tags: readonly N8nInstanceTag[]): N8nInstanceCapabilities {
  const isManaged = tags.includes('YAGR_MANAGED');
  const isCloud = tags.includes('CLOUD');

  return {
    supportsManagedTunnel: isManaged,
    requiresLlmProxyTunnel: isCloud,
    shouldProvisionYagrLlmProxy: true,
    shouldAutoStartManagedRuntime: isManaged,
  };
}

export function resolveN8nInstanceProfile(input: {
  host?: string;
  instanceProfile?: YagrN8nInstanceProfile;
  managedState?: ManagedN8nInstanceState;
}): YagrN8nInstanceProfile | undefined {
  if (input.instanceProfile) {
    return input.instanceProfile;
  }

  if (!input.host) {
    return undefined;
  }

  return isLocalN8nUrl(input.host) ? 'custom-local-direct' : 'custom-cloud';
}

function resolveTags(input: {
  kind: N8nInstanceKind;
  instanceProfile?: YagrN8nInstanceProfile;
  managedState?: ManagedN8nInstanceState;
  host?: string;
}): N8nInstanceTag[] {
  const tags: N8nInstanceTag[] = [];

  if (input.kind === 'yagr-managed-local') {
    tags.push('YAGR_MANAGED');
    if (
      input.instanceProfile === 'yagr-managed-docker'
      || input.instanceProfile === 'custom-local-docker'
      || input.managedState?.strategy === 'docker'
    ) {
      tags.push('DOCKER');
    }
  }

  if (input.kind === 'local' && input.instanceProfile === 'custom-local-docker' && !tags.includes('DOCKER')) {
    tags.push('DOCKER');
  }

  if (input.kind === 'cloud') {
    tags.push('CLOUD');
  }

  const host = String(input.host ?? '').trim();
  if (!tags.includes('DOCKER') && /^https?:\/\/host\.docker\.internal(?::\d+)?/i.test(host)) {
    tags.push('DOCKER');
  }

  return tags;
}

export function classifyN8nInstanceCandidate(input: {
  host?: string;
  instanceProfile?: YagrN8nInstanceProfile;
  managedState?: ManagedN8nInstanceState;
}): N8nInstanceClassification {
  const host = input.host?.trim() || undefined;
  const managedState = input.managedState;
  const instanceProfile = resolveN8nInstanceProfile(input);
  const isManagedFromProfile = instanceProfile === 'yagr-managed-docker' || instanceProfile === 'yagr-managed-direct';
  const isManaged = isManagedFromProfile;

  let kind: N8nInstanceKind;
  if (instanceProfile === 'custom-cloud') {
    kind = 'cloud';
  } else if (instanceProfile === 'custom-local-direct' || instanceProfile === 'custom-local-docker') {
    kind = 'local';
  } else if (isManaged) {
    kind = 'yagr-managed-local';
  } else if (!host) {
    kind = 'unconfigured';
  } else if (isLocalN8nUrl(host)) {
    kind = 'local';
  } else {
    kind = 'cloud';
  }

  const tags = resolveTags({ kind, instanceProfile, managedState: isManaged ? managedState : undefined, host });
  return {
    kind,
    host,
    instanceProfile,
    tags,
    managedState: isManaged ? managedState : undefined,
    capabilities: buildCapabilities(tags),
  };
}

export function classifyConfiguredN8nInstance(
  configService: Pick<YagrN8nConfigService, 'getLocalConfig'> = new YagrN8nConfigService(),
): N8nInstanceClassification {
  const localConfig = configService.getLocalConfig();
  return classifyN8nInstanceCandidate({
    host: localConfig.host,
    instanceProfile: localConfig.instanceProfile,
    managedState: readManagedN8nState(),
  });
}

export function hasN8nInstanceTag(
  classification: Pick<N8nInstanceClassification, 'tags'>,
  tag: N8nInstanceTag,
): boolean {
  return classification.tags.includes(tag);
}