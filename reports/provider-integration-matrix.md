# Provider Integration Matrix

- Generated at: 2026-03-24T17:32:53.319Z
- Providers: `Gemini (google)`, `OpenAI (openai-proxy)`, `GitHub (copilot-proxy)`
- Timeouts: setup/model=60000ms, inference=75000ms
- Advanced scenario: enabled (timeout=180000ms)

## Summary

| Step | PASS | FAIL | SKIP |
| --- | ---: | ---: | ---: |
| setup | 2 | 1 | 0 |
| model-listing | 2 | 1 | 0 |
| inference | 2 | 1 | 0 |
| advanced-scenario | 0 | 3 | 0 |

## Provider Overview

| Provider | Model | Tooling | Setup | Model Listing | Inference | Advanced Scenario |
| --- | --- | --- | --- | --- | --- | --- |
| `Gemini (google)` | `gemini-2.5-flash` | `native` | **PASS**<br>API key detected in environment. | **PASS**<br>28 models: gemini-2.0-flash, gemini-2.0-flash-001, gemini-2.0-flash-lite, gemini-2.0-flash-lite-001, gemini-2.5-computer-use-preview-10-2025, gemini-2.5-flash, gemini-2.5-flash-image, gemini-2.5-flash-lite (+20 more) | **PASS**<br>Model gemini-2.5-flash responded (2 chars). | **FAIL**<br>CLI scenario exited cleanly but created or modified no .workflow.ts file in /tmp/yagr-provider-advanced/google-UXCWuU/n8n-workspace/workflows/local_5678_etienne_l/personal: Le workflow n'a pas pu être créé en raison d'une erreur. [tool:n8nac] status: Runtime cwd=. envHost=http://localhost:5678 envApiKey=present configHost=http://localhost:5678 configProject=Personal configInstance=local_56… (log: /home/etienne/repos/yagr/reports/provider-advanced-logs/google-2026-03-24T17-32-14-995Z.log) checklist: n8nac=yes, actions=skills/skills, push=no, verify=no, embed=no, embedUrl=no, embedDiagram=no, workflowFile=no, remoteCreated=0, blockingActions=0, followUps=0 |
| `OpenAI (openai-proxy)` | `gpt-5.1-codex-mini` | `compatible` | **FAIL**<br>{"error":{"type":"usage_limit_reached","message":"The usage limit has been reached","plan_type":"plus","resets_at":1774612172,"eligible_promo":null,"resets_in_seconds":238635}} | **FAIL**<br>Missing API key for model discovery. | **FAIL**<br>{"error":{"type":"usage_limit_reached","message":"The usage limit has been reached","plan_type":"plus","resets_at":1774612173,"eligible_promo":null,"resets_in_seconds":238635}} | **FAIL**<br>{"error":{"type":"usage_limit_reached","message":"The usage limit has been reached","plan_type":"plus","resets_at":1774612172,"eligible_promo":null,"resets_in_seconds":238633}} (log: /home/etienne/repos/yagr/reports/provider-advanced-logs/openai-proxy-2026-03-24T17-32-19-953Z.log) checklist: n8nac=no, actions=none, push=no, verify=no, embed=no, embedUrl=no, embedDiagram=no, workflowFile=no, remoteCreated=0, blockingActions=0, followUps=0 |
| `GitHub (copilot-proxy)` | `gpt-4.1` | `compatible` | **PASS**<br>41 models: claude-haiku-4.5, claude-opus-4.5, claude-opus-4.6, claude-opus-4.6-fast, claude-sonnet-4, claude-sonnet-4.5, claude-sonnet-4.6, gemini-2.5-pro (+33 more) | **PASS**<br>41 models: claude-haiku-4.5, claude-opus-4.5, claude-opus-4.6, claude-opus-4.6-fast, claude-sonnet-4, claude-sonnet-4.5, claude-sonnet-4.6, gemini-2.5-pro (+33 more) | **PASS**<br>Model gpt-4.1 responded (2 chars). | **FAIL**<br>CLI scenario exited cleanly but created or modified no .workflow.ts file in /tmp/yagr-provider-advanced/copilot-proxy-wyLlTS/n8n-workspace/workflows/local_5678_etienne_l/personal: Le workflow n'a pas pu être créé et poussé car il n'a pas encore été enregistré ni validé. [tool:reportProgress] status: Vérifie les workflows existants et le schéma exact des noeuds pour créer un nouveau workflow minim… (log: /home/etienne/repos/yagr/reports/provider-advanced-logs/copilot-proxy-2026-03-24T17-32-52-231Z.log) checklist: n8nac=yes, actions=list/skills/skills/skills/skills, push=no, verify=no, embed=no, embedUrl=no, embedDiagram=no, workflowFile=no, remoteCreated=0, blockingActions=0, followUps=0 |

