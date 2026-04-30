---
title: Getting Started
description: "Install and start the local-first Yagr coding-agent runtime."
---

# Getting Started

The easiest way to use Yagr is through the `@yagr/agent` app package.

```bash
npm install -g @yagr/agent@latest
yagr onboard
yagr start
```

Then use:

```bash
yagr tui
yagr webui
```

## What you get

You are installing the assembled Yagr app:

- a local autonomous coding-agent runtime
- provider/model configuration
- local shell and file execution
- session and checkpoint management
- CLI, TUI, Web UI, and Telegram surfaces

Under the hood, the app consumes reusable runtime and surface packages. Integrators should prefer `@yagr/runtime` and `@yagr/surfaces` when embedding Yagr elsewhere.

## Prerequisites

- **Node.js** `v22.16.0` or higher
- A configured model provider

Docker is optional. It can still be useful when your own project or tools need managed local services.

## Setup flow

`yagr onboard` handles the first-run configuration:

- provider configuration
- local setup state
- optional surfaces and integrations

After that, `yagr start` launches configured gateway surfaces in the background. Use `yagr tui` or `yagr webui` for a single local surface.

## Architectural note

If you are here as an integrator rather than an end user:

- prefer `@yagr/runtime`
- prefer `@yagr/surfaces`

Those facades are the intended product-facing entrypoints for external consumers.

## Next reading

- [Usage](/docs/usage)
- [Commands](/docs/reference/commands)
- [Repository README](https://github.com/EtienneLescot/yagr/blob/main/README.md)
