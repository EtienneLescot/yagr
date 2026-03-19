---
title: Execution Orchestrators
description: "Yagr sits above execution orchestrators. Today that means n8n through n8n-as-code, while keeping the product layer independent from any single runtime."
---

# Execution Orchestrators

Yagr does not run its own agent logic as an n8n workflow.

Instead, Yagr sits above an execution orchestrator for automation work while keeping the agent, planning loop, and gateway surfaces outside that runtime. Today, that orchestrator is n8n through the n8n-as-code foundation.

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
- n8n is the current orchestrator
- support for additional orchestrators may be added later as an optional choice, without rewriting the user story

That is why Yagr is framed around an orchestrator boundary: n8n is the primary backend, and support for additional orchestrators may be offered later as an optional choice.

## Relationship to n8n-as-code

Yagr and `n8n-as-code` are complementary:

- Yagr focuses on the agent product, intent capture, and user-facing surfaces
- `n8n-as-code` focuses on workflow GitOps, schema-grounded agent tooling, sync, and TypeScript workflows

If you need the workflow engineering product directly, go to [n8n-as-code](https://n8nascode.dev) or its [documentation](https://n8nascode.dev/docs).