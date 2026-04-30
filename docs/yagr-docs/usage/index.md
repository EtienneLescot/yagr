---
title: Usage
description: "Use Yagr through local and remote surfaces over the same autonomous coding runtime."
---

# Usage

Yagr is one runtime with multiple thin surfaces.

## Run A Prompt

```bash
yagr "inspect this repository and summarize the main modules"
```

## Start The Web UI

```bash
yagr webui
```

## Configure The Runtime

```bash
yagr setup
yagr llm setup
```

## Telegram Gateway

```bash
yagr telegram setup
yagr telegram start
```

Yagr stores its runtime state under `YAGR_HOME` or the platform default home directory.

## Runtime model

The same runtime owns provider configuration, sessions, checkpoints, runtime events, and local shell/file execution.

Surfaces should stay thin. They receive prompts, render events, and expose controls without becoming the product brain.
