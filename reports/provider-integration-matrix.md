# Provider Integration Matrix

- Generated at: 2026-04-01T13:20:19.449Z
- Providers: `Claude (anthropic)`
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
| `Claude (anthropic)` | `claude-haiku-4-5-20251001` | `native` | **PASS**<br>API key detected in environment. | **PASS**<br>9 models: claude-3-haiku-20240307, claude-haiku-4-5-20251001, claude-opus-4-1-20250805, claude-opus-4-20250514, claude-opus-4-5-20251101, claude-opus-4-6, claude-sonnet-4-20250514, claude-sonnet-4-5-20250929 (+1 more) | **PASS**<br>Model claude-haiku-4-5-20251001 responded (2 chars). | **FAIL**<br>Invalid authentication credentials (log: /home/etienne/repos/yagr/reports/provider-advanced-logs/anthropic-2026-04-01T13-20-18-684Z.log) checklist: n8nac=no, actions=none, push=no, verify=no, embed=no, embedUrl=no, embedDiagram=no, workflowFile=no, remoteCreated=0, blockingActions=0, followUps=0 |

## Detailed Results

### Claude (anthropic)

- Model: `claude-haiku-4-5-20251001`
- Tooling level: `native`
- Setup: **PASS**
- Model listing: **PASS**
- Inference: **PASS**
- Advanced scenario: **FAIL**

**Notes**

- Setup: API key detected in environment.
- Model listing: 9 models: claude-3-haiku-20240307, claude-haiku-4-5-20251001, claude-opus-4-1-20250805, claude-opus-4-20250514, claude-opus-4-5-20251101, claude-opus-4-6, claude-sonnet-4-20250514, claude-sonnet-4-5-20250929 (+1 more)
- Inference: Model claude-haiku-4-5-20251001 responded (2 chars).
- Advanced scenario: Invalid authentication credentials (log: /home/etienne/repos/yagr/reports/provider-advanced-logs/anthropic-2026-04-01T13-20-18-684Z.log) checklist: n8nac=no, actions=none, push=no, verify=no, embed=no, embedUrl=no, embedDiagram=no, workflowFile=no, remoteCreated=0, blockingActions=0, followUps=0
- Advanced blocking actions: none
- Advanced follow-ups: none

