---
title: Getting Started
description: "Connect Yagr to its current orchestrator, model, and optional integrations so it can turn intent into automation."
---

# Getting Started

## Prerequisites

- **Node.js** (v22.16.0 or higher)
- **Docker** (free) — enables the zero-friction experience: Yagr bootstraps and manages a local n8n instance for you. [Download Docker Desktop](https://www.docker.com/products/docker-desktop/).

No n8n installation required. No API key hunting. The wizard's own LLM credentials power your nodes automatically. If you prefer to connect to an existing n8n instance instead, pass the URL and API key during onboarding.

---

Two commands. Zero friction.

1. Install `@yagr/agent`
2. Run `yagr onboard` — a guided TUI wizard handles n8n, model, and integrations

Docker spins up automatically if present. Yagr's own LLM credentials power your nodes without re-entering API keys. After onboarding, you get an autologin link to the n8n canvas whenever you want to tweak things manually.

That is all that is required. After onboarding, Yagr is operational. If you configured Telegram, the bot handles chat linking automatically when someone messages it. Use `yagr tui` or `yagr webui` to open an interactive session at any time.

Under the hood, that setup is not the product goal. It is the bootstrap that lets Yagr do its actual job: translate intent into workflows and operate them over time.

## Standard install

For normal product usage, install Yagr globally:

```bash
npm install -g @yagr/agent@latest
# or: pnpm add -g @yagr/agent@latest
```

Then run the onboarding flow once:

```bash
yagr onboard
```

After onboarding, start Telegram and other configured gateways in the background:

```bash
yagr start
```

This spawns a background daemon and returns your terminal. From there:

```bash
yagr tui        # open a terminal chat session
yagr webui      # open the local web interface
yagr stop       # stop the background gateway
```

## What onboarding covers

`yagr onboard` is a guided TUI wizard. It drives the same setup flow as `yagr setup` and configures three things:

1. Your **n8n connection**: spins up a local instance via Docker, or connects to an existing one via URL and API key
2. Your **default LLM**: provider, model, API key, optional base URL — shared across your n8n nodes automatically
3. Your **optional messaging integrations**: for example Telegram

After onboarding, Yagr persists this state in its own home. You also receive an **autologin link** to the n8n canvas, so you can jump straight into the visual editor whenever you want to tweak things manually.

## Runtime home

User-facing Yagr defaults to `~/.yagr`.

This is where Yagr stores:

- local runtime config
- n8n bootstrap state
- generated workspace assets
- linked gateway metadata

This matters because Yagr should remember the operational context around the workflows it creates. The runtime home is not the memory product; the workflows themselves are. But the home is what makes the agent stable between sessions.

## After onboarding

The commands you will keep using are:

```bash
yagr start          # start gateways in the background
yagr tui            # open a terminal chat session
yagr webui          # open the local web interface
yagr stop           # stop the background gateway
yagr gateway status # check whether a daemon is currently running
yagr n8n canvas     # open the n8n canvas autologin link
```

If you need to re-share the Telegram onboarding link (for example when linking a new chat manually):

```bash
yagr telegram onboarding
```

Continue with:

- [Usage overview](/docs/usage)
- [Telegram setup](/docs/usage/telegram)
- [Commands reference](/docs/reference/commands)

If you are contributing from the repository instead of using the published package, use the development flow documented in the root README.