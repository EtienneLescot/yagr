# Provider Integration Matrix

- Generated at: 2026-03-21T19:02:13.500Z
- Providers: `Claude (anthropic)`, `OpenAI (openai)`, `Gemini (google)`, `Groq (groq)`, `Mistral (mistral)`, `OpenRouter (openrouter)`, `OpenAI (openai-proxy)`, `Claude (anthropic-proxy)`, `Gemini (google-proxy)`, `GitHub (copilot-proxy)`
- Timeouts: setup/model=60000ms, inference=75000ms
- Advanced scenario: disabled

## Summary

| Step | PASS | FAIL | SKIP |
| --- | ---: | ---: | ---: |
| setup | 9 | 0 | 1 |
| model-listing | 9 | 0 | 1 |
| inference | 9 | 0 | 1 |

## Details

| Provider | Setup | Model Listing | Inference |
| --- | --- | --- | --- |
| `Claude (anthropic)` | **PASS**<br>API key detected in environment. | **PASS**<br>9 models: claude-3-haiku-20240307, claude-haiku-4-5-20251001, claude-opus-4-1-20250805, claude-opus-4-20250514, claude-opus-4-5-20251101, claude-opus-4-6, claude-sonnet-4-20250514, claude-sonnet-4-5-20250929 (+1 more) | **PASS**<br>Model claude-3-haiku-20240307 responded (2 chars). |
| `OpenAI (openai)` | **PASS**<br>API key detected in environment. | **PASS**<br>129 models: babbage-002, chatgpt-image-latest, dall-e-2, dall-e-3, davinci-002, gpt-3.5-turbo, gpt-3.5-turbo-0125, gpt-3.5-turbo-1106 (+121 more) | **PASS**<br>Model gpt-4.1-mini responded (2 chars). |
| `Gemini (google)` | **PASS**<br>API key detected in environment. | **PASS**<br>28 models: gemini-2.0-flash, gemini-2.0-flash-001, gemini-2.0-flash-lite, gemini-2.0-flash-lite-001, gemini-2.5-computer-use-preview-10-2025, gemini-2.5-flash, gemini-2.5-flash-image, gemini-2.5-flash-lite (+20 more) | **PASS**<br>Model gemini-2.5-flash responded (2 chars). |
| `Groq (groq)` | **PASS**<br>API key detected in environment. | **PASS**<br>18 models: allam-2-7b, canopylabs/orpheus-arabic-saudi, canopylabs/orpheus-v1-english, groq/compound, groq/compound-mini, llama-3.1-8b-instant, llama-3.3-70b-versatile, meta-llama/llama-4-scout-17b-16e-instruct (+10 more) | **PASS**<br>Model llama-3.1-8b-instant responded (2 chars). |
| `Mistral (mistral)` | **PASS**<br>API key detected in environment. | **PASS**<br>60 models: codestral-2508, codestral-embed, codestral-embed-2505, codestral-latest, devstral-2512, devstral-latest, devstral-medium-2507, devstral-medium-latest (+52 more) | **PASS**<br>Model ministral-8b-latest responded (2 chars). |
| `OpenRouter (openrouter)` | **PASS**<br>API key detected in environment. | **PASS**<br>350 models: ai21/jamba-large-1.7, aion-labs/aion-1.0, aion-labs/aion-1.0-mini, aion-labs/aion-2.0, aion-labs/aion-rp-llama-3.1-8b, alfredpros/codellama-7b-instruct-solidity, alibaba/tongyi-deepresearch-30b-a3b, allenai/molmo-2-8b (+342 more) | **PASS**<br>Model google/gemini-3-flash-preview responded (2 chars). |
| `OpenAI (openai-proxy)` | **PASS**<br>8 models: gpt-5.1, gpt-5.1-codex-max, gpt-5.1-codex-mini, gpt-5.2, gpt-5.2-codex, gpt-5.3-codex, gpt-5.3-codex-spark, gpt-5.4 | **PASS**<br>8 models: gpt-5.1, gpt-5.1-codex-max, gpt-5.1-codex-mini, gpt-5.2, gpt-5.2-codex, gpt-5.3-codex, gpt-5.3-codex-spark, gpt-5.4 | **PASS**<br>Model gpt-5.1-codex-mini responded (2 chars). |
| `Claude (anthropic-proxy)` | **PASS**<br>9 models: claude-3-haiku-20240307, claude-haiku-4-5-20251001, claude-opus-4-1-20250805, claude-opus-4-20250514, claude-opus-4-5-20251101, claude-opus-4-6, claude-sonnet-4-20250514, claude-sonnet-4-5-20250929 (+1 more) | **PASS**<br>9 models: claude-3-haiku-20240307, claude-haiku-4-5-20251001, claude-opus-4-1-20250805, claude-opus-4-20250514, claude-opus-4-5-20251101, claude-opus-4-6, claude-sonnet-4-20250514, claude-sonnet-4-5-20250929 (+1 more) | **PASS**<br>Model claude-3-haiku-20240307 responded (2 chars). |
| `Gemini (google-proxy)` | **SKIP**<br>Unable to sign in to Gemini. Complete the Google OAuth flow and retry. | **SKIP**<br>Skipped because setup is not available. | **SKIP**<br>Skipped because setup is not available. |
| `GitHub (copilot-proxy)` | **PASS**<br>41 models: claude-haiku-4.5, claude-opus-4.5, claude-opus-4.6, claude-opus-4.6-fast, claude-sonnet-4, claude-sonnet-4.5, claude-sonnet-4.6, gemini-2.5-pro (+33 more) | **PASS**<br>41 models: claude-haiku-4.5, claude-opus-4.5, claude-opus-4.6, claude-opus-4.6-fast, claude-sonnet-4, claude-sonnet-4.5, claude-sonnet-4.6, gemini-2.5-pro (+33 more) | **PASS**<br>Model gpt-4.1 responded (2 chars). |
