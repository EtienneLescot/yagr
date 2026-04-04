---
title: Testing
description: "Unit tests, integration tests, and provider matrix — how to run them."
---

# Testing

Yagr has three distinct test levels, each with a different scope and a different cost.

## Unit tests

```bash
npm test
# or explicitly:
npm run test:unit
```

Runs all files matching `tests/*.test.mjs`. Fast, no external dependencies, no LLM calls. These are the tests to run after every code change.

## Integration tests

```bash
npm run test:integration
```

Runs a multi-scenario integration test against a **single** LLM provider. Each scenario exercises a real-world agent interaction: answering questions, listing workflows, creating simple or complex workflows, explaining existing ones, etc. Results are written to `reports/scenario-integration-report.md`.

**CLI options** (env vars accepted as fallback):

| Option | Env var fallback | Default | Description |
|---|---|---|---|
| `--provider <name>` | `YAGR_SCN_PROVIDER` | `DEFAULT_PROVIDER` | Provider to use |
| `--model <name>` | `YAGR_SCN_MODEL` | `DEFAULT_MODEL` | Model to use |
| `--scenarios <ids>` | `YAGR_SCN_SCENARIOS` | *(all)* | Comma-separated scenario IDs to run |
| `--no-markdown` | — | off | Skip writing the markdown report |

Also reads `N8N_HOST` / `YAGR_IT_N8N_HOST` and `N8N_API_KEY` / `YAGR_IT_N8N_API_KEY` from the environment.

**Example — run a single scenario with a specific model:**

```bash
npm run test:integration -- --provider anthropic --model claude-sonnet-4-5 --scenarios credential-orchestration
```

## Provider tests

```bash
npm run test:providers
```

Runs the provider integration matrix: one inference test (and one workflow creation test) **per provider**. Always runs in advanced + strict mode. Results are written to `reports/provider-integration-matrix.md`.

**Advanced mode** includes a real workflow push to n8n. It requires a configured n8n instance.

**Configuration via environment variables:**

| Variable | Default | Description |
|---|---|---|
| `YAGR_IT_PROVIDERS` | *(all supported)* | Comma-separated list of providers to test |
| `YAGR_IT_FORCE_MODEL` | — | Force a specific model for all providers |
| `YAGR_IT_ADVANCED_PROMPT` | *(built-in)* | Custom prompt for the workflow creation test |
| `YAGR_IT_ADVANCED_TIMEOUT_MS` | `180000` | Timeout for the workflow creation test (ms) |
| `YAGR_IT_TIMEOUT_MS` | `60000` | Timeout for inference tests (ms) |
| `N8N_HOST` / `YAGR_IT_N8N_HOST` | — | n8n host |
| `N8N_API_KEY` / `YAGR_IT_N8N_API_KEY` | — | n8n API key |

**Example — run only API-key providers:**

```bash
YAGR_IT_PROVIDERS=openai,anthropic,google,mistral,openrouter \
npm run test:providers
```

**Example — run a single provider:**

```bash
YAGR_IT_PROVIDERS=anthropic npm run test:providers
```
