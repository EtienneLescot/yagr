---
title: Grounded in Reality
description: "Why Yagr is positioned around observable autonomous coding instead of black-box agent work."
---

# Grounded in Reality

YAGR means **Your Agent Grounded in Reality**.

That originally meant grounding the agent in an orchestrator. The product direction is now broader: Yagr is grounded because it works inside the real development environment and should make important effects observable.

## The problem

Many autonomous agents leave users with a chat transcript and a filesystem full of side effects.

That is not enough when an agent can:

- create scripts
- modify configuration
- install dependencies
- start long-running processes
- create workflows or automations
- touch credentials
- call external systems

If those effects only live in conversation history, the agent becomes a black box.

## The Yagr position

Yagr should stay open-ended without becoming opaque.

It should be opinionated about the runtime contract:

- sessions and checkpoints matter
- facades stay thin
- providers stay swappable
- skills stay external and composable
- meaningful effects should be recorded at the right level

It should not be opinionated about a single orchestrator, model provider, or interface.

## The Impact Ledger direction

The target direction is an **Impact Ledger**: a structured record of meaningful agent effects.

The chat explains the work. The ledger records the impact.

Examples of impact:

- files created, modified, or removed
- dependency changes
- scripts and reports created by the agent
- long-running processes
- workflows, schedules, or webhooks
- checkpoint creation and restore points
- external calls that change state
- decisions that affect future execution

The principle is:

> Agent-authored metadata is context. Runtime-observed evidence is authority.

The agent can describe what it intended to do. Yagr should verify what actually changed whenever the runtime can observe it.

## Why this keeps Yagr open

Grounding is not a constraint on what the agent can build.

It is a constraint on opacity.

Yagr can still use external orchestrators, CI workflows, schedulers, service managers, containers, custom scripts, or future plugin-backed tools. The core should not hardcode those systems as the product identity.

The common contract is simpler:

> Whatever the agent changes in the real environment should be visible, attributable, and reviewable.

See the target architecture plan in the repository:
[Reality Layer And Impact Ledger](https://github.com/EtienneLescot/yagr/blob/main/architecture/target/observability-impact-ledger.md).
