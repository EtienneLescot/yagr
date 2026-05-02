---
title: Contributing
description: "Set up a local development environment and run the test suite."
---

# Contributing

This guide covers how to get Yagr running locally for development and how to run the test suite.

## Prerequisites

- Node.js ≥ 24
- pnpm via Corepack
- At least one LLM provider configured (API key or OAuth account)

## Local setup

Clone the repository and install dependencies:

```bash
git clone https://github.com/EtienneLescot/yagr.git
cd yagr
corepack enable
pnpm install
```

Build the project:

```bash
pnpm run build
```

## Tests

Yagr has three test levels. See [Testing](./testing) for full details.

| Command | What it runs |
|---|---|
| `pnpm test` | Unit tests (fast, no external deps) |
| `pnpm run test:packages` | Package-level tests |
| `pnpm run test:unit` | Root unit tests after build |

## Development loop

After editing source files, rebuild before running tests:

```bash
pnpm run build
pnpm test
```

Use `pnpm run typecheck` to check types without rebuilding:

```bash
pnpm run typecheck
```
