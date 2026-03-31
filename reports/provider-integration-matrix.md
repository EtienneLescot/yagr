# Provider Integration Matrix

- Generated at: 2026-03-31T17:26:07.145Z
- Providers: `Claude (anthropic)`, `OpenAI (openai)`, `Gemini (google)`, `Mistral (mistral)`, `OpenRouter (openrouter)`, `OpenAI (openai-proxy)`, `Claude (anthropic-proxy)`, `GitHub (copilot-proxy)`
- Timeouts: setup/model=60000ms, inference=75000ms
- Advanced scenario: enabled (timeout=180000ms)

## Summary

| Step | PASS | FAIL | SKIP |
| --- | ---: | ---: | ---: |
| setup | 8 | 0 | 0 |
| model-listing | 8 | 0 | 0 |
| inference | 8 | 0 | 0 |
| advanced-scenario | 7 | 1 | 0 |

## Provider Overview

| Provider | Model | Tooling | Setup | Model Listing | Inference | Advanced Scenario |
| --- | --- | --- | --- | --- | --- | --- |
| `Claude (anthropic)` | `claude-haiku-4-5-20251001` | `native` | **PASS**<br>API key detected in environment. | **PASS**<br>9 models: claude-3-haiku-20240307, claude-haiku-4-5-20251001, claude-opus-4-1-20250805, claude-opus-4-20250514, claude-opus-4-5-20251101, claude-opus-4-6, claude-sonnet-4-20250514, claude-sonnet-4-5-20250929 (+1 more) | **PASS**<br>Model claude-haiku-4-5-20251001 responded (2 chars). | **PASS**<br>CLI scenario succeeded with model claude-haiku-4-5-20251001. checklist: n8nac=yes, actions=validate/push/verify/skills/skills, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0 |
| `OpenAI (openai)` | `gpt-5-mini` | `native` | **PASS**<br>API key detected in environment. | **PASS**<br>126 models: babbage-002, chatgpt-image-latest, dall-e-2, dall-e-3, davinci-002, gpt-3.5-turbo, gpt-3.5-turbo-0125, gpt-3.5-turbo-1106 (+118 more) | **PASS**<br>Model gpt-5-mini responded (2 chars). | **FAIL**<br>CLI scenario completed the workflow actions but did not emit a complete workflow banner embed (url + diagram). (log: /home/etienne/repos/yagr/reports/provider-advanced-logs/openai-2026-03-31T17-18-20-491Z.log) checklist: n8nac=yes, actions=list/skills/skills/list/skills/skills/skills/list/validate/push/verify, push=yes, verify=yes, embed=no, embedUrl=no, embedDiagram=no, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0 |
| `Gemini (google)` | `gemini-3-flash-preview` | `native` | **PASS**<br>API key detected in environment. | **PASS**<br>29 models: gemini-2.0-flash, gemini-2.0-flash-001, gemini-2.0-flash-lite, gemini-2.0-flash-lite-001, gemini-2.5-computer-use-preview-10-2025, gemini-2.5-flash, gemini-2.5-flash-image, gemini-2.5-flash-lite (+21 more) | **PASS**<br>Model gemini-3-flash-preview responded (2 chars). | **PASS**<br>CLI scenario succeeded with model gemini-3-flash-preview. checklist: n8nac=yes, actions=push/verify, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0 |
| `Mistral (mistral)` | `ministral-8b-latest` | `compatible` | **PASS**<br>API key detected in environment. | **PASS**<br>59 models: codestral-2508, codestral-embed, codestral-embed-2505, codestral-latest, devstral-2512, devstral-latest, devstral-medium-2507, devstral-medium-latest (+51 more) | **PASS**<br>Model ministral-8b-latest responded (2 chars). | **PASS**<br>CLI scenario succeeded with model ministral-8b-latest. checklist: n8nac=yes, actions=push/verify, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0 |
| `OpenRouter (openrouter)` | `minimax/minimax-m2.7` | `compatible` | **PASS**<br>API key detected in environment. | **PASS**<br>348 models: ai21/jamba-large-1.7, aion-labs/aion-1.0, aion-labs/aion-1.0-mini, aion-labs/aion-2.0, aion-labs/aion-rp-llama-3.1-8b, alfredpros/codellama-7b-instruct-solidity, alibaba/tongyi-deepresearch-30b-a3b, allenai/olmo-2-0325-32b-instruct (+340 more) | **PASS**<br>Model minimax/minimax-m2.7 responded (2 chars). | **PASS**<br>CLI scenario succeeded with model minimax/minimax-m2.7. checklist: n8nac=yes, actions=skills/skills/skills/validate/push/verify, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0 |
| `OpenAI (openai-proxy)` | `gpt-5.3-codex` | `compatible` | **PASS**<br>8 models: gpt-5.1, gpt-5.1-codex-max, gpt-5.1-codex-mini, gpt-5.2, gpt-5.2-codex, gpt-5.3-codex, gpt-5.3-codex-spark, gpt-5.4 | **PASS**<br>8 models: gpt-5.1, gpt-5.1-codex-max, gpt-5.1-codex-mini, gpt-5.2, gpt-5.2-codex, gpt-5.3-codex, gpt-5.3-codex-spark, gpt-5.4 | **PASS**<br>Model gpt-5.3-codex responded (2 chars). | **PASS**<br>CLI scenario succeeded with model gpt-5.3-codex. checklist: n8nac=yes, actions=list/list/validate/push/verify, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0 |
| `Claude (anthropic-proxy)` | `claude-haiku-4-5-20251001` | `native` | **PASS**<br>9 models: claude-3-haiku-20240307, claude-haiku-4-5-20251001, claude-opus-4-1-20250805, claude-opus-4-20250514, claude-opus-4-5-20251101, claude-opus-4-6, claude-sonnet-4-20250514, claude-sonnet-4-5-20250929 (+1 more) | **PASS**<br>9 models: claude-3-haiku-20240307, claude-haiku-4-5-20251001, claude-opus-4-1-20250805, claude-opus-4-20250514, claude-opus-4-5-20251101, claude-opus-4-6, claude-sonnet-4-20250514, claude-sonnet-4-5-20250929 (+1 more) | **PASS**<br>Model claude-haiku-4-5-20251001 responded (2 chars). | **PASS**<br>CLI scenario succeeded with model claude-haiku-4-5-20251001. checklist: n8nac=yes, actions=list/skills/push/verify/skills/push, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0 |
| `GitHub (copilot-proxy)` | `gpt-5.4` | `native` | **PASS**<br>41 models: claude-haiku-4.5, claude-opus-4.5, claude-opus-4.6, claude-opus-4.6-fast, claude-sonnet-4, claude-sonnet-4.5, claude-sonnet-4.6, gemini-2.5-pro (+33 more) | **PASS**<br>41 models: claude-haiku-4.5, claude-opus-4.5, claude-opus-4.6, claude-opus-4.6-fast, claude-sonnet-4, claude-sonnet-4.5, claude-sonnet-4.6, gemini-2.5-pro (+33 more) | **PASS**<br>Model gpt-5.4 responded (2 chars). | **PASS**<br>CLI scenario succeeded with model gpt-5.4. checklist: n8nac=yes, actions=list/skills/list/skills/skills/validate/push/verify, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0 |

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
- Advanced scenario: CLI scenario succeeded with model claude-haiku-4-5-20251001. checklist: n8nac=yes, actions=validate/push/verify/skills/skills, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

