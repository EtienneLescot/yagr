---
title: n8n Backend
description: "Yagr sits above n8n through n8n-as-code while keeping the agent and user surfaces outside the runtime."
---

# n8n Backend

Yagr does not run its own agent logic as an n8n workflow.

Instead, Yagr sits above n8n for automation work while keeping the agent, planning loop, and gateway surfaces outside that runtime. Yagr relies on the n8n-as-code foundation underneath.

## What Yagr configures

Yagr onboarding captures:

- the n8n instance URL
- the API key
- the selected project
- the local sync folder

This information is stored in the Yagr home so the operator experience stays stable across sessions.

## Why this matters

This separation is one of the central Yagr design decisions:

- Yagr is the product and agent layer
- n8n is the execution engine
- the visual workflow remains inspectable and editable

That is why Yagr is framed around a clear product boundary: the agent experience lives in Yagr, while execution happens in n8n.

## Relationship to n8n-as-code

Yagr and `n8n-as-code` are complementary:

- Yagr focuses on the agent product, intent capture, and user-facing surfaces
- `n8n-as-code` focuses on workflow GitOps, schema-grounded agent tooling, sync, and TypeScript workflows

If you need the workflow engineering product directly, go to [n8n-as-code](https://n8nascode.dev) or its [documentation](https://n8nascode.dev/docs).
