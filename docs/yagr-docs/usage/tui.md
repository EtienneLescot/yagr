---
title: TUI
description: "Use Yagr locally through its terminal-first interactive interface."
---

# TUI

Yagr's local interface is the fastest way to operate it when you are on the machine.

## Start the runtime

```bash
yagr start
```

If setup is incomplete, Yagr will first drive you through the missing bootstrap steps.

## What the TUI is for

- running the local operator loop
- inspecting execution state
- staying close to the underlying workspace
- validating behavior before exposing it to remote surfaces

## Recommended usage

Use the TUI as the primary operator console, then enable Telegram when you need remote access or a simple chat surface.