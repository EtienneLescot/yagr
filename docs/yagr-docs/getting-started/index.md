---
title: Getting Started
description: "Connect Yagr to its backend, model, and surfaces so it can turn intent into automation."
---

# Getting Started

Yagr starts with a simple loop:

1. Run `yagr setup`
2. Connect the agent to its backend, model, and surfaces
3. Run `yagr start`
4. Interact through the TUI or an enabled surface such as Telegram

Under the hood, that setup is not the product goal. It is the bootstrap that lets Yagr do its actual job: translate intent into workflows and operate them over time.

## What setup covers

`yagr setup` configures three things:

1. Your **V1 backend**: today that means an n8n instance, API key, project, and local sync folder
2. Your **default LLM**: provider, model, API key, optional base URL
3. Your **gateway surfaces**: for example Telegram

Yagr persists this state in the Yagr home, so you do not need to recreate setup per repo.

## Development quick start

From this repository:

```bash
npm install
npm run build --workspace=packages/yagr
npm run yagr:setup
npm run yagr:start
```

The dev scripts target `.yagr-test-workspace` on purpose so local development stays isolated from your real `~/.yagr` home.

## Runtime home

User-facing Yagr defaults to `~/.yagr`.

This is where Yagr stores:

- local runtime config
- n8n bootstrap state
- generated workspace assets
- linked gateway metadata

This matters because Yagr should remember the operational context around the workflows it creates. The runtime home is not the memory product; the workflows themselves are. But the home is what makes the agent stable between sessions.

## After setup

The main commands you will keep using are:

```bash
yagr start
yagr gateway status
yagr telegram onboarding
```

Continue with:

- [Usage overview](/yagr/docs/usage)
- [Telegram setup](/yagr/docs/usage/telegram)
- [Commands reference](/yagr/docs/reference/commands)