<table width="100%">
  <tr>
    <td width="320" align="center" valign="middle">
      <img src="res/yagr-logo.png" alt="Yagr logo" width="130">
    </td>
    <td width="680" valign="middle">
      <div><strong><font size="6">Yagr</font></strong></div>
      <div><sub>(Y)our (A)gent (G)rounded in (R)eality</sub></div>
      <br>
      <div><strong>Agent runtime platform, shared surfaces, and plugins for durable automation products.</strong></div>
      <br>
      <div>
        <a href="https://github.com/EtienneLescot/yagr/actions/workflows/ci.yml"><img src="https://github.com/EtienneLescot/yagr/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
        <a href="https://yagr.dev/docs/"><img src="https://github.com/EtienneLescot/yagr/actions/workflows/docs.yml/badge.svg" alt="Documentation"></a>
        <a href="https://yagr.dev/"><img src="https://img.shields.io/badge/docs-yagr-black?logo=gitbook" alt="Yagr Docs"></a>
        <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
      </div>
      <br>
      <div>
        <a href="https://yagr.dev/"><strong>Docs</strong></a> ·
        <a href="https://yagr.dev/docs/getting-started/"><strong>Getting Started</strong></a> ·
        <a href="https://yagr.dev/docs/reference/commands/"><strong>Commands</strong></a>
      </div>
    </td>
  </tr>
</table>

---

## What Yagr Is Now

Yagr is no longer only a single agent app.

It is becoming a broader platform with three layers:

- **Core runtime packages**
- **Plugins**
- **Apps and surfaces**

Today, the repository still contains the `@yagr/agent` app package, but the architecture is now intentionally split so other products can reuse Yagr without importing a monolith.

## Package Model

### Core runtime packages

Examples:

- `@yagr/deepagent-bootstrap`
- `@yagr/provider-runtime`
- `@yagr/session-service`
- `@yagr/runtime-events`
- `@yagr/stream-adapter`
- `@yagr/conversation-service`

These packages hold the reusable execution/runtime logic.

### Facade packages

For downstream products, the preferred entrypoints are the facades:

- `@yagr/runtime`
- `@yagr/surfaces`

The facades exist so products like Axcut do not need to depend on many tiny internal packages directly.

### Plugin packages

Plugins carry domain- or product-specific integrations.

Examples:

- `@yagr/plugin-runtime`
- `@yagr/plugin-n8n-manager`

The long-term direction is that manager-specific logic belongs in plugins, not in Yagr core.

## Why This Refactor Exists

This split solves two problems:

1. **Yagr internal modularity**
2. **Product reuse by external consumers**

The small internal packages are useful inside Yagr for:

- dependency boundaries
- testability
- plugin isolation
- safer refactors

The facade packages are useful for downstream products because they provide a stable integration surface.

## Current Product Direction

Yagr still powers an agent experience that turns intent into automation on top of durable execution systems.

The important shift is architectural:

- Yagr core should stay product-agnostic
- manager-specific logic should move behind plugins
- surfaces should stay thin
- runtime/state/session/event logic should be reusable across products

## Quick Start

### Install

```bash
npm install -g @yagr/agent@latest
```

### Onboard

```bash
yagr onboard
```

### Run

```bash
yagr start
yagr tui
yagr webui
```

## Repository Layers

Conceptually, the repo is moving toward:

- **Core**
  - runtime, providers, sessions, streaming, surfaces
- **Plugins**
  - manager integrations such as `@yagr/plugin-n8n-manager`
- **Apps**
  - final assembled runnable products

## For Integrators

If you are integrating Yagr into another product:

- prefer `@yagr/runtime`
- prefer `@yagr/surfaces`
- avoid depending on many low-level packages directly unless you truly need to

## Development

```bash
npm install
npm test
npm run build
```

## Read Next

- [Documentation](https://yagr.dev/docs/)
- [Architecture dossier](./architecture/README.md)
- [n8n-as-code](https://github.com/EtienneLescot/n8n-as-code)
