# Provider Integration Matrix

- Generated at: 2026-03-25T15:32:22.738Z
- Providers: `OpenRouter (openrouter)`
- Timeouts: setup/model=60000ms, inference=75000ms
- Advanced scenario: enabled (timeout=180000ms)

## Summary

| Step | PASS | FAIL | SKIP |
| --- | ---: | ---: | ---: |
| setup | 1 | 0 | 0 |
| model-listing | 1 | 0 | 0 |
| inference | 1 | 0 | 0 |
| advanced-scenario | 0 | 1 | 0 |

## Provider Overview

| Provider | Model | Tooling | Setup | Model Listing | Inference | Advanced Scenario |
| --- | --- | --- | --- | --- | --- | --- |
| `OpenRouter (openrouter)` | `z-ai/glm-5` | `compatible` | **PASS**<br>API key detected in environment. | **PASS**<br>346 models: ai21/jamba-large-1.7, aion-labs/aion-1.0, aion-labs/aion-1.0-mini, aion-labs/aion-2.0, aion-labs/aion-rp-llama-3.1-8b, alfredpros/codellama-7b-instruct-solidity, alibaba/tongyi-deepresearch-30b-a3b, allenai/olmo-2-0325-32b-instruct (+338 more) | **PASS**<br>Model z-ai/glm-5 responded (2 chars). | **FAIL**<br>CLI scenario created a local workflow file but did not push it to the remote n8n instance: [tool:reportProgress] status: Vérification de l'initialisation du workspace et récupération des schémas de noeuds... [tool:n8nac] status: Runtime cwd=. envHost=http://localhost:5678 envApiKey=present configHost=http://l… (log: /home/etienne/repos/yagr/reports/provider-advanced-logs/openrouter-2026-03-25T15-32-21-587Z.log) checklist: n8nac=yes, actions=skills/skills/skills/list/skills/skills, push=no, verify=no, embed=no, embedUrl=no, embedDiagram=no, workflowFile=yes, remoteCreated=0, blockingActions=0, followUps=0 |

## Detailed Results

### OpenRouter (openrouter)

- Model: `z-ai/glm-5`
- Tooling level: `compatible`
- Setup: **PASS**
- Model listing: **PASS**
- Inference: **PASS**
- Advanced scenario: **FAIL**

**Notes**

- Setup: API key detected in environment.
- Model listing: 346 models: ai21/jamba-large-1.7, aion-labs/aion-1.0, aion-labs/aion-1.0-mini, aion-labs/aion-2.0, aion-labs/aion-rp-llama-3.1-8b, alfredpros/codellama-7b-instruct-solidity, alibaba/tongyi-deepresearch-30b-a3b, allenai/olmo-2-0325-32b-instruct (+338 more)
- Inference: Model z-ai/glm-5 responded (2 chars).
- Advanced scenario: CLI scenario created a local workflow file but did not push it to the remote n8n instance: [tool:reportProgress] status: Vérification de l'initialisation du workspace et récupération des schémas de noeuds... [tool:n8nac] status: Runtime cwd=. envHost=http://localhost:5678 envApiKey=present configHost=http://l… (log: /home/etienne/repos/yagr/reports/provider-advanced-logs/openrouter-2026-03-25T15-32-21-587Z.log) checklist: n8nac=yes, actions=skills/skills/skills/list/skills/skills, push=no, verify=no, embed=no, embedUrl=no, embedDiagram=no, workflowFile=yes, remoteCreated=0, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

