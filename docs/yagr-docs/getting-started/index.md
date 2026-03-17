---
title: Getting Started
description: "Connect Yagr to its backend, model, and surfaces so it can turn intent into automation."
---

# Getting Started

Yagr starts with a simple loop:

1. Install `yagr`
2. Run `yagr onboard`
3. Connect the agent to its backend, model, and surfaces
4. Run `yagr start`
5. Interact through the TUI or an enabled surface such as Telegram

Under the hood, that setup is not the product goal. It is the bootstrap that lets Yagr do its actual job: translate intent into workflows and operate them over time.

## Standard install

For normal product usage, install Yagr globally:

```bash
npm install -g yagr@latest
# or: pnpm add -g yagr@latest
```

Then run the onboarding flow once:

```bash
yagr onboard
```

After onboarding, start the runtime with:

```bash
yagr start
```

## What onboarding covers

`yagr onboard` is the standard first-run entry point. Internally it drives the same setup flow as `yagr setup` and configures three things:

1. Your **V1 backend**: today that means an n8n instance, API key, project, and local sync folder
2. Your **default LLM**: provider, model, API key, optional base URL
3. Your **gateway surfaces**: for example Telegram

Yagr persists this state in the Yagr home, so you do not need to recreate setup per repo.

## Repository development flow

If you are working from this monorepo instead of using the published package:

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

## After onboarding

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