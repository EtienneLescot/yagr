---
title: Telegram
description: "Use Telegram as a gateway into Holon, not as a separate product brain."
---

# Telegram

Telegram is one of Holon's first external surfaces.

It is important to frame it correctly: Telegram is a gateway into the Holon agent, not the product's center of gravity. The same Holon brain should remain reachable from the TUI, CLI, future web surfaces, and other gateways.

## Setup flow

During `holon setup`, Holon can configure Telegram for you. You can also rerun Telegram setup separately:

```bash
holon telegram setup
```

Holon will ask for a BotFather token, validate it against Telegram, persist it, and generate an onboarding deep link.

## Useful commands

```bash
holon telegram setup
holon telegram status
holon telegram onboarding
holon telegram reset
```

## Product rule

Telegram configuration is stored by Holon itself. It is not meant to depend on ad hoc `TELEGRAM_BOT_TOKEN` environment variables at runtime.

## Linking chats

After setup, share the onboarding link or QR code and press **Start** in Telegram. Holon stores linked chats in its runtime configuration.

That linked chat is then just another place where intent can enter the agent loop and be turned into workflows.