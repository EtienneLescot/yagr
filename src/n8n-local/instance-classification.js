import { YagrN8nConfigService } from '../config/n8n-config-service.js';
import { readManagedN8nState } from './state.js';
export function normalizeN8nUrlOrigin(url) {
    if (!url) {
        return undefined;
    }
    try {
        return new URL(url).origin;
    }
    catch {
        return url.replace(/\/$/, '');
    }
}
function doesManagedStateMatchTunnelTarget(managedState, tunnelConfig) {
    const managedOrigin = normalizeN8nUrlOrigin(managedState?.url);
    const targetOrigin = normalizeN8nUrlOrigin(tunnelConfig?.targetUrl);
    return Boolean(tunnelConfig?.enabled && managedOrigin && targetOrigin && managedOrigin === targetOrigin);
}
export function doesConfiguredHostReferenceManagedRuntime(input) {
    const managedOrigin = normalizeN8nUrlOrigin(input.managedState?.url);
    const hostOrigin = normalizeN8nUrlOrigin(input.host);
    if (managedOrigin && hostOrigin && managedOrigin === hostOrigin) {
        return true;
    }
    const publicOrigin = normalizeN8nUrlOrigin(input.tunnelConfig?.publicUrl);
    return Boolean(hostOrigin
        && publicOrigin
        && hostOrigin === publicOrigin
        && doesManagedStateMatchTunnelTarget(input.managedState, input.tunnelConfig));
}
export function isLocalN8nUrl(urlString) {
    if (!urlString) {
        return false;
    }
    try {
        const { hostname } = new URL(urlString);
        return (hostname === 'localhost' ||
            hostname === '[::1]' ||
            hostname === '::1' ||
            /^127\./.test(hostname) ||
            /^10\./.test(hostname) ||
            /^192\.168\./.test(hostname) ||
            /^172\.(1[6-9]|2\d|3[01])\./.test(hostname));
    }
    catch {
        return false;
    }
}
function buildCapabilities(tags) {
    const isManaged = tags.includes('YAGR_MANAGED');
    const isCloud = tags.includes('CLOUD');
    return {
        supportsManagedTunnel: isManaged,
        requiresLlmProxyTunnel: isCloud,
        shouldProvisionYagrLlmProxy: true,
        shouldAutoStartManagedRuntime: isManaged,
    };
}
export function resolveN8nInstanceProfile(input) {
    const managedStateMatchesHost = doesConfiguredHostReferenceManagedRuntime({
        host: input.host,
        managedState: input.managedState,
        tunnelConfig: input.tunnelConfig,
    });
    if (managedStateMatchesHost) {
        const managedProfile = input.managedState?.strategy === 'docker'
            ? 'yagr-managed-docker'
            : 'yagr-managed-direct';
        if (!input.instanceProfile
            || input.instanceProfile === 'custom-local-docker'
            || input.instanceProfile === 'custom-local-direct') {
            return managedProfile;
        }
    }
    if (input.instanceProfile) {
        return input.instanceProfile;
    }
    if (!input.host) {
        return undefined;
    }
    return isLocalN8nUrl(input.host) ? 'custom-local-direct' : 'custom-cloud';
}
function classifyConfiguredProfile(input) {
    const host = input.host?.trim() || undefined;
    const instanceProfile = input.instanceProfile;
    let kind;
    if (!instanceProfile) {
        kind = host ? 'unconfigured' : 'unconfigured';
    }
    else if (instanceProfile === 'custom-cloud') {
        kind = 'cloud';
    }
    else if (instanceProfile === 'custom-local-direct' || instanceProfile === 'custom-local-docker') {
        kind = 'local';
    }
    else {
        kind = 'yagr-managed-local';
    }
    const tags = resolveTags({ kind, instanceProfile, managedState: input.managedState, host });
    return {
        kind,
        host,
        instanceProfile,
        tags,
        managedState: input.managedState,
        capabilities: buildCapabilities(tags),
    };
}
function resolveTags(input) {
    const tags = [];
    if (input.kind === 'yagr-managed-local') {
        tags.push('YAGR_MANAGED');
        if (input.instanceProfile === 'yagr-managed-docker'
            || input.instanceProfile === 'custom-local-docker'
            || input.managedState?.strategy === 'docker') {
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
export function classifyN8nInstanceCandidate(input) {
    const host = input.host?.trim() || undefined;
    const managedState = input.managedState;
    const instanceProfile = resolveN8nInstanceProfile(input);
    const isManagedFromProfile = instanceProfile === 'yagr-managed-docker' || instanceProfile === 'yagr-managed-direct';
    const isManaged = isManagedFromProfile;
    let kind;
    if (instanceProfile === 'custom-cloud') {
        kind = 'cloud';
    }
    else if (instanceProfile === 'custom-local-direct' || instanceProfile === 'custom-local-docker') {
        kind = 'local';
    }
    else if (isManaged) {
        kind = 'yagr-managed-local';
    }
    else if (!host) {
        kind = 'unconfigured';
    }
    else if (isLocalN8nUrl(host)) {
        kind = 'local';
    }
    else {
        kind = 'cloud';
    }
    const tags = resolveTags({ kind, instanceProfile, managedState: isManaged ? managedState : undefined, host });
    return {
        kind,
        host,
        instanceProfile,
        tags,
        managedState,
        capabilities: buildCapabilities(tags),
    };
}
export function classifyConfiguredN8nInstance(configService = new YagrN8nConfigService()) {
    const managedState = readManagedN8nState();
    const localConfig = configService.getLocalConfig();
    return classifyConfiguredProfile({
        host: localConfig.host,
        instanceProfile: localConfig.instanceProfile,
        managedState,
    });
}
export function hasN8nInstanceTag(classification, tag) {
    return classification.tags.includes(tag);
}
//# sourceMappingURL=instance-classification.js.map