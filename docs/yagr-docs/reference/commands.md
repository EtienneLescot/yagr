---
title: Commands
description: "Core Yagr CLI commands."
---

# Commands

## Core flow

```bash
yagr onboard        # first-run setup
yagr start          # start gateways in the background (Telegram, etc.)
yagr tui            # open a terminal chat session
yagr webui          # open the local web interface
yagr stop           # stop the background gateway
yagr gateway status # check whether a daemon is currently running
```

## Telegram

```bash
yagr telegram setup        # configure a Telegram bot
yagr telegram start        # start the Telegram gateway in the foreground
yagr telegram status       # show bot and linked chats
yagr telegram reset        # remove Telegram configuration
```

To share the onboarding link manually (for example to link an additional chat):

```bash
yagr telegram onboarding
```

In normal usage this is not necessary: when someone messages the bot without a linked chat, Yagr replies with the link automatically.

## Config

```bash
yagr config show
yagr config reset
```

## Notes

- `yagr onboard` is the standard first-run command and currently drives the same interactive setup flow as `yagr setup`.
- `yagr start` launches messaging gateways as a background daemon and returns to your shell. It will trigger setup automatically if the runtime is not ready.
- `yagr tui` and `yagr webui` open interactive sessions independently. They do not require the background daemon to be running.
- Runtime configuration is expected to come from setup, not from ad hoc environment variable injection.