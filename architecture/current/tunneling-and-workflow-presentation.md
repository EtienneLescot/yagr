# Tunneling and Workflow Presentation Architecture

## Overview

Three Cloudflare Tunnel use-cases exist in Yagr, with separate operational scopes:

| Tunnel | Active when | Purpose | n8nac host |
|--------|-------------|---------|------------|
| **n8n tunnel** | Yagr-managed local n8n | Expose local n8n publicly for webhooks | Updated to tunnel public URL |
| **n8n auth tunnel** | Remote surfaces opening workflows | Expose the local n8n auth bridge publicly | Not modified |
| **llm tunnel** | Cloud n8n instances | Allow cloud n8n to reach the local LLM relay | Not modified |

The tunnel policy is split across two SSOT modules:

- `src/n8n-local/n8n-tunnel.ts` owns the `cloudflared` process lifecycle, state files, and `TUNNEL_DOMAIN` custom-domain handling
- `src/n8n-local/tunnel-reachability.ts` owns wake-up policy by consumer/facade and the `YAGR_TUNNEL_REACHABILITY_MODE` override

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
     └─ resolveWorkflowOpenLink(canonicalUrl, {
           n8nTunnelPublicUrl: getActiveTunnelState()?.publicUrl
         })
           → via 'direct': plain workflow URL
           → via 'self-contained-auth': bridge HTTP URL (local or tunnelized)
```

`resolveWorkflowOpenLink()` calls `resolvePreferredWorkflowOpenBridgeUrl()` internally when credentials are found, so `payload.url` is always the final consumable URL. No facade-side re-resolution is needed.

### `via` field

The `WorkflowEmbedPayload` includes a `via: 'direct' | 'self-contained-auth'` field for observability and light UI branching. When `via: 'self-contained-auth'`, `payload.url` is the bridge URL; the bridge serves the auth HTML and handles the helper popup login flow.

## n8nac Host Sync

n8nac constructs webhook URLs from its configured host in `n8nac-config.json`, not from n8n's reported URL. When a Cloudflare tunnel becomes active for a Yagr-managed instance, the active instance's host URL must be updated so webhook URLs are correct.

### Sync points

| Event | Action |
|-------|--------|
| Tunnel starts (`n8n-tunnel-setup`, `n8n-tunnel-start`, `n8n-tunnel-refresh`) | `YagrN8nConfigService.syncN8nacHostUrl(tunnelPublicUrl)` |
| `ensureConfiguredN8nTunnelReachability()` | Same sync after waking the n8n tunnel |
| `restartManagedN8nForTunnel()` | Same sync before restart |
| Tunnel stops (`n8n-tunnel-stop`) | Revert to `http://127.0.0.1:{managedState.port}` |

### Custom-domain mode

When `TUNNEL_DOMAIN` is set, tunnel startup no longer relies on `trycloudflare` URL discovery. Instead, Yagr:

1. derives a per-service hostname and tunnel name from `TUNNEL_DOMAIN`
2. ensures the named Cloudflare tunnel exists locally
3. ensures `cloudflared tunnel route dns <tunnel> <hostname>` is applied
4. runs `cloudflared` with an explicit config bound to that tunnel and hostname

This keeps custom-domain handling centralized in `n8n-tunnel.ts` rather than duplicating DNS logic across setup and façade code.

### Implementation

`YagrN8nConfigService.syncN8nacHostUrl(tunnelPublicUrl)` reads and patches the active instance in `n8nac-config.json` in-place. Best-effort: errors are silently ignored so tunnel issues don't block startup.

For Yagr-managed instances, the instance identifier is stable (`"yagr-managed"`) and does not change with the host URL.

## Auth Bridge Architecture

The auth bridge replaces the self-contained data URL approach. It consists of:

### Local n8n Auth Bridge (`src/gateway/local-open-bridge.ts`)

A local HTTP server (default `127.0.0.1:3791`) that:
- Receives workflow open requests via `/open/n8n-workflow/{token}`
- Resolves the target URL from persisted bridge targets
- Handles authentication via a helper popup window (not iframe-based)
- Redirects to the target workflow once the session cookie is set

### Bridge Target Resolution

| Scenario | URL Resolution |
|----------|----------------|
| No tunnel, no credentials | Direct URL to local n8n |
| No tunnel, has credentials | Local bridge URL (`http://127.0.0.1:3791/open/n8n-workflow/{token}`) |
| Tunnel active, no credentials | Direct URL to tunnel public URL |
| Tunnel active, has credentials | Tunnel bridge URL (`https://{tunnel}/open/n8n-workflow/{token}`) |

### Auth Flow (with credentials)

1. `resolveWorkflowOpenLink()` detects owner credentials exist
2. Calls `resolvePreferredWorkflowOpenBridgeUrl()` internally, which registers the target and returns a bridge URL
3. The bridge serves an HTML auth page via a helper popup window
4. A helper popup window POSTs credentials to n8n `/rest/login`
5. After 1.2s, the popup closes and main window redirects to workflow

### Tunnel Bridge Integration

When a Cloudflare tunnel is active for n8n auth:
- `resolvePreferredWorkflowOpenBridgeUrl()` returns the tunnel URL
- The tunnel routes `/open/n8n-workflow/*` to the local bridge server
- This allows cloud consumers to reach the local bridge through the tunnel

### Reachability policy

- `n8n tunnel` and `n8n auth tunnel` are lazy: they are started explicitly during setup/CLI flows, then woken by facades that need them
- `llm tunnel` is also policy-driven, but only when `llmProxy.mode === 'tunnel'`
- `force-all-facades` (**default since this change**): all facades wake public tunnels so URLs are uniform and shareable across surfaces. Set `YAGR_TUNNEL_REACHABILITY_MODE=on-demand` to revert to lazy behavior

## Deprecated middleware

`enrichWorkflowEmbed()` in `src/gateway/n8n-workflow-middleware.ts` is deprecated. URL resolution is now done at the source in `presentWorkflowResultCli()`. The middleware is retained for backward compatibility with `langgraph-events.ts` but will be removed in a future version.

Facade-side bridge URL re-resolution is also deprecated: `resolvePreferredWorkflowOpenBridgeUrl()` must not be called on top-level workflow embeds in gateway consumers. `presentWorkflowResultCli()` is the single authoritative source for the final URL.

## Files changed (this refactor)

| File | Change |
|------|--------|
| `src/gateway/workflow-links.ts` | `self-contained-auth` now returns bridge URL via `resolvePreferredWorkflowOpenBridgeUrl()` instead of a data: URL |
| `src/gateway/webui.ts` | Removed facade-side bridge URL re-resolution in `onWorkflowEmbed` |
| `src/gateway/format-message.ts` | Removed `resolvePreferredWorkflowOpenBridgeUrl()` calls; facades consume `embed.url` directly |
| `src/gateway/telegram.ts` | Removed `openBaseUrl` fallback argument to `buildWorkflowBannerHtml` |
| `src/n8n-local/tunnel-reachability.ts` | `force-all-facades` is now the default reachability mode |
| `src/config/yagr-config-service.ts` | Updated `YagrTunnelBehaviorConfig` comment to reflect the new default |

## Tests

- `tests/n8nac-host-sync.test.mjs` — `syncN8nacHostUrl()` correctness and error handling
- `tests/workflow-links.test.mjs` — `resolveWorkflowOpenLink()` behavior with/without credentials and tunnel
- `tests/local-open-bridge.test.mjs` — Bridge URL generation, target resolution, and tunnel integration
- `tests/present-workflow-result.test.mjs` — `resolveWorkflowDiagram()` and `extractWorkflowMapHeader()`
