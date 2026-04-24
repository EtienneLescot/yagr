---
title: Exposing n8n via Cloudflare Tunnel
description: "Make your local n8n instance reachable from anywhere — Telegram, email, third-party services — using a Cloudflare Tunnel."
---

# Exposing n8n via Cloudflare Tunnel

By default, your n8n instance listens on `localhost` and is only accessible from the machine running Yagr. The **n8n tunnel** feature exposes it to the internet through a [Cloudflare Tunnel](https://www.cloudflare.com/products/tunnel/) (`cloudflared`), making webhooks and the n8n editor reachable from any machine.

This is the main enabler for workflows that receive external triggers:

- **Telegram**: the Yagr Telegram gateway is the primary consumer — it can send webhook payloads to your n8n instance regardless of where it runs.
- **Third-party services**: emails, Slack, Zapier, GitHub webhooks, or any HTTP caller can reach your local n8n.
- **Remote browser access**: the n8n editor itself is accessible from another machine once the tunnel is active.

## When the tunnel applies

| Configuration | Tunnel applicable |
|---|---|
| Yagr-managed n8n (Docker) | ✅ |
| Non-managed n8n, local host (`localhost`, RFC-1918) | ✅ |
| Non-managed n8n, cloud/remote URL | ❌ Already publicly reachable |

Yagr automatically detects the case and rejects tunnel start requests for already-public instances with a clear error message.

## Setup

Run once to install `cloudflared` automatically and start the tunnel:

```bash
yagr n8n tunnel setup
# ✓ cloudflared installed to ~/.yagr/bin/cloudflared
# Tunnel started: https://random-name.trycloudflare.com
# Target: http://127.0.0.1:5678  PID: 12345
```

Yagr downloads the correct `cloudflared` binary for your platform (Linux x64/arm64, macOS x64/arm64, Windows x64) into `~/.yagr/bin/` if it is not already available in your `PATH`. No Cloudflare account is required — Yagr uses [Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/), which are free and need no authentication.

After setup, the tunnel restarts **automatically** every time you run `yagr start`.

## Stopping

When you run `yagr stop`, Yagr terminates all tunnel processes (n8n tunnel, n8n auth tunnel, and llm tunnel) before shutting down the gateway worker. This prevents orphaned `cloudflared` processes from leaking and spamming your Cloudflare account.

## Commands

```bash
yagr n8n tunnel setup     # install cloudflared if needed + start + save config (run once)
yagr n8n tunnel status    # show tunnel state (JSON)
yagr n8n tunnel url       # print only the public URL
yagr n8n tunnel refresh   # renew (stop + start, new public URL)
yagr n8n tunnel stop      # stop the tunnel
yagr n8n tunnel start     # start manually (skips install)
```

The `cloudflared` process is spawned as a **detached daemon** and survives the current shell session. Yagr persists the tunnel state (public URL, target URL, PID) in `~/.yagr/n8n-tunnel-state.json`.

Once running, Yagr injects the public URL into the system prompt for any active agent session — the LLM can answer questions like "what is my webhook URL for this workflow?" correctly.

### Status and URL

```bash
yagr n8n tunnel status
# {
#   "running": true,
#   "publicUrl": "https://random-name.trycloudflare.com",
#   "targetUrl": "http://127.0.0.1:5678",
#   "pid": 12345,
#   "startedAt": "2026-04-02T10:00:00.000Z"
# }

yagr n8n tunnel url
# https://random-name.trycloudflare.com
```

### Refresh

Cloudflare Quick Tunnel URLs are **not stable**: every time the `cloudflared` process restarts, the URL changes.

```bash
yagr n8n tunnel refresh
# Tunnel refreshed: https://new-name.trycloudflare.com
```

If you are using a Yagr-managed n8n instance, Yagr reminds you to restart n8n so it picks up the new URL via `N8N_WEBHOOK_URL` (see [Webhook URLs](#webhook-urls) below).

## Webhook URLs

n8n uses the `N8N_WEBHOOK_URL` environment variable to construct the URLs it displays in the editor when a webhook trigger node is configured.

| Situation | What happens |
|---|---|
| `N8N_WEBHOOK_URL` not set | n8n displays `http://127.0.0.1:5678/webhook/...` — correct locally, but not useful externally |
| `N8N_WEBHOOK_URL` set to the tunnel URL | n8n displays `https://xxx.trycloudflare.com/webhook/...` — correct for external callers |

**Webhooks work via the tunnel regardless of `N8N_WEBHOOK_URL`**: the tunnel proxies all incoming requests to your local n8n. The variable only affects what n8n *displays* in its UI.

### Managed instances

For Yagr-managed n8n, start the tunnel first, then restart n8n with the tunnel URL:

```bash
yagr n8n tunnel start
TUNNEL_URL=$(yagr n8n tunnel url)

# Docker runtime — edit YAGR_HOME/n8n/.env and restart
echo "N8N_WEBHOOK_URL=$TUNNEL_URL" >> ~/.yagr/n8n/.env
yagr n8n local stop && yagr n8n local start
```

After a `refresh`, repeat this step so n8n picks up the new URL.

### Non-managed instances

For externally-managed local n8n, set `N8N_WEBHOOK_URL` in your own startup configuration (environment, `.env` file, or `~/.n8n/config`). Use `yagr n8n tunnel url` to retrieve the current public URL.

## Credentials and transparent authentication

For Yagr-managed instances, Yagr handles authentication transparently — no API key entry or manual login is required. This works identically whether the tunnel is active or not: Yagr always communicates with n8n via the **local** URL (`http://127.0.0.1:<port>`), not the public tunnel URL. The tunnel is an inbound-only channel.

Stored credentials are indexed by the local origin and are unaffected by tunnel start, stop, or refresh operations.

## Security considerations

A Quick Tunnel exposes **all n8n endpoints** on the public URL, including the n8n editor. By default, n8n requires authentication to access the editor. Webhook endpoints may be public or authenticated depending on how each workflow is configured.

Yagr does not add an extra authentication layer on the tunnel. If you need to restrict access, configure n8n's own basic auth or use a named tunnel with Cloudflare Access instead of a Quick Tunnel.
