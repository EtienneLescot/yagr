---
title: Commands
description: "Core Yagr CLI commands."
---

# Commands

## Core flow

```bash
yagr onboard
yagr setup
yagr start
yagr start webui
yagr start tui
yagr gateway status
```

## Telegram

```bash
yagr telegram setup
yagr telegram start
yagr telegram status
yagr telegram onboarding
yagr telegram reset
```

## Config

```bash
yagr config show
yagr config reset
```

## Notes

- `yagr onboard` is the standard first-run command and currently drives the same interactive setup flow as `yagr setup`.
- `yagr start` will trigger setup automatically if the runtime is not ready, then let you choose between the Web UI and the TUI.
- `yagr start webui` and `yagr start tui` skip the launcher prompt.
- Runtime configuration is expected to come from setup, not from ad hoc environment variable injection.