## Detailed Results

### Gemini (google)

- Model: `gemini-2.5-flash`
- Tooling level: `native`
- Setup: **PASS**
- Model listing: **PASS**
- Inference: **PASS**
- Advanced scenario: **FAIL**

**Notes**

- Setup: API key detected in environment.
- Model listing: 28 models: gemini-2.0-flash, gemini-2.0-flash-001, gemini-2.0-flash-lite, gemini-2.0-flash-lite-001, gemini-2.5-computer-use-preview-10-2025, gemini-2.5-flash, gemini-2.5-flash-image, gemini-2.5-flash-lite (+20 more)
- Inference: Model gemini-2.5-flash responded (2 chars).
- Advanced scenario: CLI scenario exited cleanly but created or modified no .workflow.ts file in /tmp/yagr-provider-advanced/google-UXCWuU/n8n-workspace/workflows/local_5678_etienne_l/personal: Le workflow n'a pas pu être créé en raison d'une erreur. [tool:n8nac] status: Runtime cwd=. envHost=http://localhost:5678 envApiKey=present configHost=http://localhost:5678 configProject=Personal configInstance=local_56… (log: /home/etienne/repos/yagr/reports/provider-advanced-logs/google-2026-03-24T17-32-14-995Z.log) checklist: n8nac=yes, actions=skills/skills, push=no, verify=no, embed=no, embedUrl=no, embedDiagram=no, workflowFile=no, remoteCreated=0, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

**Advanced Final Response**

```text
Le workflow n'a pas pu être créé en raison d'une erreur.
```

### OpenAI (openai-proxy)

- Model: `gpt-5.1-codex-mini`
- Tooling level: `compatible`
- Setup: **FAIL**
- Model listing: **FAIL**
- Inference: **FAIL**
- Advanced scenario: **FAIL**

**Notes**

- Setup: {"error":{"type":"usage_limit_reached","message":"The usage limit has been reached","plan_type":"plus","resets_at":1774612172,"eligible_promo":null,"resets_in_seconds":238635}}
- Model listing: Missing API key for model discovery.
- Inference: {"error":{"type":"usage_limit_reached","message":"The usage limit has been reached","plan_type":"plus","resets_at":1774612173,"eligible_promo":null,"resets_in_seconds":238635}}
- Advanced scenario: {"error":{"type":"usage_limit_reached","message":"The usage limit has been reached","plan_type":"plus","resets_at":1774612172,"eligible_promo":null,"resets_in_seconds":238633}} (log: /home/etienne/repos/yagr/reports/provider-advanced-logs/openai-proxy-2026-03-24T17-32-19-953Z.log) checklist: n8nac=no, actions=none, push=no, verify=no, embed=no, embedUrl=no, embedDiagram=no, workflowFile=no, remoteCreated=0, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

### GitHub (copilot-proxy)

- Model: `gpt-4.1`
- Tooling level: `compatible`
- Setup: **PASS**
- Model listing: **PASS**
- Inference: **PASS**
- Advanced scenario: **FAIL**

**Notes**

- Setup: 41 models: claude-haiku-4.5, claude-opus-4.5, claude-opus-4.6, claude-opus-4.6-fast, claude-sonnet-4, claude-sonnet-4.5, claude-sonnet-4.6, gemini-2.5-pro (+33 more)
- Model listing: 41 models: claude-haiku-4.5, claude-opus-4.5, claude-opus-4.6, claude-opus-4.6-fast, claude-sonnet-4, claude-sonnet-4.5, claude-sonnet-4.6, gemini-2.5-pro (+33 more)
- Inference: Model gpt-4.1 responded (2 chars).
- Advanced scenario: CLI scenario exited cleanly but created or modified no .workflow.ts file in /tmp/yagr-provider-advanced/copilot-proxy-wyLlTS/n8n-workspace/workflows/local_5678_etienne_l/personal: Le workflow n'a pas pu être créé et poussé car il n'a pas encore été enregistré ni validé. [tool:reportProgress] status: Vérifie les workflows existants et le schéma exact des noeuds pour créer un nouveau workflow minim… (log: /home/etienne/repos/yagr/reports/provider-advanced-logs/copilot-proxy-2026-03-24T17-32-52-231Z.log) checklist: n8nac=yes, actions=list/skills/skills/skills/skills, push=no, verify=no, embed=no, embedUrl=no, embedDiagram=no, workflowFile=no, remoteCreated=0, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

**Advanced Final Response**

```text
Le workflow n'a pas pu être créé et poussé car il n'a pas encore été enregistré ni validé.
```

