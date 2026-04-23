/**
 * N8n-specific middleware that enriches workflow embed events with
 * resolved URLs (tunnel substitution, self-contained auth).
 *
 * The generic runtime emits raw workflow events; this middleware
 * intercepts them and adds the n8n-specific URL resolution layer.
 */
import type { YagrToolEvent } from '../types.js';
export interface N8nWorkflowMiddlewareOptions {
    /** Called with the enriched event after URL resolution. */
    onEnrichedEvent?: (event: YagrToolEvent) => void | Promise<void>;
}
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
export declare function createN8nWorkflowMiddleware(options?: N8nWorkflowMiddlewareOptions): (event: YagrToolEvent) => void | Promise<void>;
/**
 * Enriches a tool event with resolved workflow URLs when applicable.
 * Returns the original event unchanged if it is not a workflow embed.
 *
 * @deprecated URL resolution is now done at the source in `presentWorkflowResultCli()`.
 *             This middleware is kept for backward compatibility with `langgraph-events.ts`
 *             but will be removed in a future version. Prefer resolving URLs at emit time.
 */
export declare function enrichWorkflowEmbed(event: YagrToolEvent): YagrToolEvent;
//# sourceMappingURL=n8n-workflow-middleware.d.ts.map