---
title: Getting Started
description: "Connect Yagr to its current orchestrator, model, and optional integrations so it can turn intent into automation."
---

# Getting Started

Yagr starts with a simple loop:

1. Install `@yagr/agent`
2. Run `yagr onboard`
3. Connect the agent to its orchestrator, model, and optional messaging integrations

That is all that is required. After onboarding, Yagr is operational. If you configured Telegram, the bot already handles chat linking automatically when someone messages it. Use `yagr tui` or `yagr webui` to open an interactive session at any time.

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

`yagr onboard` is the standard first-run entry point. Internally it drives the same setup flow as `yagr setup` and configures three things:

1. Your **current orchestrator connection**: today that means an n8n instance, API key, project, and local sync folder
2. Your **default LLM**: provider, model, API key, optional base URL
3. Your **optional messaging integrations**: for example Telegram

Yagr persists this state in the Yagr home, so you do not need to recreate setup per repo.

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