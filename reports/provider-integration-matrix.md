# Provider Integration Matrix

- Generated at: 2026-03-21T13:37:34.888Z
- Providers: `copilot-proxy`
- Timeouts: setup/model=60000ms, inference=75000ms
- Advanced scenario: enabled (timeout=120000ms)

## Summary

| Step | PASS | FAIL | SKIP |
| --- | ---: | ---: | ---: |
| setup | 1 | 0 | 0 |
| model-listing | 1 | 0 | 0 |
| inference | 1 | 0 | 0 |
| advanced-scenario | 1 | 0 | 0 |

## Details

| Provider | Setup | Model Listing | Inference | Advanced Scenario |
| --- | --- | --- | --- | --- |
| `copilot-proxy` | **PASS**<br>41 models: claude-haiku-4.5, claude-opus-4.5, claude-opus-4.6, claude-opus-4.6-fast, claude-sonnet-4, claude-sonnet-4.5, claude-sonnet-4.6, gemini-2.5-pro (+33 more) | **PASS**<br>41 models: claude-haiku-4.5, claude-opus-4.5, claude-opus-4.6, claude-opus-4.6-fast, claude-sonnet-4, claude-sonnet-4.5, claude-sonnet-4.6, gemini-2.5-pro (+33 more) | **PASS**<br>Model gpt-4.1 responded (2 chars). | **PASS**<br>CLI scenario succeeded with model gpt-4.1. |
