---
title: Commands
description: "Core Yagr CLI commands."
---

# Commands

## Core flow

```bash
yagr onboard        # first-run setup
yagr start          # start gateways in the background (Telegram, etc.)
yagr tui            # open a terminal chat session
yagr webui          # open the local web interface
yagr stop           # stop the background gateway
yagr gateway status # check whether a daemon is currently running
```

## Telegram

```bash
yagr telegram setup        # configure a Telegram bot
yagr telegram start        # start the Telegram gateway in the foreground
yagr telegram status       # show bot and linked chats
yagr telegram reset        # remove Telegram configuration
```

To share the onboarding link manually (for example to link an additional chat):

```bash
yagr telegram onboarding
```

In normal usage this is not necessary: when someone messages the bot without a linked chat, Yagr replies with the link automatically.

## Config

```bash
yagr config show
yagr config reset
```

## n8n — local instance

```bash
yagr n8n doctor              # inspect local n8n bootstrap readiness
yagr n8n local install       # install and start a Yagr-managed local n8n
yagr n8n local start         # start the managed instance
yagr n8n local stop          # stop the managed instance
yagr n8n local status        # show managed instance status (JSON)
yagr n8n local logs          # show recent logs
yagr n8n local open          # open the editor in the browser
```

## n8n — Cloudflare Tunnel

Exposes a local n8n instance to the internet. `cloudflared` is downloaded automatically on first setup.
See [Exposing n8n via Cloudflare Tunnel](../usage/n8n-tunnel) for a full guide.

```bash
yagr n8n tunnel setup        # install cloudflared + start tunnel (run once)
yagr n8n tunnel start        # start the tunnel — prints the public URL
yagr n8n tunnel stop         # stop all tunnels (n8n + n8n auth + llm)
yagr n8n tunnel refresh      # renew (stop + start, new public URL)
yagr n8n tunnel status       # show tunnel state (JSON)
yagr n8n tunnel url          # print only the public URL
```

## Notes

- `yagr onboard` is the standard first-run command and currently drives the same interactive setup flow as `yagr setup`.
- `yagr start` launches messaging gateways as a background daemon and returns to your shell. It will trigger setup automatically if the runtime is not ready.
- `yagr tui` and `yagr webui` open interactive sessions independently. They do not require the background daemon to be running.
- Runtime configuration is expected to come from setup, not from ad hoc environment variable injection.