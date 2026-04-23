---
title: Getting Started
description: "Run the current Yagr agent app, while understanding that it now sits on top of a reusable core/platform split."
---

# Getting Started

Today, the easiest way to use Yagr is still through the `@yagr/agent` app package.

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

## What this installs

Right now you are installing the assembled Yagr app.

Under the hood, Yagr is being refactored into:

- **core runtime packages**
- **plugin packages**
- **surface packages**
- **facade packages**

The current app is therefore both:

- the easiest way to try Yagr today
- one consumer of the broader Yagr platform architecture

## Current prerequisites

- **Node.js** `v22.16.0` or higher
- **Docker** is optional, but still useful for managed local runtime scenarios

## Current app flow

`yagr onboard` still handles:

- runtime configuration
- provider configuration
- local setup state
- optional integrations

After that, `yagr start`, `yagr tui`, and `yagr webui` launch the current assembled app surfaces.

## Architectural note

If you are here as an integrator rather than an end user:

- prefer `@yagr/runtime`
- prefer `@yagr/surfaces`

Those facades are the intended product-facing entrypoints for external consumers.

## Next reading

- [Usage](/docs/usage)
- [Commands](/docs/reference/commands)
- [Repository README](https://github.com/EtienneLescot/yagr/blob/main/README.md)
