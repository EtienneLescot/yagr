# Provider Integration Matrix

- Generated at: 2026-03-23T10:01:50.530Z
- Providers: `OpenAI (openai)`, `Claude (anthropic)`, `Gemini (google)`, `Groq (groq)`, `Mistral (mistral)`, `OpenRouter (openrouter)`
- Timeouts: setup/model=60000ms, inference=75000ms
- Advanced scenario: enabled (timeout=120000ms)

## Summary

| Step | PASS | FAIL | SKIP |
| --- | ---: | ---: | ---: |
| setup | 6 | 0 | 0 |
| model-listing | 6 | 0 | 0 |
| inference | 6 | 0 | 0 |
| advanced-scenario | 0 | 6 | 0 |

## Details

| Provider | Setup | Model Listing | Inference | Advanced Scenario |
| --- | --- | --- | --- | --- |
| `OpenAI (openai)` | **PASS**<br>API key detected in environment. | **PASS**<br>129 models: babbage-002, chatgpt-image-latest, dall-e-2, dall-e-3, davinci-002, gpt-3.5-turbo, gpt-3.5-turbo-0125, gpt-3.5-turbo-1106 (+121 more) | **PASS**<br>Model gpt-4.1-mini responded (2 chars). | **FAIL**<br>Request failed with status code 401 |
| `Claude (anthropic)` | **PASS**<br>API key detected in environment. | **PASS**<br>9 models: claude-3-haiku-20240307, claude-haiku-4-5-20251001, claude-opus-4-1-20250805, claude-opus-4-20250514, claude-opus-4-5-20251101, claude-opus-4-6, claude-sonnet-4-20250514, claude-sonnet-4-5-20250929 (+1 more) | **PASS**<br>Model claude-3-haiku-20240307 responded (2 chars). | **FAIL**<br>Request failed with status code 401 |
| `Gemini (google)` | **PASS**<br>API key detected in environment. | **PASS**<br>28 models: gemini-2.0-flash, gemini-2.0-flash-001, gemini-2.0-flash-lite, gemini-2.0-flash-lite-001, gemini-2.5-computer-use-preview-10-2025, gemini-2.5-flash, gemini-2.5-flash-image, gemini-2.5-flash-lite (+20 more) | **PASS**<br>Model gemini-2.5-flash responded (2 chars). | **FAIL**<br>Request failed with status code 401 |
| `Groq (groq)` | **PASS**<br>API key detected in environment. | **PASS**<br>18 models: allam-2-7b, canopylabs/orpheus-arabic-saudi, canopylabs/orpheus-v1-english, groq/compound, groq/compound-mini, llama-3.1-8b-instant, llama-3.3-70b-versatile, meta-llama/llama-4-scout-17b-16e-instruct (+10 more) | **PASS**<br>Model llama-3.1-8b-instant responded (2 chars). | **FAIL**<br>Request failed with status code 401 |
| `Mistral (mistral)` | **PASS**<br>API key detected in environment. | **PASS**<br>62 models: codestral-2508, codestral-embed, codestral-embed-2505, codestral-latest, devstral-2512, devstral-latest, devstral-medium-2507, devstral-medium-latest (+54 more) | **PASS**<br>Model ministral-8b-latest responded (2 chars). | **FAIL**<br>Request failed with status code 401 |
| `OpenRouter (openrouter)` | **PASS**<br>API key detected in environment. | **PASS**<br>349 models: ai21/jamba-large-1.7, aion-labs/aion-1.0, aion-labs/aion-1.0-mini, aion-labs/aion-2.0, aion-labs/aion-rp-llama-3.1-8b, alfredpros/codellama-7b-instruct-solidity, alibaba/tongyi-deepresearch-30b-a3b, allenai/olmo-2-0325-32b-instruct (+341 more) | **PASS**<br>Model google/gemini-3-flash-preview responded (2 chars). | **FAIL**<br>Request failed with status code 401 |
