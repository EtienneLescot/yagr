---
title: Usage
description: "Understand how Yagr turns intent into automation through an execution orchestrator and simple gateway surfaces."
---

# Usage

Yagr is intentionally narrow in product scope.

The goal is not to expose every primitive of the underlying stack. The goal is to turn intent into automation, then keep those automations legible and operable over time.

## Surfaces are not the brain

Yagr can be reached through several surfaces:

- **TUI / local interactive mode** for direct operator control
- **Telegram** for remote chat-based interaction
- **CLI and backend integration** so Yagr can operate on the actual automation workspace

But these are only entry points. The core model is:

- the gateway receives user intent
- the agent plans and selects tools
- the engine generates, validates, and deploys workflows
- the resulting workflow becomes durable executable memory

## Workflows are memory

Yagr should not drift into a generic memory assistant product.

The workflows it creates already are memory:

- topology remembers how the problem was solved
- configuration remembers what matters operationally
- execution history remembers what happened over time
- future Yagr sessions can inspect and evolve that artifact

## The operating model

- setup is the source of truth
- runtime config is persisted
- user configuration should not depend on shell-local environment variables
- execution is delegated to the orchestrator boundary, not embedded into the agent brain

## Related guides

- [Telegram](/docs/usage/telegram)
- [TUI](/docs/usage/tui)
- [Execution orchestrators](/docs/usage/n8n-backend)