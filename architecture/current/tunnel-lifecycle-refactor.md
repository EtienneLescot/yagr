# Tunnel Lifecycle Refactor — Architecture Decision Record

**Date:** 2026-04-19
**Status:** Implemented (working tree, uncommitted)

---

## Contexte

Yagr avait un probleme de tunnel Cloudflare spam: des processus `cloudflared` orphelins fuyaient lors des timeouts de demarrage et la logique generic de auto-restart redemarrant les tunnels indistinctement au redemarrage du gateway worker. Trois tunnels existaient (n8n, workflow-open/bridge, llm-proxy) avec une logique de spawn distribuee dans les facades, pas de politique centrale de wake-up, routage DNS `TUNNEL_DOMAIN` cassé, et des noms de fichiers de state legacy encore lus.

---

## Problemes constates

1. **Bug original:** `startN8nTunnel()` / `startNamedTunnel()` laissaient des processus `cloudflared` detaches vivants sur timeout/early-close (le process etait unref'd avant que l'URL soit capturee)
2. **`ensureTunnelAtLaunch()`** dans `cli.ts` redemarrant les tunnels a chaque redemarrage generic du gateway worker, multipliant l'accumulation d'orphelins
3. **`workflow-open tunnel`** demarre automatiquement avec le main n8n tunnel depuis les commandes CLI tunnel setup/stop/refresh
4. **`TUNNEL_DOMAIN`** mode cassé: `cloudflared tunnel route dns` n'etait jamais appele, donc les hostnames ne pointaient pas vers le tunnel

---

## Design decision

### SSOT Tunnel Lifecycle (`src/n8n-local/n8n-tunnel.ts`)

Le lifecycle process des tunnels Cloudflare est centralise dans un seul module:

- `startN8nTunnel()` / `startNamedTunnel()` partagent un helper `startTunnel()` unique
- Timeout/close error appelle `terminateProcess(pid)` pour nettoyer le child orphelin avant de reject
- `getTunnelConfig(serviceName?)` centralise la resolution `TUNNEL_DOMAIN`
- `ensureTunnelDnsRoute(bin, tunnelName, hostname)` appelle `cloudflared tunnel route dns <tunnel> <hostname>` avec tolerance "already exists"
- Chemins des fichiers de state renommes: `llm-tunnel.json`, `n8n-auth-tunnel.json`
- Tous les fallback de fichiers de state legacy ont ete supprimes

**Nouvelles fonctions exportees:**
- `ensureN8nTunnel()`, `startLlmTunnel()`, `startN8nAuthTunnel()`, `ensureN8nAuthTunnel()`, `stopN8nAuthTunnel()`, `stopAllTunnels()`, `getActiveN8nAuthTunnelState()`

**Renommages internes:**
- `ProxyTunnelState` → `PublicAuxTunnelState`
- Champ `tunnelUrl` → `publicUrl`

### SSOT Reachability (`src/n8n-local/tunnel-reachability.ts`)

Module de wake-up lazy des tunnels par consommateur:

- `ensureConfiguredN8nTunnelReachability(consumer)` — wake-up lazy pour n8n tunnel
- `ensureN8nAuthTunnelReachability(consumer)` — wake-up lazy pour n8n auth tunnel
- `ensureFacadeTunnelReachability(consumer)` — orchestre les deux
- `ensureConfiguredLlmTunnelReachability()` — wake-up lazy pour llm tunnel
- `ensureLlmTunnelForRelayHostBaseUrl(hostBaseUrl, configService)` — demarrage direct tunnel llm
- `getTunnelReachabilityDebugSnapshot()` — snapshot debug
- `TunnelReachabilityConsumer = 'telegram' | 'webui' | 'tui' | 'cli' | 'setup' | 'llm'`
- `YAGR_TUNNEL_REACHABILITY_MODE` env var override la config; mode `force-all-facades` wake tous les tunnels depuis tous les consumers pour test
- `TUNNEL_DOMAIN` consommé depuis `n8n-tunnel.ts`, herité par tous les child processes via `process.env`

### Integration Facade

Les facades restent minces et deleguent au reachability SSOT:

- `src/gateway/telegram.ts`: appelle `ensureFacadeTunnelReachability('telegram', configService)`
- `src/gateway/webui.ts`: appelle `ensureFacadeTunnelReachability('webui', configService)`
- `src/cli.ts`: appelle `ensureFacadeTunnelReachability('tui')` et `ensureFacadeTunnelReachability('cli')`; `ensureTunnelAtLaunch()` supprime de `runGatewayWorker()`; `yagr stop` et `yagr restart` appellent `stopAllTunnels()`

### Gateway Shutdown Tunnel Cleanup

`src/gateway/manager.ts`: `runGatewaySupervisor()` et `runGatewaySurfaces()` appellent `stopAllTunnels()` sur SIGINT/SIGTERM avant de quitter.

### Config Rename

- `YagrLlmProxyConfig.tunnelUrl` supprime (pas de legacy)
- Nouveau champ canonique: `llmTunnelUrl`
- `YagrTunnelBehaviorConfig` avec `reachabilityMode?: 'on-demand' | 'force-all-facades'`

---

## Politiques

### Lazy Start

Les tunnels demarrent au setup uniquement. Les surfaces wake les tunnels on demand via `ensureFacadeTunnelReachability()`. Aucun demarrage automatique generique.

### TUNNEL_DOMAIN

Quand `TUNNEL_DOMAIN` est positionne:
1. `cloudflared tunnel route dns <tunnel> <hostname>` est appele
2. Le hostname pointe vers le tunnel
3. `YAGR_TUNNEL_REACHABILITY_MODE` et `TUNNEL_DOMAIN` sont herités par tous les child processes

### Trois Tunnels

| Tunnel | Responsabilite | Fichier de state |
|--------|-----------------|------------------|
| `n8n tunnel` | Exposition publique n8n locale pour webhooks | `n8n-tunnel-state.json` |
| `n8n auth tunnel` | Bridge d'auth pour ouverture distante workflows | `n8n-auth-tunnel.json` |
| `llm tunnel` | Relay LLM pour n8n cloud → Yagr | `llm-tunnel.json` |

### Pas de Legacy

- `proxy-tunnel.json` → `llm-tunnel.json`
- `workflow-open-tunnel.json` → `n8n-auth-tunnel.json`
- Champ `tunnelUrl` → `publicUrl`
- Aucun fallback legacy maintenu

---

## Regles d'architecture appliquees

1. **SSOT:** lifecycle tunnel dans `n8n-tunnel.ts`, politique wake-up dans `tunnel-reachability.ts`
2. **Facades minces:** telegram, webui, cli appellent uniquement `ensureFacadeTunnelReachability()`
3. **`TUNNEL_DOMAIN`** appelle correctement `cloudflared tunnel route dns` pour que les domaines personalises soient routés
4. **Pas de fallback** de fichier de state ou champ de config legacy
5. **`YAGR_TUNNEL_REACHABILITY_MODE`** et **`TUNNEL_DOMAIN`** herités par tous les child processes via `process.env`

---

## Files modifies

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
