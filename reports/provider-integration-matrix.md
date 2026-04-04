# Provider Integration Matrix

- Generated at: 2026-04-01T16:03:42.685Z
- Providers: `Claude (anthropic)`, `OpenAI (openai)`, `Gemini (google)`, `Mistral (mistral)`, `OpenRouter (openrouter)`, `OpenAI (openai-proxy)`, `Claude (anthropic-proxy)`, `GitHub (copilot-proxy)`
- Timeouts: setup/model=60000ms, inference=75000ms
- Advanced scenario: enabled (timeout=180000ms)

## Summary

| Step | PASS | FAIL | SKIP |
| --- | ---: | ---: | ---: |
| setup | 8 | 0 | 0 |
| model-listing | 8 | 0 | 0 |
| inference | 8 | 0 | 0 |
| advanced-scenario | 8 | 0 | 0 |

## Provider Overview

| Provider | Model | Tooling | Setup | Model Listing | Inference | Advanced Scenario |
| --- | --- | --- | --- | --- | --- | --- |
| `Claude (anthropic)` | `claude-haiku-4-5-20251001` | `native` | **PASS**<br>API key detected in environment. | **PASS**<br>9 models: claude-3-haiku-20240307, claude-haiku-4-5-20251001, claude-opus-4-1-20250805, claude-opus-4-20250514, claude-opus-4-5-20251101, claude-opus-4-6, claude-sonnet-4-20250514, claude-sonnet-4-5-20250929 (+1 more) | **PASS**<br>Model claude-haiku-4-5-20251001 responded (2 chars). | **PASS**<br>CLI scenario succeeded with model claude-haiku-4-5-20251001. checklist: n8nac=yes, actions=push/verify/validate/push, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=0, blockingActions=0, followUps=0 |
| `OpenAI (openai)` | `gpt-5-mini` | `native` | **PASS**<br>API key detected in environment. | **PASS**<br>126 models: babbage-002, chatgpt-image-latest, dall-e-2, dall-e-3, davinci-002, gpt-3.5-turbo, gpt-3.5-turbo-0125, gpt-3.5-turbo-1106 (+118 more) | **PASS**<br>Model gpt-5-mini responded (2 chars). | **PASS**<br>CLI scenario succeeded with model gpt-5-mini. checklist: n8nac=yes, actions=instance/skills/list/skills/skills/skills/list/push/verify/list, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=0, blockingActions=0, followUps=0 |
| `Gemini (google)` | `gemini-3-flash-preview` | `native` | **PASS**<br>API key detected in environment. | **PASS**<br>29 models: gemini-2.0-flash, gemini-2.0-flash-001, gemini-2.0-flash-lite, gemini-2.0-flash-lite-001, gemini-2.5-computer-use-preview-10-2025, gemini-2.5-flash, gemini-2.5-flash-image, gemini-2.5-flash-lite (+21 more) | **PASS**<br>Model gemini-3-flash-preview responded (2 chars). | **PASS**<br>CLI scenario succeeded with model gemini-3-flash-preview. checklist: n8nac=yes, actions=list/instance/push/verify/list, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=0, blockingActions=0, followUps=0 |
| `Mistral (mistral)` | `ministral-8b-latest` | `compatible` | **PASS**<br>API key detected in environment. | **PASS**<br>59 models: codestral-2508, codestral-embed, codestral-embed-2505, codestral-latest, devstral-2512, devstral-latest, devstral-medium-2507, devstral-medium-latest (+51 more) | **PASS**<br>Model ministral-8b-latest responded (2 chars). | **PASS**<br>CLI scenario succeeded with model ministral-8b-latest. checklist: n8nac=yes, actions=list/instance/list/push/verify, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=0, blockingActions=0, followUps=0 |
| `OpenRouter (openrouter)` | `minimax/minimax-m2.7` | `compatible` | **PASS**<br>API key detected in environment. | **PASS**<br>349 models: ai21/jamba-large-1.7, aion-labs/aion-1.0, aion-labs/aion-1.0-mini, aion-labs/aion-2.0, aion-labs/aion-rp-llama-3.1-8b, alfredpros/codellama-7b-instruct-solidity, alibaba/tongyi-deepresearch-30b-a3b, allenai/olmo-2-0325-32b-instruct (+341 more) | **PASS**<br>Model minimax/minimax-m2.7 responded (2 chars). | **PASS**<br>CLI scenario succeeded with model minimax/minimax-m2.7. checklist: n8nac=yes, actions=list/instance/list/push/verify, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=0, blockingActions=0, followUps=0 |
| `OpenAI (openai-proxy)` | `gpt-5.3-codex` | `compatible` | **PASS**<br>8 models: gpt-5.1, gpt-5.1-codex-max, gpt-5.1-codex-mini, gpt-5.2, gpt-5.2-codex, gpt-5.3-codex, gpt-5.3-codex-spark, gpt-5.4 | **PASS**<br>8 models: gpt-5.1, gpt-5.1-codex-max, gpt-5.1-codex-mini, gpt-5.2, gpt-5.2-codex, gpt-5.3-codex, gpt-5.3-codex-spark, gpt-5.4 | **PASS**<br>Model gpt-5.3-codex responded (2 chars). | **PASS**<br>CLI scenario succeeded with model gpt-5.3-codex. checklist: n8nac=yes, actions=list/list/validate/push/verify, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=0, blockingActions=0, followUps=0 |
| `Claude (anthropic-proxy)` | `claude-haiku-4-5-20251001` | `native` | **PASS**<br>9 models: claude-3-haiku-20240307, claude-haiku-4-5-20251001, claude-opus-4-1-20250805, claude-opus-4-20250514, claude-opus-4-5-20251101, claude-opus-4-6, claude-sonnet-4-20250514, claude-sonnet-4-5-20250929 (+1 more) | **PASS**<br>9 models: claude-3-haiku-20240307, claude-haiku-4-5-20251001, claude-opus-4-1-20250805, claude-opus-4-20250514, claude-opus-4-5-20251101, claude-opus-4-6, claude-sonnet-4-20250514, claude-sonnet-4-5-20250929 (+1 more) | **PASS**<br>Model claude-haiku-4-5-20251001 responded (2 chars). | **PASS**<br>CLI scenario succeeded with model claude-haiku-4-5-20251001. checklist: n8nac=yes, actions=push/verify/validate/validate, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=0, blockingActions=0, followUps=0 |
| `GitHub (copilot-proxy)` | `gpt-5.4` | `native` | **PASS**<br>41 models: claude-haiku-4.5, claude-opus-4.5, claude-opus-4.6, claude-opus-4.6-fast, claude-sonnet-4, claude-sonnet-4.5, claude-sonnet-4.6, gemini-2.5-pro (+33 more) | **PASS**<br>41 models: claude-haiku-4.5, claude-opus-4.5, claude-opus-4.6, claude-opus-4.6-fast, claude-sonnet-4, claude-sonnet-4.5, claude-sonnet-4.6, gemini-2.5-pro (+33 more) | **PASS**<br>Model gpt-5.4 responded (2 chars). | **PASS**<br>CLI scenario succeeded with model gpt-5.4. checklist: n8nac=yes, actions=skills/skills/validate/push/verify/list, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=0, blockingActions=0, followUps=0 |

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
- Advanced scenario: CLI scenario succeeded with model claude-haiku-4-5-20251001. checklist: n8nac=yes, actions=push/verify/validate/push, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=0, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

