# Tunnel Lifecycle Refactor — Architecture Decision Record

**Date:** 2026-04-19
**Status:** Implemented (working tree, uncommitted)

---

## Context

Yagr had a Cloudflare tunnel spam problem: orphaned `cloudflared` processes leaked during startup timeouts and the generic auto-restart logic that restarting tunnels indiscriminately at gateway worker restart. Three tunnels existed (n8n, workflow-open/bridge, llm-proxy) with spawn logic distributed in facades, no central wake-up policy, broken `TUNNEL_DOMAIN` DNS routing, and legacy state file names still being read.

---

## Problems Found

1. **Original Bug:** `startN8nTunnel()` / `startNamedTunnel()` left detached `cloudflared` processes alive on timeout/early-close (the process was unref'd before the URL was captured)
2. **`ensureTunnelAtLaunch()`** in `cli.ts` restarting tunnels at every generic gateway worker restart, multiplying orphan accumulation
3. **`workflow-open tunnel`** auto-started with the main n8n tunnel from tunnel setup/stop/refresh CLI commands
4. **`TUNNEL_DOMAIN`** mode broken: `cloudflared tunnel route dns` was never called, so hostnames did not point to the tunnel

---

## Design Decision

### Tunnel Lifecycle SSOT (`src/n8n-local/n8n-tunnel.ts`)

The Cloudflare tunnel lifecycle process is centralized in a single module:

- `startN8nTunnel()` / `startNamedTunnel()` share a unique `startTunnel()` helper
- Timeout/close error calls `terminateProcess(pid)` to clean up orphan child before rejecting
- `getTunnelConfig(serviceName?)` centralizes `TUNNEL_DOMAIN` resolution
- `ensureTunnelDnsRoute(bin, tunnelName, hostname)` calls `cloudflared tunnel route dns <tunnel> <hostname>` with "already exists" tolerance
- State file paths renamed: `llm-tunnel.json`, `n8n-auth-tunnel.json`
- All legacy state file fallbacks have been removed

**New exported functions:**
- `ensureN8nTunnel()`, `startLlmTunnel()`, `startN8nAuthTunnel()`, `ensureN8nAuthTunnel()`, `stopN8nAuthTunnel()`, `stopAllTunnels()`, `getActiveN8nAuthTunnelState()`

**Internal renames:**
- `ProxyTunnelState` → `PublicAuxTunnelState`
- Field `tunnelUrl` → `publicUrl`

### Reachability SSOT (`src/n8n-local/tunnel-reachability.ts`)

Lazy tunnel wake-up module by consumer:

- `ensureConfiguredN8nTunnelReachability(consumer)` — lazy wake-up for n8n tunnel
- `ensureN8nAuthTunnelReachability(consumer)` — lazy wake-up for n8n auth tunnel
- `ensureFacadeTunnelReachability(consumer)` — orchestrates both
- `ensureConfiguredLlmTunnelReachability()` — lazy wake-up for llm tunnel
- `ensureLlmTunnelForRelayHostBaseUrl(hostBaseUrl, configService)` — direct llm tunnel startup
- `getTunnelReachabilityDebugSnapshot()` — debug snapshot
- `TunnelReachabilityConsumer = 'telegram' | 'webui' | 'tui' | 'cli' | 'setup' | 'llm'`
- `YAGR_TUNNEL_REACHABILITY_MODE` env var overrides config; `force-all-facades` mode wakes all tunnels from all consumers for testing
- `TUNNEL_DOMAIN` consumed from `n8n-tunnel.ts`, inherited by all child processes via `process.env`

### Facade Integration

Facades remain thin and delegate to the reachability SSOT:

- `src/gateway/telegram.ts`: calls `ensureFacadeTunnelReachability('telegram', configService)`
- `src/gateway/webui.ts`: calls `ensureFacadeTunnelReachability('webui', configService)`
- `src/cli.ts`: calls `ensureFacadeTunnelReachability('tui')` and `ensureFacadeTunnelReachability('cli')`; `ensureTunnelAtLaunch()` removed from `runGatewayWorker()`; `yagr stop` and `yagr restart` call `stopAllTunnels()`

### Config Rename

- `YagrLlmProxyConfig.tunnelUrl` removed (no legacy)
- New canonical field: `llmTunnelUrl`
- `YagrTunnelBehaviorConfig` with `reachabilityMode?: 'on-demand' | 'force-all-facades'`

---

## Policies

### Lazy Start

Tunnels start at setup only. Surfaces wake tunnels on demand via `ensureFacadeTunnelReachability()`. No generic auto-start.

### Shutdown Ownership

- Facade or gateway shutdown does not destroy autonomous tunnels (`n8n`, `n8n auth`, `llm`).
- Facades are consumers that can wake tunnels, not owners of their teardown.
- The local auth bridge runs in a shared detached runtime, alongside the LLM relay or `cloudflared` processes it supports.
- Global tunnel and bridge teardown remains reserved for explicit lifecycle flows (`yagr stop`, `yagr restart`, explicit tunnel stop commands, destructive reset).

### TUNNEL_DOMAIN

When `TUNNEL_DOMAIN` is set:
1. `cloudflared tunnel route dns <tunnel> <hostname>` is called
2. The hostname points to the tunnel
3. `YAGR_TUNNEL_REACHABILITY_MODE` and `TUNNEL_DOMAIN` are inherited by all child processes

### Three Tunnels

| Tunnel | Responsibility | State file |
|--------|-----------------|------------------|
| `n8n tunnel` | Public exposure of local n8n for webhooks | `n8n-tunnel-state.json` |
| `n8n auth tunnel` | Auth bridge for remote workflow opening | `n8n-auth-tunnel.json` |
| `llm tunnel` | LLM relay for cloud n8n → Yagr | `llm-tunnel.json` |

### No Legacy

- `proxy-tunnel.json` → `llm-tunnel.json`
- `workflow-open-tunnel.json` → `n8n-auth-tunnel.json`
- Field `tunnelUrl` → `publicUrl`
- No legacy fallback maintained

---

## Architecture Rules Applied

1. **SSOT:** tunnel lifecycle in `n8n-tunnel.ts`, wake-up policy in `tunnel-reachability.ts`
2. **Thin facades:** telegram, webui, cli only call `ensureFacadeTunnelReachability()`
3. **`TUNNEL_DOMAIN`** correctly calls `cloudflared tunnel route dns` so custom domains are routed
4. **No fallback** of legacy state file or config field
5. **`YAGR_TUNNEL_REACHABILITY_MODE`** and **`TUNNEL_DOMAIN`** inherited by all child processes via `process.env`

---

## Files Changed

### New Files
- `tests/tunnel-reachability.test.mjs`
- `tests/local-open-bridge.test.mjs`

### Modified Files
- `src/n8n-local/n8n-tunnel.ts` — tunnel lifecycle SSOT
- `src/n8n-local/tunnel-reachability.ts` — wake-up policy SSOT
- `src/config/yagr-config-service.ts` — `llmTunnelUrl`, `YagrTunnelBehaviorConfig`
- `src/config/yagr-home.ts` — `llmTunnelStatePath`, `n8nAuthTunnelStatePath`
- `src/llm/llm-relay-server.ts` — `buildRelayInfo` with `llmTunnelUrl`
- `src/gateway/telegram.ts` — `ensureFacadeTunnelReachability`
- `src/gateway/webui.ts` — `ensureFacadeTunnelReachability`
- `src/gateway/local-open-bridge.ts` — `getActiveN8nAuthTunnelState()` + `publicUrl`
- `src/cli.ts` — removed `ensureTunnelAtLaunch()`, generic tunnel spawn from `runGatewayWorker()`
- `src/setup/application-services.ts` — `llmTunnelUrl`, `ensureLlmTunnelForRelayHostBaseUrl()`
- `src/setup/setup-wizard.tsx` — `llmTunnelUrl` field name
- `tests/n8n-tunnel.test.mjs` — augmented
- `tests/n8n-relay-server.test.mjs` — augmented
- `tests/format-message.test.mjs` — corrected
- `architecture/current/system-overview.md`
- `architecture/current/module-map.md`
- `architecture/current/runtime-flows.md`
- `architecture/current/tunneling-and-workflow-presentation.md`
- `architecture/current/n8n-instances.md`
