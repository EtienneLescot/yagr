---
title: Yagr Overview
description: "Yagr is your autonomous agent, grounded in reliable infrastructure instead of ephemeral scripts and blind API calls."
slug: /
---

# Yagr

Yagr is the automation agent layer of this repository.

The product ambition is not just to wrap setup and runtime concerns more nicely. The ambition is to turn natural language into live automations on top of infrastructure that remains inspectable and reliable.

Yagr is designed to sit above execution orchestrators. Today that means n8n through the existing n8n-as-code foundation. Tomorrow the same product surface can target a native Yagr runtime or other orchestrators. The user story stays the same: describe the automation you want, then let Yagr build, inspect, evolve, and operate it.

## Vision

> Your autonomous agent. Grounded in reliable infrastructure.

## Why another autonomous agent?

Most AI agents today execute tasks by writing ephemeral scripts or firing blind API calls. It works once, but it creates a black box that is difficult to audit, difficult to secure, and fragile over time.

Yagr takes the opposite path. It is a general-purpose autonomous agent whose execution layer is grounded in deterministic workflows.

That is why, when Yagr acts, it should architect, validate, and deploy a real workflow underneath the conversation rather than disappearing into a temporary script.

That implies four design choices:

- Yagr is the agent brain. It should not itself be implemented as a monolithic n8n workflow.
- n8n is the current orchestrator, not the product identity.
- gateways such as Telegram, TUI, CLI, or Web are just surfaces into the same agent.
- workflows are durable memory and muscle: persisted intent that Yagr can later revisit, explain, modify, extend, and execute reliably.

## What Yagr does today

- Configures the current orchestrator connection once through `yagr onboard`
- Stores Yagr state in its own home instead of arbitrary repo roots
- Persists model and gateway credentials through setup instead of shell drift
- Starts the local runtime through the Web UI or the TUI with `yagr start`
- Builds on the n8n-as-code ontology and workflow tooling instead of re-inventing that layer

## Product map

This repository now contains two user-facing products:

- **Yagr**: the automation agent product. Its docs live under `/yagr/docs`.
- **n8n-as-code**: the workflow GitOps and agent skill product. Its landing page lives at `/n8n-as-code`, and its documentation remains at `/docs`.

## Start here

- Go to [Getting Started](/yagr/docs/getting-started)
- See the [command reference](/yagr/docs/reference/commands)
- Jump to [n8n-as-code](/n8n-as-code) if what you want is direct workflow GitOps and engineering tooling rather than the Yagr agent product