# Provider Integration Matrix

- Generated at: 2026-03-25T15:42:49.446Z
- Providers: `OpenAI (openai)`, `Claude (anthropic)`, `Gemini (google)`, `Mistral (mistral)`, `OpenRouter (openrouter)`
- Timeouts: setup/model=60000ms, inference=75000ms
- Advanced scenario: enabled (timeout=180000ms)

## Summary

| Step | PASS | FAIL | SKIP |
| --- | ---: | ---: | ---: |
| setup | 5 | 0 | 0 |
| model-listing | 5 | 0 | 0 |
| inference | 5 | 0 | 0 |
| advanced-scenario | 5 | 0 | 0 |

## Provider Overview

| Provider | Model | Tooling | Setup | Model Listing | Inference | Advanced Scenario |
| --- | --- | --- | --- | --- | --- | --- |
| `OpenAI (openai)` | `gpt-5-mini` | `native` | **PASS**<br>API key detected in environment. | **PASS**<br>129 models: babbage-002, chatgpt-image-latest, dall-e-2, dall-e-3, davinci-002, gpt-3.5-turbo, gpt-3.5-turbo-0125, gpt-3.5-turbo-1106 (+121 more) | **PASS**<br>Model gpt-5-mini responded (2 chars). | **PASS**<br>CLI scenario succeeded with model gpt-5-mini. checklist: n8nac=yes, actions=skills/list/skills/validate/push/verify, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0 |
| `Claude (anthropic)` | `claude-haiku-4-5-20251001` | `native` | **PASS**<br>API key detected in environment. | **PASS**<br>9 models: claude-3-haiku-20240307, claude-haiku-4-5-20251001, claude-opus-4-1-20250805, claude-opus-4-20250514, claude-opus-4-5-20251101, claude-opus-4-6, claude-sonnet-4-20250514, claude-sonnet-4-5-20250929 (+1 more) | **PASS**<br>Model claude-haiku-4-5-20251001 responded (2 chars). | **PASS**<br>CLI scenario succeeded with model claude-haiku-4-5-20251001. checklist: n8nac=yes, actions=validate/validate/push/verify/validate, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0 |
| `Gemini (google)` | `gemini-3-flash-preview` | `native` | **PASS**<br>API key detected in environment. | **PASS**<br>28 models: gemini-2.0-flash, gemini-2.0-flash-001, gemini-2.0-flash-lite, gemini-2.0-flash-lite-001, gemini-2.5-computer-use-preview-10-2025, gemini-2.5-flash, gemini-2.5-flash-image, gemini-2.5-flash-lite (+20 more) | **PASS**<br>Model gemini-3-flash-preview responded (2 chars). | **PASS**<br>CLI scenario succeeded with model gemini-3-flash-preview. checklist: n8nac=yes, actions=list/skills/skills/push/verify, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0 |
| `Mistral (mistral)` | `ministral-8b-latest` | `compatible` | **PASS**<br>API key detected in environment. | **PASS**<br>62 models: codestral-2508, codestral-embed, codestral-embed-2505, codestral-latest, devstral-2512, devstral-latest, devstral-medium-2507, devstral-medium-latest (+54 more) | **PASS**<br>Model ministral-8b-latest responded (2 chars). | **PASS**<br>CLI scenario succeeded with model ministral-8b-latest. checklist: n8nac=yes, actions=push/verify, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0 |
| `OpenRouter (openrouter)` | `minimax/minimax-m2.7` | `compatible` | **PASS**<br>API key detected in environment. | **PASS**<br>346 models: ai21/jamba-large-1.7, aion-labs/aion-1.0, aion-labs/aion-1.0-mini, aion-labs/aion-2.0, aion-labs/aion-rp-llama-3.1-8b, alfredpros/codellama-7b-instruct-solidity, alibaba/tongyi-deepresearch-30b-a3b, allenai/olmo-2-0325-32b-instruct (+338 more) | **PASS**<br>Model minimax/minimax-m2.7 responded (2 chars). | **PASS**<br>CLI scenario succeeded with model minimax/minimax-m2.7. checklist: n8nac=yes, actions=validate/push/verify, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=2, blockingActions=0, followUps=0 |

## Detailed Results

