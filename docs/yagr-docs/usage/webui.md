---
title: Web UI
description: "Use Yagr from a browser through its local web interface."
---

# Web UI

The Web UI is Yagr's browser-based surface for local use. It runs as a local HTTP server and exposes the same agent as the TUI and Telegram — there is no separate brain behind it.

## Start the Web UI

```bash
yagr webui
```

This starts the server and opens the interface in your default browser. If setup is incomplete, Yagr will drive you through the missing steps first.

You can also launch it from the universal launcher:

```bash
yagr start
```

The launcher will ask whether to open the Web UI or the TUI.

## The interface

The Web UI is made up of two areas:

**Left sidebar**

- A summary of the current Yagr configuration (n8n host, project, enabled surfaces).
- The conversation history panel: a list of your past sessions ordered by most recently active.

**Main chat area**

- A message log with streaming responses, tool call progress, and run status.
- A composer to send new messages.
- A **Reset** button to clear the current conversation and start fresh.

## Session history

Yagr saves every conversation to disk. The sidebar shows all past Web UI sessions. Click any entry to restore the conversation and continue from where you left off.

To start a new conversation without clearing history, click the **+** button at the top of the history panel.

Sessions are stored locally under `~/.yagr/sessions/`. Switching sessions or navigating away does not delete anything — conversations remain accessible until explicitly reset or cleared.

## Configuration

The **Settings** page (gear icon in the sidebar) lets you adjust:

- The n8n connection (host, API key, project, sync folder)
- The LLM provider (provider, model, API key, base URL)
- The Telegram gateway (enable/disable, bot token)

Settings are saved to `~/.yagr/` and take effect immediately without restarting.

## Multiple tabs and sessions

The Web UI stores the active session ID in the browser's `localStorage`. Opening a second tab starts from that same session until you switch or create a new one. Each browser profile maintains its own active session pointer, but all sessions are stored in the same shared `~/.yagr/sessions/` directory.
