---
title: Yagr Overview
description: "Yagr is your autonomous coding agent grounded in observable local reality."
slug: /
---

# Yagr

**YAGR** means **Your Agent Grounded in Reality**.

Yagr is a local-first runtime for autonomous coding agents. It gives the agent a real operating environment: files, shell execution, provider configuration, sessions, checkpoints, runtime events, and multiple control surfaces.

## Why it exists

Most agents expose conversation history.

Yagr is built around a stronger idea: autonomous coding work should be inspectable beyond the chat transcript.

The current runtime already provides:

- a deepagents-based coding runtime
- provider/model setup
- local shell and file tool execution
- sessions and checkpoints
- CLI, TUI, Web UI, and Telegram surfaces

The target direction adds a user-friendly impact record for meaningful effects: changed files, created scripts, dependency changes, long-running processes, automations, checkpoints, and durable artifacts.

## What Yagr is not

Yagr is not a hardcoded workflow runner.

It is not bound to a specific orchestrator, Telegram, a specific model provider, or a single interface.

External tools and orchestrators can be used through local files, shell commands, installed skills, or future plugins. The core product stays focused on runtime clarity.

## Start here

- [Getting Started](./getting-started/)
- [Grounded in Reality](./concepts/grounded-in-reality)
- [Usage](./usage/)
- [Commands](./reference/commands)
