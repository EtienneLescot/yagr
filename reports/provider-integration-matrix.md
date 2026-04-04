# Provider Integration Matrix

- Generated at: 2026-04-01T15:43:26.029Z
- Providers: `OpenAI (openai)`
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
| `OpenAI (openai)` | `gpt-5-mini` | `native` | **PASS**<br>API key detected in environment. | **PASS**<br>126 models: babbage-002, chatgpt-image-latest, dall-e-2, dall-e-3, davinci-002, gpt-3.5-turbo, gpt-3.5-turbo-0125, gpt-3.5-turbo-1106 (+118 more) | **PASS**<br>Model gpt-5-mini responded (2 chars). | **PASS**<br>CLI scenario succeeded with model gpt-5-mini. checklist: n8nac=yes, actions=skills/skills/list/validate/skills/skills/validate/push/verify/workflow/list, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=0, blockingActions=0, followUps=0 |

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
- Model listing: 126 models: babbage-002, chatgpt-image-latest, dall-e-2, dall-e-3, davinci-002, gpt-3.5-turbo, gpt-3.5-turbo-0125, gpt-3.5-turbo-1106 (+118 more)
- Inference: Model gpt-5-mini responded (2 chars).
- Advanced scenario: CLI scenario succeeded with model gpt-5-mini. checklist: n8nac=yes, actions=skills/skills/list/validate/skills/skills/validate/push/verify/workflow/list, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=0, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

**Advanced Final Response**

```text
Terminé — le workflow a été créé, enregistré, poussé et vérifié.
- Nom : yagr-it-openai-1775058027578-minimal
- URL : http://localhost:5678/workflow/NFkHiSw75GVI0wI1
- Fichier local : workflows/local_5678_etienne_l/personal/yagr-it-openai-1775058027578-minimal.workflow.ts
```