### OpenAI (openai)

- Model: `gpt-5-mini`
- Tooling level: `native`
- Setup: **PASS**
- Model listing: **PASS**
- Inference: **PASS**
- Advanced scenario: **PASS**

**Notes**

- Setup: API key detected in environment.
- Model listing: 129 models: babbage-002, chatgpt-image-latest, dall-e-2, dall-e-3, davinci-002, gpt-3.5-turbo, gpt-3.5-turbo-0125, gpt-3.5-turbo-1106 (+121 more)
- Inference: Model gpt-5-mini responded (2 chars).
- Advanced scenario: CLI scenario succeeded with model gpt-5-mini. checklist: n8nac=yes, actions=skills/list/skills/validate/push/verify, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

**Advanced Final Response**

```text
Le workflow a été créé, enregistré, poussé et vérifié.
- Nom / titre : yagr-it-openai-1774452995465-1700848200000
- URL : http://localhost:5678/workflow/nxfwc7n2Q6JyEWMk
- Fichier écrit : workflows/local_5678_etienne_l/personal/yagr-it-openai-1774452995465-1700848200000.workflow.ts
Le workflow est prêt.
```

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
- Advanced scenario: CLI scenario succeeded with model claude-haiku-4-5-20251001. checklist: n8nac=yes, actions=validate/validate/push/verify/validate, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

**Advanced Final Response**

```text
✅ Workflow créé et déployé avec succès.
**Détails:**
- Nom: `yagr-it-anthropic-1774453139309`
- Noeuds: Manual Trigger → Set (status="ok")
- URL: http://localhost:5678/workflow/rx6ymiih7RVpkidQ
Le workflow est enregistré et poussé. Prêt à l'emploi.
```

### Gemini (google)

- Model: `gemini-3-flash-preview`
- Tooling level: `native`
- Setup: **PASS**
- Model listing: **PASS**
- Inference: **PASS**
- Advanced scenario: **PASS**

**Notes**

- Setup: API key detected in environment.
- Model listing: 28 models: gemini-2.0-flash, gemini-2.0-flash-001, gemini-2.0-flash-lite, gemini-2.0-flash-lite-001, gemini-2.5-computer-use-preview-10-2025, gemini-2.5-flash, gemini-2.5-flash-image, gemini-2.5-flash-lite (+20 more)
- Inference: Model gemini-3-flash-preview responded (2 chars).
- Advanced scenario: CLI scenario succeeded with model gemini-3-flash-preview. checklist: n8nac=yes, actions=list/skills/skills/push/verify, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

**Advanced Final Response**

```text
Le workflow est prêt. Il a été créé sous le nom `yagr-it-google-1774453201480-minimal`, enregistré et poussé.
Vous pouvez y accéder ici : http://localhost:5678/workflow/mvqnvwR9lZfhRdDJ
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
- Advanced scenario: CLI scenario succeeded with model ministral-8b-latest. checklist: n8nac=yes, actions=push/verify, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

**Advanced Final Response**

```text
Le workflow minimal demandé est prêt et disponible à l'adresse suivante :
[Accéder au workflow](http://localhost:5678/workflow/totJyH6lf5lRnLbg)
Il contient bien :
- Un **Manual Trigger** en premier nœud.
- Un **Set** en second nœud définissant `status="ok"`.
Le workflow est enregistré et poussé sans erreur. Aucune étape supplémentaire n'est nécessaire.
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
- Model listing: 346 models: ai21/jamba-large-1.7, aion-labs/aion-1.0, aion-labs/aion-1.0-mini, aion-labs/aion-2.0, aion-labs/aion-rp-llama-3.1-8b, alfredpros/codellama-7b-instruct-solidity, alibaba/tongyi-deepresearch-30b-a3b, allenai/olmo-2-0325-32b-instruct (+338 more)
- Inference: Model minimax/minimax-m2.7 responded (2 chars).
- Advanced scenario: CLI scenario succeeded with model minimax/minimax-m2.7. checklist: n8nac=yes, actions=validate/push/verify, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=2, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

**Advanced Final Response**

```text
Workflow créé et enregistré : http://localhost:5678/workflow/Hf9z8Q4CHaTZl1ul
```

