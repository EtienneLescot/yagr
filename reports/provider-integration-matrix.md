# Provider Integration Matrix

- Generated at: 2026-03-25T19:02:46.706Z
- Providers: `Claude (anthropic)`, `OpenAI (openai)`, `Gemini (google)`, `Mistral (mistral)`, `OpenRouter (openrouter)`, `OpenAI (openai-proxy)`, `Claude (anthropic-proxy)`, `GitHub (copilot-proxy)`
- Timeouts: setup/model=60000ms, inference=75000ms
- Advanced scenario: enabled (timeout=180000ms)

## Summary

| Step | PASS | FAIL | SKIP |
| --- | ---: | ---: | ---: |
| setup | 7 | 1 | 0 |
| model-listing | 7 | 1 | 0 |
| inference | 7 | 1 | 0 |
| advanced-scenario | 5 | 3 | 0 |

## Provider Overview

| Provider | Model | Tooling | Setup | Model Listing | Inference | Advanced Scenario |
| --- | --- | --- | --- | --- | --- | --- |
| `Claude (anthropic)` | `claude-haiku-4-5-20251001` | `native` | **PASS**<br>API key detected in environment. | **PASS**<br>9 models: claude-3-haiku-20240307, claude-haiku-4-5-20251001, claude-opus-4-1-20250805, claude-opus-4-20250514, claude-opus-4-5-20251101, claude-opus-4-6, claude-sonnet-4-20250514, claude-sonnet-4-5-20250929 (+1 more) | **PASS**<br>Model claude-haiku-4-5-20251001 responded (2 chars). | **PASS**<br>CLI scenario succeeded with model claude-haiku-4-5-20251001. checklist: n8nac=yes, actions=validate/push/verify/validate/validate/verify, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0 |
| `OpenAI (openai)` | `gpt-5-mini` | `native` | **PASS**<br>API key detected in environment. | **PASS**<br>129 models: babbage-002, chatgpt-image-latest, dall-e-2, dall-e-3, davinci-002, gpt-3.5-turbo, gpt-3.5-turbo-0125, gpt-3.5-turbo-1106 (+121 more) | **PASS**<br>Model gpt-5-mini responded (2 chars). | **FAIL**<br>Timeout after 185000ms |
| `Gemini (google)` | `gemini-3-flash-preview` | `native` | **PASS**<br>API key detected in environment. | **PASS**<br>28 models: gemini-2.0-flash, gemini-2.0-flash-001, gemini-2.0-flash-lite, gemini-2.0-flash-lite-001, gemini-2.5-computer-use-preview-10-2025, gemini-2.5-flash, gemini-2.5-flash-image, gemini-2.5-flash-lite (+20 more) | **PASS**<br>Model gemini-3-flash-preview responded (2 chars). | **FAIL**<br>CLI scenario exited cleanly but created or modified no .workflow.ts file in /tmp/yagr-provider-advanced/google-jovymV/n8n-workspace/workflows/local_5678_etienne_l/personal: Le workflow n'a pas été créé ni enregistré. Les actions de création et de transfert n'ont pas pu être confirmées. [tool:reportProgress] status: Checking workspace initialization... [tool:reportProgress] status: Reading … (log: /home/etienne/repos/yagr/reports/provider-advanced-logs/google-2026-03-25T18-58-14-060Z.log) checklist: n8nac=no, actions=none, push=no, verify=no, embed=no, embedUrl=no, embedDiagram=no, workflowFile=no, remoteCreated=0, blockingActions=0, followUps=0 |
| `Mistral (mistral)` | `ministral-8b-latest` | `compatible` | **PASS**<br>API key detected in environment. | **PASS**<br>62 models: codestral-2508, codestral-embed, codestral-embed-2505, codestral-latest, devstral-2512, devstral-latest, devstral-medium-2507, devstral-medium-latest (+54 more) | **PASS**<br>Model ministral-8b-latest responded (2 chars). | **PASS**<br>CLI scenario succeeded with model ministral-8b-latest. checklist: n8nac=yes, actions=list/push/verify, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0 |
| `OpenRouter (openrouter)` | `minimax/minimax-m2.7` | `compatible` | **PASS**<br>API key detected in environment. | **PASS**<br>347 models: ai21/jamba-large-1.7, aion-labs/aion-1.0, aion-labs/aion-1.0-mini, aion-labs/aion-2.0, aion-labs/aion-rp-llama-3.1-8b, alfredpros/codellama-7b-instruct-solidity, alibaba/tongyi-deepresearch-30b-a3b, allenai/olmo-2-0325-32b-instruct (+339 more) | **PASS**<br>Model minimax/minimax-m2.7 responded (2 chars). | **PASS**<br>CLI scenario succeeded with model minimax/minimax-m2.7. checklist: n8nac=yes, actions=list/skills/skills/validate/list/validate/push/verify, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0 |
| `OpenAI (openai-proxy)` | `gpt-5.1-codex-mini` | `compatible` | **FAIL**<br>{"error":{"type":"usage_limit_reached","message":"The usage limit has been reached","plan_type":"plus","resets_at":1774612173,"eligible_promo":null,"resets_in_seconds":146954}} | **FAIL**<br>Missing API key for model discovery. | **FAIL**<br>{"error":{"type":"usage_limit_reached","message":"The usage limit has been reached","plan_type":"plus","resets_at":1774612172,"eligible_promo":null,"resets_in_seconds":146953}} | **FAIL**<br>{"error":{"type":"usage_limit_reached","message":"The usage limit has been reached","plan_type":"plus","resets_at":1774612173,"eligible_promo":null,"resets_in_seconds":146952}} (log: /home/etienne/repos/yagr/reports/provider-advanced-logs/openai-proxy-2026-03-25T19-00-21-311Z.log) checklist: n8nac=no, actions=none, push=no, verify=no, embed=no, embedUrl=no, embedDiagram=no, workflowFile=no, remoteCreated=0, blockingActions=0, followUps=0 |
| `Claude (anthropic-proxy)` | `claude-haiku-4-5-20251001` | `native` | **PASS**<br>9 models: claude-3-haiku-20240307, claude-haiku-4-5-20251001, claude-opus-4-1-20250805, claude-opus-4-20250514, claude-opus-4-5-20251101, claude-opus-4-6, claude-sonnet-4-20250514, claude-sonnet-4-5-20250929 (+1 more) | **PASS**<br>9 models: claude-3-haiku-20240307, claude-haiku-4-5-20251001, claude-opus-4-1-20250805, claude-opus-4-20250514, claude-opus-4-5-20251101, claude-opus-4-6, claude-sonnet-4-20250514, claude-sonnet-4-5-20250929 (+1 more) | **PASS**<br>Model claude-haiku-4-5-20251001 responded (2 chars). | **PASS**<br>CLI scenario succeeded with model claude-haiku-4-5-20251001. checklist: n8nac=yes, actions=list/list/validate/push/verify/skills/verify, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0 |
| `GitHub (copilot-proxy)` | `gpt-5.4` | `native` | **PASS**<br>41 models: claude-haiku-4.5, claude-opus-4.5, claude-opus-4.6, claude-opus-4.6-fast, claude-sonnet-4, claude-sonnet-4.5, claude-sonnet-4.6, gemini-2.5-pro (+33 more) | **PASS**<br>41 models: claude-haiku-4.5, claude-opus-4.5, claude-opus-4.6, claude-opus-4.6-fast, claude-sonnet-4, claude-sonnet-4.5, claude-sonnet-4.6, gemini-2.5-pro (+33 more) | **PASS**<br>Model gpt-5.4 responded (2 chars). | **PASS**<br>CLI scenario succeeded with model gpt-5.4. checklist: n8nac=yes, actions=list/skills/skills/skills/list/list/skills/push/verify, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0 |

