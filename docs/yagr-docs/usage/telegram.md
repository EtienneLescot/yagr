---
title: Telegram
description: "Use Telegram as a gateway into Yagr, not as a separate product brain."
---

# Telegram

Telegram is one of Yagr's first external surfaces.

It is important to frame it correctly: Telegram is a gateway into the Yagr agent, not the product's center of gravity. The same Yagr brain should remain reachable from the TUI, CLI, future web surfaces, and other gateways.

## Setup flow

During `yagr setup`, Yagr can configure Telegram for you. You can also rerun Telegram setup separately:

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

After setup, share the onboarding link or QR code and press **Start** in Telegram. Yagr stores linked chats in its runtime configuration.

That linked chat is then just another place where intent can enter the agent loop and be turned into workflows.