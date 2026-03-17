---
title: Commands
description: "Core Holon CLI commands."
---

# Commands

## Core flow

```bash
holon setup
holon start
holon gateway status
```

## Telegram

```bash
holon telegram setup
holon telegram start
holon telegram status
holon telegram onboarding
holon telegram reset
```

## Config

```bash
holon config show
holon config reset
```

## Notes

- `holon start` will trigger setup automatically if the runtime is not ready.
- Runtime configuration is expected to come from setup, not from ad hoc environment variable injection.