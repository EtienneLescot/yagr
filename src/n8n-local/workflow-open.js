import { YagrN8nConfigService } from '../config/n8n-config-service.js';
import { buildManagedN8nWorkflowOpenPage } from './browser-auth.js';
import { ManagedN8nOwnerCredentialService } from './owner-credentials.js';
import { getActiveTunnelState } from './n8n-tunnel.js';
export function resolveManagedN8nWorkflowOpen(target) {
    if (!target) {
        return { ok: false, statusCode: 400, error: 'Workflow target URL is required.' };
    }
    const n8nConfig = new YagrN8nConfigService().getLocalConfig();
    if (!n8nConfig.host) {
        return { ok: false, statusCode: 400, error: 'n8n is not configured yet.' };
    }
    let targetUrl;
    let configuredHost;
    try {
        targetUrl = new URL(target);
        configuredHost = new URL(n8nConfig.host);
    }
    catch {
        return { ok: false, statusCode: 400, error: 'Workflow target URL is invalid.' };
    }
    // Check if the target URL matches the configured n8n host or the active tunnel.
    const tunnelPublicUrl = getActiveTunnelState()?.publicUrl;
    const tunnelTargetUrl = getActiveTunnelState()?.targetUrl;
    const tunnelOrigin = tunnelPublicUrl ? new URL(tunnelPublicUrl).origin : null;
    const isLocalTarget = targetUrl.origin === configuredHost.origin;
    const isTunnelTarget = tunnelOrigin && targetUrl.origin === tunnelOrigin;
    if (!isLocalTarget && !isTunnelTarget) {
        return { ok: false, statusCode: 400, error: 'Workflow target URL does not match the configured n8n host.' };
    }
    // Look up owner credentials for the local n8n instance. When the configured
    // host is already tunnelized, the credentials may still be stored against the
    // tunnel target's local origin.
    const credentialLookupOrigins = new Set([configuredHost.origin]);
    if (tunnelTargetUrl) {
        try {
            credentialLookupOrigins.add(new URL(tunnelTargetUrl).origin);
        }
        catch {
            // ignore invalid persisted tunnel target
        }
    }
    let ownerCredentials;
    for (const origin of credentialLookupOrigins) {
        ownerCredentials = new ManagedN8nOwnerCredentialService().get(origin);
        if (ownerCredentials) {
            break;
        }
    }
    if (!ownerCredentials) {
        return {
            ok: true,
            payload: {
                mode: 'direct',
                targetUrl: targetUrl.toString(),
            },
        };
    }
    // Build the login URL using the target's origin (tunnel or local) so the POST
    // goes to the same domain as the workflow page — the browser then stores the
    // session cookie for that origin.
    const loginOrigin = isTunnelTarget ? targetUrl.origin : configuredHost.origin;
    const loginUrl = new URL('/rest/login', loginOrigin).toString();
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
//# sourceMappingURL=workflow-open.js.map