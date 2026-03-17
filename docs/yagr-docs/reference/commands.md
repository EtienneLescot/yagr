---
title: Commands
description: "Core Yagr CLI commands."
---

# Commands

## Core flow

```bash
yagr setup
yagr start
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

- `yagr start` will trigger setup automatically if the runtime is not ready.
- Runtime configuration is expected to come from setup, not from ad hoc environment variable injection.