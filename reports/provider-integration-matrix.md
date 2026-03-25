# Provider Integration Matrix

- Generated at: 2026-03-25T18:47:33.174Z
- Providers: `OpenAI (openai-proxy)`
- Timeouts: setup/model=60000ms, inference=75000ms
- Advanced scenario: disabled

## Summary

| Step | PASS | FAIL | SKIP |
| --- | ---: | ---: | ---: |
| setup | 0 | 1 | 0 |
| model-listing | 0 | 1 | 0 |
| inference | 0 | 1 | 0 |

## Provider Overview

| Provider | Model | Tooling | Setup | Model Listing | Inference |
| --- | --- | --- | --- | --- | --- |
| `OpenAI (openai-proxy)` | `gpt-4.1` | `compatible` | **FAIL**<br>{"error":{"type":"usage_limit_reached","message":"The usage limit has been reached","plan_type":"plus","resets_at":1774612172,"eligible_promo":null,"resets_in_seconds":147720}} | **FAIL**<br>Missing API key for model discovery. | **FAIL**<br>{"detail":"The 'gpt-4.1' model is not supported when using Codex with a ChatGPT account."} |

## Detailed Results

### OpenAI (openai-proxy)

- Model: `gpt-4.1`
- Tooling level: `compatible`
- Setup: **FAIL**
- Model listing: **FAIL**
- Inference: **FAIL**

**Notes**

- Setup: {"error":{"type":"usage_limit_reached","message":"The usage limit has been reached","plan_type":"plus","resets_at":1774612172,"eligible_promo":null,"resets_in_seconds":147720}}
- Model listing: Missing API key for model discovery.
- Inference: {"detail":"The 'gpt-4.1' model is not supported when using Codex with a ChatGPT account."}

