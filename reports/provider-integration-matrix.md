# Provider Integration Matrix

- Generated at: 2026-03-21T13:19:05.055Z
- Providers: `anthropic`, `anthropic-proxy`
- Timeouts: setup/model=60000ms, inference=75000ms
- Advanced scenario: disabled

## Summary

| Step | PASS | FAIL | SKIP |
| --- | ---: | ---: | ---: |
| setup | 2 | 0 | 0 |
| model-listing | 2 | 0 | 0 |
| inference | 2 | 0 | 0 |

## Details

| Provider | Setup | Model Listing | Inference |
| --- | --- | --- | --- |
| `anthropic` | **PASS**<br>API key detected in environment. | **PASS**<br>9 models: claude-3-haiku-20240307, claude-haiku-4-5-20251001, claude-opus-4-1-20250805, claude-opus-4-20250514, claude-opus-4-5-20251101, claude-opus-4-6, claude-sonnet-4-20250514, claude-sonnet-4-5-20250929 (+1 more) | **PASS**<br>Model claude-3-haiku-20240307 responded (2 chars). |
| `anthropic-proxy` | **PASS**<br>9 models: claude-3-haiku-20240307, claude-haiku-4-5-20251001, claude-opus-4-1-20250805, claude-opus-4-20250514, claude-opus-4-5-20251101, claude-opus-4-6, claude-sonnet-4-20250514, claude-sonnet-4-5-20250929 (+1 more) | **PASS**<br>9 models: claude-3-haiku-20240307, claude-haiku-4-5-20251001, claude-opus-4-1-20250805, claude-opus-4-20250514, claude-opus-4-5-20251101, claude-opus-4-6, claude-sonnet-4-20250514, claude-sonnet-4-5-20250929 (+1 more) | **PASS**<br>Model claude-3-haiku-20240307 responded (2 chars). |
