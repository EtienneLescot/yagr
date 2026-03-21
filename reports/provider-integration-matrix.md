# Provider Integration Matrix

- Generated at: 2026-03-21T12:34:11.208Z
- Providers: `groq`
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
| `groq` | **PASS**<br>API key detected in environment. | **PASS**<br>18 models: allam-2-7b, canopylabs/orpheus-arabic-saudi, canopylabs/orpheus-v1-english, groq/compound, groq/compound-mini, llama-3.1-8b-instant, llama-3.3-70b-versatile, meta-llama/llama-4-scout-17b-16e-instruct (+10 more) | **PASS**<br>Model llama-3.1-8b-instant responded (2 chars). | **PASS**<br>CLI scenario succeeded with model llama-3.1-8b-instant. |
