# Provider Integration Matrix

- Generated at: 2026-03-25T15:14:40.382Z
- Providers: `OpenRouter (openrouter)`
- Timeouts: setup/model=60000ms, inference=75000ms
- Advanced scenario: enabled (timeout=180000ms)

## Summary

| Step | PASS | FAIL | SKIP |
| --- | ---: | ---: | ---: |
| setup | 1 | 0 | 0 |
| model-listing | 1 | 0 | 0 |
| inference | 1 | 0 | 0 |
| advanced-scenario | 1 | 0 | 0 |

## Provider Overview

| Provider | Model | Tooling | Setup | Model Listing | Inference | Advanced Scenario |
| --- | --- | --- | --- | --- | --- | --- |
| `OpenRouter (openrouter)` | `google/gemini-3-flash-preview` | `compatible` | **PASS**<br>API key detected in environment. | **PASS**<br>346 models: ai21/jamba-large-1.7, aion-labs/aion-1.0, aion-labs/aion-1.0-mini, aion-labs/aion-2.0, aion-labs/aion-rp-llama-3.1-8b, alfredpros/codellama-7b-instruct-solidity, alibaba/tongyi-deepresearch-30b-a3b, allenai/olmo-2-0325-32b-instruct (+338 more) | **PASS**<br>Model google/gemini-3-flash-preview responded (2 chars). | **PASS**<br>CLI scenario succeeded with model google/gemini-3-flash-preview. checklist: n8nac=yes, actions=push/verify, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0 |

## Detailed Results

### OpenRouter (openrouter)

- Model: `google/gemini-3-flash-preview`
- Tooling level: `compatible`
- Setup: **PASS**
- Model listing: **PASS**
- Inference: **PASS**
- Advanced scenario: **PASS**

**Notes**

- Setup: API key detected in environment.
- Model listing: 346 models: ai21/jamba-large-1.7, aion-labs/aion-1.0, aion-labs/aion-1.0-mini, aion-labs/aion-2.0, aion-labs/aion-rp-llama-3.1-8b, alfredpros/codellama-7b-instruct-solidity, alibaba/tongyi-deepresearch-30b-a3b, allenai/olmo-2-0325-32b-instruct (+338 more)
- Inference: Model google/gemini-3-flash-preview responded (2 chars).
- Advanced scenario: CLI scenario succeeded with model google/gemini-3-flash-preview. checklist: n8nac=yes, actions=push/verify, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

**Advanced Final Response**

```text
Le workflow a été créé, enregistré et poussé avec succès.
**Détails du workflow :**
- **Nom :** yagr-it-openrouter-1774451645097
- **Configuration :** Un nœud Manual Trigger relié à un nœud Set (status="ok").
- **URL :** http://localhost:5678/workflow/duKJDQiQyT6JDZkD
Le workflow est prêt à l'emploi.
```

