/**
 * N8n-specific middleware that enriches workflow embed events with
 * resolved URLs (tunnel substitution, self-contained auth).
 *
 * The generic runtime emits raw workflow events; this middleware
 * intercepts them and adds the n8n-specific URL resolution layer.
 */
import { resolveWorkflowOpenLink } from './workflow-links.js';
import { getActiveTunnelState } from '../n8n-local/n8n-tunnel.js';
/**
 * Creates a middleware that intercepts workflow embed events and
 * resolves proper n8n URLs (tunnel public URL, self-contained auth).
 *
 * @deprecated URL resolution is now done at the source in `presentWorkflowResultCli()`.
 *             This middleware is kept for backward compatibility but will be removed
 *             in a future version. Prefer resolving URLs at emit time.
 *
 * Usage:
 *   const middleware = createN8nWorkflowMiddleware({ onEnrichedEvent: forwardToGateway });
 *   runOptions.onToolEvent = (event) => middleware(event);
 */
export function createN8nWorkflowMiddleware(options = {}) {
    return async function n8nWorkflowMiddleware(event) {
        const enrichedEvent = enrichWorkflowEmbed(event);
        await options.onEnrichedEvent?.(enrichedEvent);
    };
}
/**
 * Enriches a tool event with resolved workflow URLs when applicable.
 * Returns the original event unchanged if it is not a workflow embed.
 *
 * @deprecated URL resolution is now done at the source in `presentWorkflowResultCli()`.
 *             This middleware is kept for backward compatibility with `langgraph-events.ts`
 *             but will be removed in a future version. Prefer resolving URLs at emit time.
 */
export function enrichWorkflowEmbed(event) {
    if (event.type !== 'embed' || event.kind !== 'workflow') {
        return event;
    }
    const rawUrl = event.url;
    if (!rawUrl)
        return event;
    // `presentWorkflowResultCli()` already resolves workflow links at the source.
    // If the embed already carries a resolved `targetUrl` or `via`, do not run
    // the deprecated compatibility enrichment again or we may clobber the
    // canonical target with the self-contained `data:` URL.
    if (typeof event.targetUrl === 'string' || typeof event.via === 'string') {
        return event;
    }
    const n8nTunnelPublicUrl = getActiveTunnelState()?.publicUrl;
    const workflowLink = resolveWorkflowOpenLink(rawUrl, { n8nTunnelPublicUrl });
    return {
        ...event,
        url: workflowLink.openUrl,
        targetUrl: workflowLink.targetUrl,
        via: workflowLink.via,
    };
}
//# sourceMappingURL=n8n-workflow-middleware.js.map