**Advanced Final Response**

```text
✅ Workflow créé et déployé avec succès.
**Détails:**
- Nom: `yagr-it-anthropic-1775058756001`
- Composition: Manual Trigger → Set (status="ok")
- URL: http://localhost:5678/workflow/zfBlkvGiNREQoJSM
- Statut: Enregistré et poussé
Le workflow est prêt à l'emploi.
```

### OpenAI (openai)

- Model: `gpt-5-mini`
- Tooling level: `native`
- Setup: **PASS**
- Model listing: **PASS**
- Inference: **PASS**
- Advanced scenario: **PASS**

**Notes**

- Setup: API key detected in environment.
- Model listing: 126 models: babbage-002, chatgpt-image-latest, dall-e-2, dall-e-3, davinci-002, gpt-3.5-turbo, gpt-3.5-turbo-0125, gpt-3.5-turbo-1106 (+118 more)
- Inference: Model gpt-5-mini responded (2 chars).
- Advanced scenario: CLI scenario succeeded with model gpt-5-mini. checklist: n8nac=yes, actions=instance/skills/list/skills/skills/skills/list/push/verify/list, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=0, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

**Advanced Final Response**

```text
Le workflow a été créé, enregistré, poussé et vérifié avec succès.
- Nom/ID : yagr-it-openai-1775058818331-minimal
- URL : http://localhost:5678/workflow/qM6F3R8mXXraoREZ
- Fichier enregistré : workflows/local_5678_etienne_l/personal/yagr-it-openai-1775058818331-minimal.workflow.ts
Il est prêt.
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
- Model listing: 29 models: gemini-2.0-flash, gemini-2.0-flash-001, gemini-2.0-flash-lite, gemini-2.0-flash-lite-001, gemini-2.5-computer-use-preview-10-2025, gemini-2.5-flash, gemini-2.5-flash-image, gemini-2.5-flash-lite (+21 more)
- Inference: Model gemini-3-flash-preview responded (2 chars).
- Advanced scenario: CLI scenario succeeded with model gemini-3-flash-preview. checklist: n8nac=yes, actions=list/instance/push/verify/list, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=0, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

**Advanced Final Response**

```text
Le workflow est prêt et a été enregistré puis poussé.
**Nom :** yagr-it-google-1775058965213-minimal
**URL :** http://localhost:5678/workflow/WdWiboSetzJ1Ivv2
Il contient un nœud **Manual Trigger** relié à un nœud **Set** définissant `status="ok"`.
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
- Advanced scenario: CLI scenario succeeded with model ministral-8b-latest. checklist: n8nac=yes, actions=list/instance/list/push/verify, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=0, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

