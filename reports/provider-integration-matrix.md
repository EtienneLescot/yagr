# Provider Integration Matrix

- Generated at: 2026-03-21T12:26:18.513Z
- Providers: `openai`
- Timeouts: setup/model=60000ms, inference=75000ms
- Advanced scenario: enabled (timeout=120000ms)

## Summary

| Step | PASS | FAIL | SKIP |
| --- | ---: | ---: | ---: |
| setup | 1 | 0 | 0 |
| model-listing | 1 | 0 | 0 |
| inference | 1 | 0 | 0 |
| advanced-scenario | 0 | 1 | 0 |

## Details

| Provider | Setup | Model Listing | Inference | Advanced Scenario |
| --- | --- | --- | --- | --- |
| `openai` | **PASS**<br>API key detected in environment. | **PASS**<br>129 models: babbage-002, chatgpt-image-latest, dall-e-2, dall-e-3, davinci-002, gpt-3.5-turbo, gpt-3.5-turbo-0125, gpt-3.5-turbo-1106 (+121 more) | **PASS**<br>Model gpt-5-mini responded (2 chars). | **FAIL**<br>Yagr CLI error: Invalid schema for function 'n8nac': In context=(), 'required' is required to be supplied and to be an array including every key in properties.… (log: /home/etienne/repos/yagr/reports/provider-advanced-logs/openai-2026-03-21T12-26-18-512Z.log) |