**Advanced Final Response**

```text
✅ Workflow créé et déployé avec succès.
**Détails:**
- Nom: `yagr-it-anthropic-1774977254522`
- Noeuds: Manual Trigger → Set (status="ok")
- URL: http://localhost:5678/workflow/lyBlztvqQQ9JIXOs
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
- Model listing: 126 models: babbage-002, chatgpt-image-latest, dall-e-2, dall-e-3, davinci-002, gpt-3.5-turbo, gpt-3.5-turbo-0125, gpt-3.5-turbo-1106 (+118 more)
- Inference: Model gpt-5-mini responded (2 chars).
- Advanced scenario: CLI scenario completed the workflow actions but did not emit a complete workflow banner embed (url + diagram). (log: /home/etienne/repos/yagr/reports/provider-advanced-logs/openai-2026-03-31T17-18-20-491Z.log) checklist: n8nac=yes, actions=list/skills/skills/list/skills/skills/skills/list/validate/push/verify, push=yes, verify=yes, embed=no, embedUrl=no, embedDiagram=no, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

### Gemini (google)

- Model: `gemini-3-flash-preview`
- Tooling level: `native`
- Setup: **PASS**
- Model listing: **PASS**
- Inference: **PASS**
- Advanced scenario: **PASS**

**Notes**

- Setup: API key detected in environment.
- Model listing: 29 models: gemini-2.0-flash, gemini-2.0-flash-001, gemini-2.0-flash-lite, gemini-2.0-flash-lite-001, gemini-2.5-computer-use-preview-10-2025, gemini-2.5-flash, gemini-2.5-flash-image, gemini-2.5-flash-lite (+21 more)
- Inference: Model gemini-3-flash-preview responded (2 chars).
- Advanced scenario: CLI scenario succeeded with model gemini-3-flash-preview. checklist: n8nac=yes, actions=push/verify, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

**Advanced Final Response**

```text
Le workflow **yagr-it-google-1774977504990** est prêt, enregistré et poussé. Il contient un Manual Trigger et un nœud Set configuré avec `status="ok"`.
URL du workflow : http://localhost:5678/workflow/JW3z9KyNpHL42hDP
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
- Model listing: 59 models: codestral-2508, codestral-embed, codestral-embed-2505, codestral-latest, devstral-2512, devstral-latest, devstral-medium-2507, devstral-medium-latest (+51 more)
- Inference: Model ministral-8b-latest responded (2 chars).
- Advanced scenario: CLI scenario succeeded with model ministral-8b-latest. checklist: n8nac=yes, actions=push/verify, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