**Advanced Final Response**

```text
Le workflow est prêt et enregistré avec succès.
Vous pouvez le consulter ici :
[http://localhost:5678/workflow/ooaM2FPM8SC5Nlqt](http://localhost:5678/workflow/ooaM2FPM8SC5Nlqt)
Nom du workflow : `yagr-it-mistral-1775059026586-manual-trigger-set`
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
- Model listing: 349 models: ai21/jamba-large-1.7, aion-labs/aion-1.0, aion-labs/aion-1.0-mini, aion-labs/aion-2.0, aion-labs/aion-rp-llama-3.1-8b, alfredpros/codellama-7b-instruct-solidity, alibaba/tongyi-deepresearch-30b-a3b, allenai/olmo-2-0325-32b-instruct (+341 more)
- Inference: Model minimax/minimax-m2.7 responded (2 chars).
- Advanced scenario: CLI scenario succeeded with model minimax/minimax-m2.7. checklist: n8nac=yes, actions=list/instance/list/push/verify, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=0, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

**Advanced Final Response**

```text
Workflow créé et poussé avec succès.
**Nom:** yagr-it-openrouter-1775059066411
**URL:** http://localhost:5678/workflow/nvPqpbqo8Vj6N8BO
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
- Advanced scenario: CLI scenario succeeded with model gpt-5.3-codex. checklist: n8nac=yes, actions=list/list/validate/push/verify, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=0, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

**Advanced Final Response**

```text
C’est fait : le workflow a bien été créé, enregistré et poussé.
Nom du workflow : **yagr-it-openai-proxy-1775059140669-1775059140669**
URL : **http://localhost:5678/workflow/9WQo4O5uVuSjLw0j**
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
- Advanced scenario: CLI scenario succeeded with model claude-haiku-4-5-20251001. checklist: n8nac=yes, actions=push/verify/validate/validate, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=0, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

**Advanced Final Response**

```text
✅ Workflow créé et déployé avec succès.
**Détails:**
- **Nom:** yagr-it-anthropic-proxy-1775059228491
- **Noeuds:** Manual Trigger → Set (status="ok")
- **URL:** http://localhost:5678/workflow/N4mXZGMBty2IV71Y
- **Statut:** Enregistré et poussé
Le workflow est prêt à l'emploi.
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
- Advanced scenario: CLI scenario succeeded with model gpt-5.4. checklist: n8nac=yes, actions=skills/skills/validate/push/verify/list, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=0, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

**Advanced Final Response**

```text
C’est fait.
Workflow créé, enregistré et poussé :
- Nom : `yagr-it-copilot-proxy-1775059279981-minimal-20260401-0001`
- URL : http://localhost:5678/workflow/Ty7Z1csWka0wvsqq
La vérification a bien été confirmée.
```

