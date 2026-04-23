---
title: Yagr Overview
description: "Yagr is evolving into a reusable agent runtime platform with core packages, facades, plugins, and apps."
slug: /
---

# Yagr

Yagr is no longer only a single automation agent product.

It is becoming a broader platform with three layers:

- **core runtime packages**
- **plugins**
- **apps and surfaces**

The repository still ships the `@yagr/agent` app, but the architecture is now deliberately split so other products can reuse Yagr without importing the whole app as a monolith.

## Core idea

Yagr should provide reusable primitives for:

- deep agent bootstrap
- provider/model runtime
- sessions and checkpoints
- runtime events and stream adaptation
- conversation behavior
- shared WebUI/TUI surface primitives

Then product- or domain-specific behavior belongs in plugins.

## Current architecture direction

The platform now has two consumption levels:

### Internal granular packages

These are useful inside Yagr itself for modularity and testing.

Examples:

- `@yagr/deepagent-bootstrap`
- `@yagr/provider-runtime`
- `@yagr/session-service`
- `@yagr/runtime-events`
- `@yagr/stream-adapter`

### Product-facing facades

These are the preferred entrypoints for downstream products.

- `@yagr/runtime`
- `@yagr/surfaces`

The facades exist so downstream products do not need to depend on many tiny internal packages directly.

## Plugins

Plugins are where Yagr-specific integrations should increasingly live.

Examples:

- `@yagr/plugin-runtime`
- `@yagr/plugin-n8n-manager`

That means manager-specific logic should progressively move behind plugins instead of staying in the core runtime.

## What Yagr still does today

The `@yagr/agent` app still offers:

- onboarding and runtime setup
- TUI and WebUI surfaces
- provider setup
- sessioned deepagent execution
- automation-oriented integrations

But the architectural goal is now clear:

- **Yagr core** should be reusable
- **plugins** should carry domain-specific concerns
- **apps** should compose core + plugins into final products

## Start here

- [Getting Started](/docs/getting-started)
- [Usage](/docs/usage)
- [Commands](/docs/reference/commands)
- [Architecture](https://github.com/EtienneLescot/yagr/tree/main/architecture)
