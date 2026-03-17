---
title: Getting Started
description: "Connect Holon to its backend, model, and surfaces so it can turn intent into automation."
---

# Getting Started

Holon starts with a simple loop:

1. Run `holon setup`
2. Connect the agent to its backend, model, and surfaces
3. Run `holon start`
4. Interact through the TUI or an enabled surface such as Telegram

Under the hood, that setup is not the product goal. It is the bootstrap that lets Holon do its actual job: translate intent into workflows and operate them over time.

## What setup covers

`holon setup` configures three things:

1. Your **V1 backend**: today that means an n8n instance, API key, project, and local sync folder
2. Your **default LLM**: provider, model, API key, optional base URL
3. Your **gateway surfaces**: for example Telegram

Holon persists this state in the Holon home, so you do not need to recreate setup per repo.

## Development quick start

From this repository:

```bash
npm install
npm run build --workspace=packages/holon
npm run holon:setup
npm run holon:start
```

The dev scripts target `.holon-test-workspace` on purpose so local development stays isolated from your real `~/.holon` home.

## Runtime home

User-facing Holon defaults to `~/.holon`.

This is where Holon stores:

- local runtime config
- n8n bootstrap state
- generated workspace assets
- linked gateway metadata

This matters because Holon should remember the operational context around the workflows it creates. The runtime home is not the memory product; the workflows themselves are. But the home is what makes the agent stable between sessions.

## After setup

The main commands you will keep using are:

```bash
holon start
holon gateway status
holon telegram onboarding
```

Continue with:

- [Usage overview](/holon/docs/usage)
- [Telegram setup](/holon/docs/usage/telegram)
- [Commands reference](/holon/docs/reference/commands)