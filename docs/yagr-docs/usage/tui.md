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

If setup is incomplete, Yagr will first drive you through the missing bootstrap steps. Use `yagr start` if you want the launcher to ask whether to open the Web UI or the TUI.

## What the TUI is for

- running the local operator loop
- inspecting execution state
- staying close to the underlying workspace
- validating behavior before exposing it to remote surfaces

## Session commands

The TUI preserves your conversation history across runs. Each session is saved automatically — there is nothing to configure.

Within an active session, the following commands are available alongside normal chat:

| Command | Description |
|---|---|
| `/sessions` | List your past TUI sessions with title, message count, and last active date. |
| `/resume <id>` | Restore a past session by its ID prefix and continue the conversation. |
| `/reset` | Clear the current conversation and start a fresh session. |

### Listing sessions

```
/sessions
```

Yagr prints a numbered list of your past sessions, most recent first:

```
Past sessions:
  1. a3f2b1 — "Deploy the notification workflow" (12 messages, Mar 25)
  2. 9dc4e7 — "Set up the n8n webhook" (6 messages, Mar 24)
```

### Resuming a session

```
/resume a3f2b1
```

Pass the ID prefix shown in `/sessions`. Yagr swaps in the previous session without restarting — you can continue exactly where you left off.

## Recommended usage

Use the TUI as the primary operator console, then enable Telegram when you need remote access or a simple chat surface.
