# Tunneling and Workflow Presentation Architecture

## Overview

Two distinct Cloudflare Tunnel use-cases exist in Yagr, with separate operational scopes:

| Tunnel | Active when | Purpose | n8nac host |
|--------|-------------|---------|------------|
| **n8n local tunnel** | Yagr-managed local n8n | Expose local n8n publicly for webhooks | Updated to tunnel public URL |
| **LLM proxy tunnel** | Cloud n8n instances | Allow cloud n8n to reach the local LLM relay | Not modified |

## Workflow Presentation URL Resolution

`yagr presentWorkflowResult` returns a resolved URL that handles authentication transparently.

### Resolution pipeline

```
presentWorkflowResultCli(workflowId, workflowUrl?)
     │
     ├─ resolveWorkflowUrl(workflowId, workflowUrl)
     │     → local n8n host + workflow path
     │     → substitutes tunnel origin if active
     │
     ├─ resolveWorkflowOpenLink(canonicalUrl, {
           n8nTunnelPublicUrl: getActiveTunnelState()?.publicUrl
         })
     │     → via 'direct': plain URL (no credentials)
     │     → via 'self-contained-auth': bridge URL via auth bridge
     │
     └─ buildLocalWorkflowOpenBridgeUrl() / resolvePreferredWorkflowOpenBridgeUrl()
           → local HTTP bridge server (port 3791) handles auth via
             helper popup window to n8n /rest/login, then redirects
           → when tunnel active: tunnel URL routes to bridge server
```

### `via` field

The `WorkflowEmbedPayload` includes a `via: 'direct' | 'self-contained-auth'` field so consumers know how the URL was resolved. When `via: 'self-contained-auth'`, the URL points to the local workflow open bridge which handles authentication via a helper popup window.

## n8nac Host Sync

n8nac constructs webhook URLs from its configured host in `n8nac-config.json`, not from n8n's reported URL. When a Cloudflare tunnel becomes active for a Yagr-managed instance, the active instance's host URL must be updated so webhook URLs are correct.

### Sync points

| Event | Action |
|-------|--------|
| Tunnel starts (`n8n-tunnel-setup`, `n8n-tunnel-start`, `n8n-tunnel-refresh`) | `YagrN8nConfigService.syncN8nacHostUrl(tunnelPublicUrl)` |
| `ensureTunnelAtLaunch()` | Same sync after starting tunnel |
| `restartManagedN8nForTunnel()` | Same sync before restart |
| Tunnel stops (`n8n-tunnel-stop`) | Revert to `http://127.0.0.1:{managedState.port}` |

### Implementation

`YagrN8nConfigService.syncN8nacHostUrl(tunnelPublicUrl)` reads and patches the active instance in `n8nac-config.json` in-place. Best-effort: errors are silently ignored so tunnel issues don't block startup.

For Yagr-managed instances, the instance identifier is stable (`"yagr-managed"`) and does not change with the host URL.

## Auth Bridge Architecture

The auth bridge replaces the self-contained data URL approach. It consists of:

### Local Workflow Open Bridge (`src/gateway/local-open-bridge.ts`)

A local HTTP server (default `127.0.0.1:3791`) that:
- Receives workflow open requests via `/open/n8n-workflow/{token}`
- Resolves the target URL from persisted bridge targets
- Handles authentication via a helper popup window (not iframe-based)
- Redirects to the target workflow once the session cookie is set

### Bridge Target Resolution

| Scenario | URL Resolution |
|----------|----------------|
| No tunnel, no credentials | Direct URL to local n8n |
| No tunnel, has credentials | Bridge URL with data: page containing auth form |
| Tunnel active, no credentials | Direct URL to tunnel public URL |
| Tunnel active, has credentials | Tunnel URL routed to bridge server |

### Auth Flow (with credentials)

1. `resolveWorkflowOpenLink()` detects owner credentials exist
2. Generates a bridge URL: `http://127.0.0.1:3791/open/n8n-workflow/{token}`
3. The bridge serves a data: URL page containing an HTML form
4. A helper popup window POSTs credentials to n8n `/rest/login`
5. After 1.2s, the popup closes and main window redirects to workflow

### Tunnel Bridge Integration

When a Cloudflare tunnel is active for workflow open:
- `resolvePreferredWorkflowOpenBridgeUrl()` returns the tunnel URL
- The tunnel routes `/open/n8n-workflow/*` to the local bridge server
- This allows cloud consumers to reach the local bridge through the tunnel

## Deprecated middleware

`enrichWorkflowEmbed()` in `src/gateway/n8n-workflow-middleware.ts` is deprecated. URL resolution is now done at the source in `presentWorkflowResultCli()`. The middleware is retained for backward compatibility with `langgraph-events.ts` but will be removed in a future version.

## Files changed

| File | Change |
|------|--------|
| `src/manager-tooling/present-workflow.ts` | `presentWorkflowResultCli()` now calls `resolveWorkflowOpenLink()`; `via` field added to payload |
| `src/gateway/n8n-workflow-middleware.ts` | `enrichWorkflowEmbed()` deprecated; `via` field added to return type |
| `src/gateway/local-open-bridge.ts` | Auth bridge server for workflow open with helper popup auth |
| `src/n8n-local/browser-auth.ts` | Helper popup window auth (not iframe-based) for self-contained auth |
| `src/types.ts` | `via` field added to `YagrToolEvent.embed` |
| `src/config/n8n-config-service.ts` | `syncN8nacHostUrl()` added |
| `src/cli.ts` | n8nac host sync wired into tunnel lifecycle |

## Tests

- `tests/n8nac-host-sync.test.mjs` — `syncN8nacHostUrl()` correctness and error handling
- `tests/workflow-links.test.mjs` — `resolveWorkflowOpenLink()` behavior with/without credentials and tunnel
- `tests/local-open-bridge.test.mjs` — Bridge URL generation, target resolution, and tunnel integration
- `tests/present-workflow-result.test.mjs` — `resolveWorkflowDiagram()` and `extractWorkflowMapHeader()`