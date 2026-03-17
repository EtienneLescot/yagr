---
title: Usage
description: "Understand how Holon turns intent into automation through a backend engine and simple gateway surfaces."
---

# Usage

Holon is intentionally narrow in product scope.

The goal is not to expose every primitive of the underlying stack. The goal is to turn intent into automation, then keep those automations legible and operable over time.

## Surfaces are not the brain

Holon can be reached through several surfaces:

- **TUI / local interactive mode** for direct operator control
- **Telegram** for remote chat-based interaction
- **CLI and backend integration** so Holon can operate on the actual automation workspace

But these are only entry points. The core model is:

- the gateway receives user intent
- the agent plans and selects tools
- the engine generates, validates, and deploys workflows
- the resulting workflow becomes durable executable memory

## Workflows are memory

Holon should not drift into a generic memory assistant product.

The workflows it creates already are memory:

- topology remembers how the problem was solved
- configuration remembers what matters operationally
- execution history remembers what happened over time
- future Holon sessions can inspect and evolve that artifact

## The operating model

- setup is the source of truth
- runtime config is persisted
- user configuration should not depend on shell-local environment variables
- backend execution is delegated to the engine, not embedded into the agent brain

## Related guides

- [Telegram](/holon/docs/usage/telegram)
- [TUI](/holon/docs/usage/tui)
- [n8n backend](/holon/docs/usage/n8n-backend)