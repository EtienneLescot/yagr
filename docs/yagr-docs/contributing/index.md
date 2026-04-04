---
title: Contributing
description: "Set up a local development environment and run the test suite."
---

# Contributing

This guide covers how to get Yagr running locally for development and how to run the test suite.

## Prerequisites

- Node.js ≥ 22
- A running n8n instance (local or remote) for integration and provider tests
- At least one LLM provider configured (API key or OAuth account)

## Local setup

Clone the repository and install dependencies:

```bash
git clone https://github.com/EtienneLescot/yagr.git
cd yagr
npm install
```

Build the project:

```bash
npm run build
```

## Tests

Yagr has three test levels. See [Testing](./testing) for full details.

| Command | What it runs |
|---|---|
| `npm test` | Unit tests (fast, no external deps) |
| `npm run test:integration` | Scenario integration test against a single LLM provider |
| `npm run test:providers` | Provider matrix — all providers, always in advanced + strict mode |

## Development workflow

After editing source files, rebuild before running tests:

```bash
npm run build
npm test
```

Use `npm run typecheck` to check types without rebuilding:

```bash
npm run typecheck
```
