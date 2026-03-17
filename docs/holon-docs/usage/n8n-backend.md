---
title: n8n Backend
description: "Holon uses n8n as its V1 execution backend while keeping the product layer above the engine."
---

# n8n Backend

Holon does not run its own agent logic as an n8n workflow.

Instead, Holon uses n8n as its V1 execution backend for automation work while keeping the agent, planning loop, and gateway surfaces outside the execution engine.

## What Holon configures

Holon setup captures:

- the n8n instance URL
- the API key
- the selected project
- the local sync folder

This information is stored in the Holon home so the operator experience stays stable across sessions.

## Why this matters

This separation is one of the central Holon design decisions:

- Holon is the product and agent layer
- n8n is the current execution backend
- the backend should remain swappable without rewriting the user story

That is why the blueprint treats n8n as V1 and leaves room for a future native Holon engine.

## Relationship to n8n-as-code

Holon and `n8n-as-code` are complementary:

- Holon focuses on the agent product, intent capture, and user-facing surfaces
- `n8n-as-code` focuses on workflow GitOps, schema-grounded agent tooling, sync, and TypeScript workflows

If you need the workflow engineering product directly, go to [n8n-as-code](/n8n-as-code) or its documentation at [/docs](/docs).