---
title: TUI
description: "Use Yagr locally through its terminal-first interactive interface."
---

# TUI

Yagr's local interface is the fastest way to operate it when you are on the machine.

## Start the runtime

```bash
yagr start tui
```

If setup is incomplete, Yagr will first drive you through the missing bootstrap steps. Use `yagr start` to launch the configured gateway surfaces instead.

## What the TUI is for

- running the local operator loop
- inspecting execution state
- staying close to the underlying workspace
- validating behavior before exposing it to remote surfaces

## Recommended usage

Use the TUI as the primary operator console, then enable Telegram when you need remote access or a simple chat surface.

## Available commands

Type any command prefixed with `/` in the input prompt.

### Session management

- `/help` — list available commands with descriptions
- `/sessions` — list all conversation sessions for the current scope
- `/resume <session_id>` — resume a specific conversation session
- `/delete <session_id>` — delete a conversation session
- `/new` or `/reset` — start a new conversation session

### Checkpoints

- `/checkpoints` — list all checkpoints for the current session
- `/save` — save a checkpoint of the current session
- `/restore <checkpoint_id>` — restore a checkpoint (restores agent state and compaction context)
- `/checkpoint_delete <checkpoint_id>` — delete a specific checkpoint

### Interface controls

- `/expand` — expand all collapsed shell outputs
- `/collapse` — collapse shell outputs to a single line
- `/open` — open the most recent local URL when available
- `/stop` — request the current run to stop gracefully
- `/toggle_thinking` — toggle display of agent thinking
- `/toggle_cli` — toggle display of command executions
- `/pending` — show pending required actions
- `/approve` — grant pending permissions
- `/compact` — trigger conversation compaction (runs automatically when needed)
- `/exit` — exit the terminal interface
