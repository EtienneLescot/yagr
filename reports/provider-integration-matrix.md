# Provider Integration Matrix

- Generated at: 2026-03-24T19:47:38.364Z
- Providers: `Gemini (google)`
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
| `Gemini (google)` | `gemini-3-flash-preview` | `native` | **PASS**<br>API key detected in environment. | **PASS**<br>28 models: gemini-2.0-flash, gemini-2.0-flash-001, gemini-2.0-flash-lite, gemini-2.0-flash-lite-001, gemini-2.5-computer-use-preview-10-2025, gemini-2.5-flash, gemini-2.5-flash-image, gemini-2.5-flash-lite (+20 more) | **PASS**<br>Model gemini-3-flash-preview responded (2 chars). | **FAIL**<br>CLI scenario exited cleanly but created or modified no .workflow.ts file in /tmp/yagr-provider-advanced/google-uCycwV/n8n-workspace/workflows/local_5678_etienne_l/personal: Le workflow n'a pas pu être créé ni enregistré. Aucune modification n'a été apportée au système. [tool:reportProgress] status: Checking workspace initialization... [tool:reportProgress] status: Searching for Manual Trig… (log: /home/etienne/repos/yagr/reports/provider-advanced-logs/google-2026-03-24T19-47-37-521Z.log) checklist: n8nac=no, actions=none, push=no, verify=no, embed=no, embedUrl=no, embedDiagram=no, workflowFile=no, remoteCreated=0, blockingActions=0, followUps=0 |

## Detailed Results

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
- Advanced scenario: CLI scenario exited cleanly but created or modified no .workflow.ts file in /tmp/yagr-provider-advanced/google-uCycwV/n8n-workspace/workflows/local_5678_etienne_l/personal: Le workflow n'a pas pu être créé ni enregistré. Aucune modification n'a été apportée au système. [tool:reportProgress] status: Checking workspace initialization... [tool:reportProgress] status: Searching for Manual Trig… (log: /home/etienne/repos/yagr/reports/provider-advanced-logs/google-2026-03-24T19-47-37-521Z.log) checklist: n8nac=no, actions=none, push=no, verify=no, embed=no, embedUrl=no, embedDiagram=no, workflowFile=no, remoteCreated=0, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

**Advanced Final Response**

```text
Le workflow n'a pas pu être créé ni enregistré. Aucune modification n'a été apportée au système.
```