## Detailed Results

### Claude (anthropic)

- Model: `claude-haiku-4-5-20251001`
- Tooling level: `native`
- Setup: **PASS**
- Model listing: **PASS**
- Inference: **PASS**
- Advanced scenario: **PASS**

**Notes**

- Setup: API key detected in environment.
- Model listing: 9 models: claude-3-haiku-20240307, claude-haiku-4-5-20251001, claude-opus-4-1-20250805, claude-opus-4-20250514, claude-opus-4-5-20251101, claude-opus-4-6, claude-sonnet-4-20250514, claude-sonnet-4-5-20250929 (+1 more)
- Inference: Model claude-haiku-4-5-20251001 responded (2 chars).
- Advanced scenario: CLI scenario succeeded with model claude-haiku-4-5-20251001. checklist: n8nac=yes, actions=validate/push/verify/validate/validate/verify, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

**Advanced Final Response**

```text
✅ Workflow créé et déployé avec succès.
**Détails:**
- **Nom:** yagr-it-anthropic-1774464806375-minimal
- **Noeuds:** Manual Trigger + Set (status="ok")
- **URL:** http://localhost:5678/workflow/zEiVl0WAkUVPHh5N
Le workflow est enregistré et actif.
```

### OpenAI (openai)

- Model: `gpt-5-mini`
- Tooling level: `native`
- Setup: **PASS**
- Model listing: **PASS**
- Inference: **PASS**
- Advanced scenario: **FAIL**

