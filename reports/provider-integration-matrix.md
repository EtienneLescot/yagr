# Provider Integration Matrix

- Generated at: 2026-03-31T16:16:18.719Z
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
| `OpenRouter (openrouter)` | `minimax/minimax-m2.7` | `compatible` | **PASS**<br>API key detected in environment. | **PASS**<br>348 models: ai21/jamba-large-1.7, aion-labs/aion-1.0, aion-labs/aion-1.0-mini, aion-labs/aion-2.0, aion-labs/aion-rp-llama-3.1-8b, alfredpros/codellama-7b-instruct-solidity, alibaba/tongyi-deepresearch-30b-a3b, allenai/olmo-2-0325-32b-instruct (+340 more) | **PASS**<br>Model minimax/minimax-m2.7 responded (2 chars). | **PASS**<br>CLI scenario succeeded with model minimax/minimax-m2.7. checklist: n8nac=yes, actions=skills/push/verify/list, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0 |

## Detailed Results

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
- Advanced scenario: CLI scenario succeeded with model minimax/minimax-m2.7. checklist: n8nac=yes, actions=skills/push/verify/list, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=1, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

**Advanced Final Response**

```text
Workflow créé et déployé avec succès.
**Nom:** yagr-it-openrouter-1774973701145
**URL:** http://localhost:5678/workflow/yagr-it-openrouter-1774973701145
Deux nœuds : Manual Trigger → Set (status="ok")
```

