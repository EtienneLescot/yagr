import { ManagedN8nOwnerCredentialService } from '../n8n-local/owner-credentials.js';
import { resolvePreferredWorkflowOpenBridgeUrl } from './local-open-bridge.js';
export function resolveWorkflowOpenLink(workflowUrl, options = {}) {
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
    const resolvedTarget = normalizeUrl(resolvedTargetUrl);
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
    const ownerCredentials = ownerCredentialService.get(resolvedTarget.origin) ??
        ownerCredentialService.get(targetUrl.origin) ??
        (tunnelTargetOrigin ? ownerCredentialService.get(tunnelTargetOrigin) : undefined) ??
        (shouldUseConfiguredHostFallback ? ownerCredentialService.get(configuredHostOrigin) : undefined);
    // If we have credentials, generate the bridge URL.
    // The bridge serves the auth HTML page and handles the login flow.
    if (ownerCredentials) {
        return {
            openUrl: resolvePreferredWorkflowOpenBridgeUrl(resolvedTarget.toString(), options.n8nTunnelPublicUrl),
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
function normalizeUrl(value) {
    try {
        return new URL(value);
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=workflow-links.js.map