**Notes**

- Setup: API key detected in environment.
- Model listing: 129 models: babbage-002, chatgpt-image-latest, dall-e-2, dall-e-3, davinci-002, gpt-3.5-turbo, gpt-3.5-turbo-0125, gpt-3.5-turbo-1106 (+121 more)
- Inference: Model gpt-5-mini responded (2 chars).
- Advanced scenario: Timeout after 185000ms

### Gemini (google)

- Model: `gemini-3-flash-preview`
- Tooling level: `native`
- Setup: **PASS**
- Model listing: **PASS**
- Inference: **PASS**
- Advanced scenario: **FAIL**

**Notes**

- Setup: API key detected in environment.
- Model listing: 28 models: gemini-2.0-flash, gemini-2.0-flash-001, gemini-2.0-flash-lite, gemini-2.0-flash-lite-001, gemini-2.5-computer-use-preview-10-2025, gemini-2.5-flash, gemini-2.5-flash-image, gemini-2.5-flash-lite (+20 more)
- Inference: Model gemini-3-flash-preview responded (2 chars).
- Advanced scenario: CLI scenario exited cleanly but created or modified no .workflow.ts file in /tmp/yagr-provider-advanced/google-jovymV/n8n-workspace/workflows/local_5678_etienne_l/personal: Le workflow n'a pas été créé ni enregistré. Les actions de création et de transfert n'ont pas pu être confirmées. [tool:reportProgress] status: Checking workspace initialization... [tool:reportProgress] status: Reading … (log: /home/etienne/repos/yagr/reports/provider-advanced-logs/google-2026-03-25T18-58-14-060Z.log) checklist: n8nac=no, actions=none, push=no, verify=no, embed=no, embedUrl=no, embedDiagram=no, workflowFile=no, remoteCreated=0, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

**Advanced Final Response**

```text
Le workflow n'a pas été créé ni enregistré. Les actions de création et de transfert n'ont pas pu être confirmées.
```

### Mistral (mistral)

- Model: `ministral-8b-latest`
- Tooling level: `compatible`
- Setup: **PASS**
- Model listing: **PASS**
- Inference: **PASS**
- Advanced scenario: **PASS**

**Notes**

- Setup: API key detected in environment.
- Model listing: 62 models: codestral-2508, codestral-embed, codestral-embed-2505, codestral-latest, devstral-2512, devstral-latest, devstral-medium-2507, devstral-medium-latest (+54 more)
- Inference: Model ministral-8b-latest responded (2 chars).
- Advanced scenario: CLI scenario succeeded with model ministral-8b-latest. checklist: n8nac=yes, actions=list/push/verify, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

**Advanced Final Response**

```text
Le workflow minimal demandé est prêt et enregistré avec succès.
Vous pouvez le consulter ici :
[http://localhost:5678/workflow/Etad9GQUT8dfN9q7](http://localhost:5678/workflow/Etad9GQUT8dfN9q7)
Il contient bien :
- Un nœud **Manual Trigger**
- Un nœud **Set** définissant `status="ok"`
Aucune étape supplémentaire n'est requise.
```

### OpenRouter (openrouter)

- Model: `minimax/minimax-m2.7`
- Tooling level: `compatible`
- Setup: **PASS**
- Model listing: **PASS**
- Inference: **PASS**
- Advanced scenario: **PASS**

**Notes**

- Setup: API key detected in environment.
- Model listing: 347 models: ai21/jamba-large-1.7, aion-labs/aion-1.0, aion-labs/aion-1.0-mini, aion-labs/aion-2.0, aion-labs/aion-rp-llama-3.1-8b, alfredpros/codellama-7b-instruct-solidity, alibaba/tongyi-deepresearch-30b-a3b, allenai/olmo-2-0325-32b-instruct (+339 more)
- Inference: Model minimax/minimax-m2.7 responded (2 chars).
- Advanced scenario: CLI scenario succeeded with model minimax/minimax-m2.7. checklist: n8nac=yes, actions=list/skills/skills/validate/list/validate/push/verify, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

