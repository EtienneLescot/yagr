---
title: Telegram
description: "Use Telegram as a gateway into Yagr, not as a separate product brain."
---

# Telegram

Telegram is one of Yagr's first external surfaces.

It is important to frame it correctly: Telegram is a gateway into the Yagr agent, not the product's center of gravity. The same Yagr brain should remain reachable from the TUI, CLI, future web surfaces, and other gateways.

## Setup flow

During `yagr onboard`, Yagr can configure Telegram for you. You can also rerun Telegram setup separately:

```bash
yagr telegram setup
```

Yagr will ask for a BotFather token, validate it against Telegram, persist it, and generate an onboarding deep link.

## Useful commands

```bash
yagr telegram setup
yagr telegram status
yagr telegram onboarding
yagr telegram reset
```

## Product rule

Telegram configuration is stored by Yagr itself. It is not meant to depend on ad hoc `TELEGRAM_BOT_TOKEN` environment variables at runtime.

## Linking chats

No extra step is needed after setup. When someone messages the bot for the first time, Yagr replies with a deep link. They click it, press **Start** in Telegram, and Yagr stores the linked chat automatically.

If you need to share the link manually (for example to onboard a second chat or to resend the link):

```bash
yagr telegram onboarding
```

Linked chats are persisted in the Yagr runtime configuration. That linked chat is then just another place where intent can enter the agent loop and be turned into workflows.

## Available commands

All commands work in private Telegram chats with the linked bot. Use `/help` to see the full list.

### Session management

- `/help` — list available commands with descriptions
- `/sessions` — list all conversation sessions for this chat
- `/resume <session_id>` — resume a specific conversation session
- `/delete <session_id>` — delete a conversation session
- `/new` or `/reset` — start a new conversation session

### Checkpoints

- `/checkpoints` — list all checkpoints for the current session
- `/save` (or `/checkpoint_save`) — save a checkpoint of the current session
- `/restore <checkpoint_id>` (or `/checkpoint_restore`) — restore a checkpoint
- `/checkpoint_delete <checkpoint_id>` — delete a specific checkpoint

### Operational commands

- `/pending` — show pending required actions
- `/approve` — grant pending permissions
- `/compact` — compaction runs automatically; this command confirms the policy
- `/status` — show gateway status and linked chat count