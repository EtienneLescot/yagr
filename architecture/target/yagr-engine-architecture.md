# Target Architecture - Yagr Platform

This page now describes the active target direction for the repository.

## Target direction

Yagr should converge toward:

- **core runtime platform**
- **plugin system**
- **surface packages**
- **final apps composed on top**

## Target layers

### Core

Reusable core packages should own:

- bootstrap
- providers
- sessions/checkpoints
- memory
- runtime events
- stream adaptation
- conversation behavior
- gateway/session orchestration primitives

### Plugins

Plugins should own domain-specific integrations such as future Telegram/WhatsApp or other product-specific integrations. The n8n manager integration is external to this repository.

### Surfaces

Reusable surface packages should own:

- WebUI rendering primitives
- TUI rendering primitives

### Apps

Apps should own:

- final product composition
- CLI entrypoints
- packaging and distribution
- product-specific defaults

## Architectural principle

The core should not be defined by manager-specific concerns.

Manager logic may still be strategically important, but it should progressively move behind plugins so the platform remains reusable outside that one product identity.

## Current practical implication

For external consumers such as Axcut, the intended entrypoints are:

- `@yagr/runtime`
- `@yagr/surfaces`

The finer-grained packages remain useful internally, but they are not the preferred product integration surface.