**Advanced Final Response**

```text
Le workflow a été créé, enregistré et poussé avec succès.
**Nom :** yagr-it-openrouter-1774465121561
**URL :** http://localhost:5678/workflow/yyVrmHMipEM4mX3k
Il contient un Manual Trigger suivi d'un noeud Set qui définit `status="ok"`.
```

### OpenAI (openai-proxy)

- Model: `gpt-5.1-codex-mini`
- Tooling level: `compatible`
- Setup: **FAIL**
- Model listing: **FAIL**
- Inference: **FAIL**
- Advanced scenario: **FAIL**

**Notes**

- Setup: {"error":{"type":"usage_limit_reached","message":"The usage limit has been reached","plan_type":"plus","resets_at":1774612173,"eligible_promo":null,"resets_in_seconds":146954}}
- Model listing: Missing API key for model discovery.
- Inference: {"error":{"type":"usage_limit_reached","message":"The usage limit has been reached","plan_type":"plus","resets_at":1774612172,"eligible_promo":null,"resets_in_seconds":146953}}
- Advanced scenario: {"error":{"type":"usage_limit_reached","message":"The usage limit has been reached","plan_type":"plus","resets_at":1774612173,"eligible_promo":null,"resets_in_seconds":146952}} (log: /home/etienne/repos/yagr/reports/provider-advanced-logs/openai-proxy-2026-03-25T19-00-21-311Z.log) checklist: n8nac=no, actions=none, push=no, verify=no, embed=no, embedUrl=no, embedDiagram=no, workflowFile=no, remoteCreated=0, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

### Claude (anthropic-proxy)

- Model: `claude-haiku-4-5-20251001`
- Tooling level: `native`
- Setup: **PASS**
- Model listing: **PASS**
- Inference: **PASS**
- Advanced scenario: **PASS**

**Notes**

- Setup: 9 models: claude-3-haiku-20240307, claude-haiku-4-5-20251001, claude-opus-4-1-20250805, claude-opus-4-20250514, claude-opus-4-5-20251101, claude-opus-4-6, claude-sonnet-4-20250514, claude-sonnet-4-5-20250929 (+1 more)
- Model listing: 9 models: claude-3-haiku-20240307, claude-haiku-4-5-20251001, claude-opus-4-1-20250805, claude-opus-4-20250514, claude-opus-4-5-20251101, claude-opus-4-6, claude-sonnet-4-20250514, claude-sonnet-4-5-20250929 (+1 more)
- Inference: Model claude-haiku-4-5-20251001 responded (2 chars).
- Advanced scenario: CLI scenario succeeded with model claude-haiku-4-5-20251001. checklist: n8nac=yes, actions=list/list/validate/push/verify/skills/verify, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

**Advanced Final Response**

```text
✅ Workflow créé et déployé avec succès.
**Détails:**
- Nom: `yagr-it-anthropic-proxy-1774465225641`
- Composition: Manual Trigger → Set (status="ok")
- URL: http://localhost:5678/workflow/j4SLAqQNeeZJyPzL
Le workflow est enregistré et actif.
```

### GitHub (copilot-proxy)

- Model: `gpt-5.4`
- Tooling level: `native`
- Setup: **PASS**
- Model listing: **PASS**
- Inference: **PASS**
- Advanced scenario: **PASS**

**Notes**

- Setup: 41 models: claude-haiku-4.5, claude-opus-4.5, claude-opus-4.6, claude-opus-4.6-fast, claude-sonnet-4, claude-sonnet-4.5, claude-sonnet-4.6, gemini-2.5-pro (+33 more)
- Model listing: 41 models: claude-haiku-4.5, claude-opus-4.5, claude-opus-4.6, claude-opus-4.6-fast, claude-sonnet-4, claude-sonnet-4.5, claude-sonnet-4.6, gemini-2.5-pro (+33 more)
- Inference: Model gpt-5.4 responded (2 chars).
- Advanced scenario: CLI scenario succeeded with model gpt-5.4. checklist: n8nac=yes, actions=list/skills/skills/skills/list/list/skills/push/verify, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

**Advanced Final Response**

```text
C’est fait.
Workflow créé, enregistré et poussé :
http://localhost:5678/workflow/nTpZfT1fzyobEbMY
Nom du workflow : `yagr-it-copilot-proxy-1774465290320-minimal`
```

