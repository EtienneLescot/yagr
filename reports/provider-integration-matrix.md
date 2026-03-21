# Provider Integration Matrix

- Generated at: 2026-03-21T15:44:10.082Z
- Providers: `Claude API (anthropic)`, `Claude Token (anthropic-proxy)`, `OpenAI OAuth (openai-proxy)`
- Timeouts: setup/model=60000ms, inference=75000ms
- Advanced scenario: disabled

## Summary

| Step | PASS | FAIL | SKIP |
| --- | ---: | ---: | ---: |
| setup | 3 | 0 | 0 |
| model-listing | 3 | 0 | 0 |
| inference | 3 | 0 | 0 |

## Details

| Provider | Setup | Model Listing | Inference |
| --- | --- | --- | --- |
| `Claude API (anthropic)` | **PASS**<br>API key detected in environment. | **PASS**<br>9 models: claude-3-haiku-20240307, claude-haiku-4-5-20251001, claude-opus-4-1-20250805, claude-opus-4-20250514, claude-opus-4-5-20251101, claude-opus-4-6, claude-sonnet-4-20250514, claude-sonnet-4-5-20250929 (+1 more) | **PASS**<br>Model claude-3-haiku-20240307 responded (2 chars). |
| `Claude Token (anthropic-proxy)` | **PASS**<br>9 models: claude-3-haiku-20240307, claude-haiku-4-5-20251001, claude-opus-4-1-20250805, claude-opus-4-20250514, claude-opus-4-5-20251101, claude-opus-4-6, claude-sonnet-4-20250514, claude-sonnet-4-5-20250929 (+1 more) | **PASS**<br>9 models: claude-3-haiku-20240307, claude-haiku-4-5-20251001, claude-opus-4-1-20250805, claude-opus-4-20250514, claude-opus-4-5-20251101, claude-opus-4-6, claude-sonnet-4-20250514, claude-sonnet-4-5-20250929 (+1 more) | **PASS**<br>Model claude-3-haiku-20240307 responded (2 chars). |
| `OpenAI OAuth (openai-proxy)` | **PASS**<br>8 models: gpt-5.1, gpt-5.1-codex-max, gpt-5.1-codex-mini, gpt-5.2, gpt-5.2-codex, gpt-5.3-codex, gpt-5.3-codex-spark, gpt-5.4 | **PASS**<br>8 models: gpt-5.1, gpt-5.1-codex-max, gpt-5.1-codex-mini, gpt-5.2, gpt-5.2-codex, gpt-5.3-codex, gpt-5.3-codex-spark, gpt-5.4 | **PASS**<br>Model gpt-5.1-codex-mini responded (2 chars). |