**Advanced Final Response**

```text
Le workflow minimal demandé est prêt et disponible à l'adresse suivante :
[http://localhost:5678/workflow/mCtL0LRON9KQihIW](http://localhost:5678/workflow/mCtL0LRON9KQihIW)
Il contient bien :
- Un nœud **Manual Trigger**
- Un nœud **Set** définissant `status="ok"`
Le workflow est enregistré et poussé. Aucune étape supplémentaire n'est requise.
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
- Model listing: 348 models: ai21/jamba-large-1.7, aion-labs/aion-1.0, aion-labs/aion-1.0-mini, aion-labs/aion-2.0, aion-labs/aion-rp-llama-3.1-8b, alfredpros/codellama-7b-instruct-solidity, alibaba/tongyi-deepresearch-30b-a3b, allenai/olmo-2-0325-32b-instruct (+340 more)
- Inference: Model minimax/minimax-m2.7 responded (2 chars).
- Advanced scenario: CLI scenario succeeded with model minimax/minimax-m2.7. checklist: n8nac=yes, actions=skills/skills/skills/validate/push/verify, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

**Advanced Final Response**

```text
Le workflow a été créé et enregistré.
**Nom :** yagr-it-openrouter-1774977569558
**URL :** http://localhost:5678/workflow/9oL5rQtvz05miGLm
```

### OpenAI (openai-proxy)

- Model: `gpt-5.3-codex`
- Tooling level: `compatible`
- Setup: **PASS**
- Model listing: **PASS**
- Inference: **PASS**
- Advanced scenario: **PASS**

**Notes**

- Setup: 8 models: gpt-5.1, gpt-5.1-codex-max, gpt-5.1-codex-mini, gpt-5.2, gpt-5.2-codex, gpt-5.3-codex, gpt-5.3-codex-spark, gpt-5.4
- Model listing: 8 models: gpt-5.1, gpt-5.1-codex-max, gpt-5.1-codex-mini, gpt-5.2, gpt-5.2-codex, gpt-5.3-codex, gpt-5.3-codex-spark, gpt-5.4
- Inference: Model gpt-5.3-codex responded (2 chars).
- Advanced scenario: CLI scenario succeeded with model gpt-5.3-codex. checklist: n8nac=yes, actions=list/list/validate/push/verify, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

**Advanced Final Response**

```text
C’est fait ✅ Le workflow a été créé, enregistré et poussé avec succès.
- **Nom du workflow** : `yagr-it-openai-proxy-1774977664726-minimal-status`
- **URL** : http://localhost:5678/workflow/a0qX6bILo1O8JKPW
```

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
- Advanced scenario: CLI scenario succeeded with model claude-haiku-4-5-20251001. checklist: n8nac=yes, actions=list/skills/push/verify/skills/push, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

**Advanced Final Response**

```text
✅ Workflow créé et déployé avec succès.
**Workflow:** yagr-it-anthropic-proxy-1774977743893
**URL:** http://localhost:5678/workflow/clYkhahIjmCNaGjU
Le workflow minimal contient deux nœuds (Manual Trigger + Set avec status="ok"), a été enregistré et poussé.
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
- Advanced scenario: CLI scenario succeeded with model gpt-5.4. checklist: n8nac=yes, actions=list/skills/list/skills/skills/validate/push/verify, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

**Advanced Final Response**

```text
C’est fait.
Workflow créé, enregistré et poussé :
http://localhost:5678/workflow/DRhr2s8AdlhR7Ta5
Nom du workflow :
yagr-it-copilot-proxy-1774977819875-minimal-status
```

