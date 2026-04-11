---
title: Testing
description: "Unit tests, integration tests, and provider matrix — how to run them."
---

# Testing

Yagr groups tests by cost: **unit** (`tests/*.test.mjs`), **integration bas niveau** (`tests/integration/`, lancé explicitement), **integration scénarios** (`test:integration`), **provider matrix** (`test:providers`).

## Unit tests

```bash
npm test
# or explicitly:
npm run test:unit
```

Runs all files matching `tests/*.test.mjs` only (not `tests/integration/`). Fast, no external dependencies, no LLM calls, no real provider. These are the tests to run after every code change.

### Test bootstrap profiles (YAML)

Isolated `YAGR_HOME` setup for scenario integration and provider-matrix tests is driven by YAML profiles under `scripts/test-bootstrap/profiles/` (`scenario-integration.yaml`, `provider-matrix.yaml`). The runner (`scripts/test-bootstrap/runner.mjs`) executes named phases in order with structured logging when `YAGR_TEST_BOOTSTRAP_LOG=1` or when the suite’s debug flag is on.

Validate profiles locally (no build required):

```bash
npm run test:bootstrap-profiles
```

### Intégration bas niveau (`tests/integration/`)

Ces fichiers **ne font pas partie** de `npm run test:unit` : ils peuvent appeler le réseau, un fournisseur LLM réel, etc.

#### LLM relay smoke (sans n8n)

Inférence minimale via le relay HTTP local (`POST /v1/chat/completions`) vers le fournisseur configuré dans `YAGR_HOME`. Rapide ; **sauté** automatiquement si aucune clé OpenRouter n’est définie (ex. CI).

```bash
npm run test:relay-inference
```

Fichier : `tests/integration/llm-relay-inference.test.mjs`. Il charge `.env` et `.env.test` à la racine du dépôt (comme le scénario d’intégration), pas seulement les variables déjà exportées dans le shell. Variable optionnelle : `YAGR_TEST_RELAY_MODEL` (défaut : `openai/gpt-4o-mini` côté OpenRouter).

Pour **inspecter le JSON d’exécutions n8n** après `yagr-proxy-workflow` (sans supprimer le workflow sur l’instance) :

```bash
YAGR_IT_KEEP_MANAGED_DOCKER=1 YAGR_SCN_SKIP_REMOTE_WORKFLOW_CLEANUP=1 YAGR_SCN_SCENARIOS=yagr-proxy-workflow npm run test:integration
# Reprendre l’id sur la ligne « skip remote workflow cleanup » puis :
node scripts/dump-n8n-executions-for-workflow.mjs '<workflowId>'
```

Le fichier `reports/last-n8n-executions-dump.json` est sous `reports/` (déjà ignoré par git). Le script cible par défaut `http://127.0.0.1:5678` pour la clé du home Docker géré (évite une confusion avec `N8N_HOST=http://localhost:5678` dans `.env`).

## Integration tests

```bash
npm run test:integration
```

Runs a multi-scenario integration test against a **single** LLM provider. Each scenario exercises a real-world agent interaction: answering questions, listing workflows, creating simple or complex workflows, explaining existing ones, etc. Results are written to `reports/scenario-integration-report.md`.

**CLI options** (env vars accepted as fallback):

| Option | Env var | Default | Description |
|---|---|---|---|
| `--provider <name>` | `YAGR_SCN_PROVIDER` | `DEFAULT_PROVIDER` | Provider to use |
| `--model <name>` | `YAGR_SCN_MODEL` | `DEFAULT_MODEL` | Model to use |
| *(env var only)* | `YAGR_SCN_SCENARIOS` | *(all)* | Comma-separated scenario IDs to run |
| `--no-markdown` | — | off | Skip writing the markdown report |

> **Note**: `YAGR_SCN_SCENARIOS` must be an env var (not a CLI arg) because `node --test` runs scripts in worker threads where custom argv is not forwarded.

Also reads `N8N_HOST` / `YAGR_IT_N8N_HOST` and `N8N_API_KEY` / `YAGR_IT_N8N_API_KEY` from the environment.

**Example — run specific failing scenarios:**

```bash
YAGR_SCN_SCENARIOS=setup-check,yagr-proxy-workflow npm run test:integration
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
