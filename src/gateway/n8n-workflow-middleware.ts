/**
 * N8n-specific middleware that enriches workflow embed events with
 * resolved URLs (tunnel substitution, self-contained auth).
 *
 * The generic runtime emits raw workflow events; this middleware
 * intercepts them and adds the n8n-specific URL resolution layer.
 */

import type { YagrToolEvent } from '../types.js';
import { resolveWorkflowOpenLink } from './workflow-links.js';
import { getActiveTunnelState } from '../n8n-local/n8n-tunnel.js';

export interface N8nWorkflowMiddlewareOptions {
  /** Called with the enriched event after URL resolution. */
  onEnrichedEvent?: (event: YagrToolEvent) => void | Promise<void>;
}

/**
 * Creates a middleware that intercepts workflow embed events and
 * resolves proper n8n URLs (tunnel public URL, self-contained auth).
 *
 * Usage:
 *   const middleware = createN8nWorkflowMiddleware({ onEnrichedEvent: forwardToGateway });
 *   runOptions.onToolEvent = (event) => middleware(event);
 */
export function createN8nWorkflowMiddleware(
  options: N8nWorkflowMiddlewareOptions = {},
): (event: YagrToolEvent) => void | Promise<void> {
  return async function n8nWorkflowMiddleware(event: YagrToolEvent): Promise<void> {
    const enrichedEvent = enrichWorkflowEmbed(event);
    await options.onEnrichedEvent?.(enrichedEvent);
  };
}

/**
 * Enriches a tool event with resolved workflow URLs when applicable.
 * Returns the original event unchanged if it is not a workflow embed.
 */
export function enrichWorkflowEmbed(event: YagrToolEvent): YagrToolEvent {
  if (event.type !== 'embed' || event.kind !== 'workflow') {
    return event;
  }

  const rawUrl = event.url;
  if (!rawUrl) return event;

  const n8nTunnelPublicUrl = getActiveTunnelState()?.publicUrl;
  const workflowLink = resolveWorkflowOpenLink(rawUrl, { n8nTunnelPublicUrl });

  return {
    ...event,
    url: workflowLink.openUrl,
    targetUrl: workflowLink.targetUrl,
  };
}
