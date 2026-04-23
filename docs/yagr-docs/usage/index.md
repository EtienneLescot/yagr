---
title: Usage
description: "Use the current Yagr app surfaces while understanding the new split between core, facades, plugins, and apps."
---

# Usage

The current `@yagr/agent` app still exposes Yagr through user-facing surfaces such as:

- TUI
- WebUI
- Telegram

But the architectural model has changed.

## Surfaces are now explicitly surfaces

Yagr is moving toward a layered model where:

- runtime/session/stream logic lives in core packages
- rendering primitives live in shared surface packages
- domain-specific integrations live in plugins
- the final product is an assembled app

That means TUI and WebUI are not the product identity anymore. They are surfaces over a reusable runtime.

## Runtime model

The reusable runtime layer now covers:

- deepagent bootstrap
- providers
- sessions and checkpoints
- runtime events
- stream adaptation
- conversation handling

For downstream products, the intended integration layer is:

- `@yagr/runtime`
- `@yagr/surfaces`

## Plugins

Manager-specific logic is moving behind plugins.

The first explicit example is:

- `@yagr/plugin-n8n-manager`

The direction is that Yagr core remains reusable, while manager/integration logic moves out of core packages.

## Commands you still use today

```bash
yagr onboard
yagr start
yagr tui
yagr webui
yagr stop
```

The app behavior is still familiar.

What changed is the internal architecture and the intended integration model.

## Related guides

- [Telegram](/docs/usage/telegram)
- [TUI](/docs/usage/tui)
- [n8n backend](/docs/usage/n8n-backend)
