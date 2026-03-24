# Provider Integration Matrix

- Generated at: 2026-03-23T20:34:12.201Z
- Providers: `Claude (anthropic)`, `OpenAI (openai)`, `Gemini (google)`, `Groq (groq)`, `Mistral (mistral)`, `OpenRouter (openrouter)`, `OpenAI (openai-proxy)`, `Claude (anthropic-proxy)`, `GitHub (copilot-proxy)`
- Timeouts: setup/model=60000ms, inference=75000ms
- Advanced scenario: enabled (timeout=180000ms)

## Summary

| Step | PASS | FAIL | SKIP |
| --- | ---: | ---: | ---: |
| setup | 9 | 0 | 0 |
| model-listing | 9 | 0 | 0 |
| inference | 9 | 0 | 0 |
| advanced-scenario | 4 | 5 | 0 |

## Provider Overview

| Provider | Model | Tooling | Setup | Model Listing | Inference | Advanced Scenario |
| --- | --- | --- | --- | --- | --- | --- |
| `Claude (anthropic)` | `claude-3-haiku-20240307` | `native` | **PASS**<br>API key detected in environment. | **PASS**<br>9 models: claude-3-haiku-20240307, claude-haiku-4-5-20251001, claude-opus-4-1-20250805, claude-opus-4-20250514, claude-opus-4-5-20251101, claude-opus-4-6, claude-sonnet-4-20250514, claude-sonnet-4-5-20250929 (+1 more) | **PASS**<br>Model claude-3-haiku-20240307 responded (2 chars). | **FAIL**<br>Failed after 3 attempts. Last error: This request would exceed your organization's maximum usage increase rate for input tokens per minute (org: f1c66ceb-0643-47cc-9937-23647fff5a04, model: claude-3-haiku-20240307). Your current limit is 58,276 input tokens per minute, and will increase to 68,276 at the next minute boundary. Please scale up your input tokens usage more gradually to stay within the acceleration limit. For details, refer to: https://docs.claude.com/en/api/rate-limits. (log: /home/etienne/repos/yagr/reports/provider-advanced-logs/anthropic-2026-03-23T20-25-21-558Z.log) checklist: n8nac=yes, actions=validate/init_auth/init_project, push=no, verify=no, embed=no, embedUrl=no, embedDiagram=no, workflowFile=yes, remoteCreated=0 |
| `OpenAI (openai)` | `gpt-4.1-mini` | `native` | **PASS**<br>API key detected in environment. | **PASS**<br>129 models: babbage-002, chatgpt-image-latest, dall-e-2, dall-e-3, davinci-002, gpt-3.5-turbo, gpt-3.5-turbo-0125, gpt-3.5-turbo-1106 (+121 more) | **PASS**<br>Model gpt-4.1-mini responded (2 chars). | **PASS**<br>CLI scenario succeeded with model gpt-4.1-mini. checklist: n8nac=yes, actions=push/verify/validate, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=0 |
| `Gemini (google)` | `gemini-2.5-flash` | `compatible` | **PASS**<br>API key detected in environment. | **PASS**<br>28 models: gemini-2.0-flash, gemini-2.0-flash-001, gemini-2.0-flash-lite, gemini-2.0-flash-lite-001, gemini-2.5-computer-use-preview-10-2025, gemini-2.5-flash, gemini-2.5-flash-image, gemini-2.5-flash-lite (+20 more) | **PASS**<br>Model gemini-2.5-flash responded (2 chars). | **FAIL**<br>CLI scenario exited cleanly but created or modified no .workflow.ts file in the active workflow directory: Le run s’est termine avec la raison: error. (log: /home/etienne/repos/yagr/reports/provider-advanced-logs/google-2026-03-23T20-26-17-954Z.log) checklist: n8nac=no, actions=none, push=no, verify=no, embed=no, embedUrl=no, embedDiagram=no, workflowFile=no, remoteCreated=0 |
| `Groq (groq)` | `llama-3.1-8b-instant` | `compatible` | **PASS**<br>API key detected in environment. | **PASS**<br>18 models: allam-2-7b, canopylabs/orpheus-arabic-saudi, canopylabs/orpheus-v1-english, groq/compound, groq/compound-mini, llama-3.1-8b-instant, llama-3.3-70b-versatile, meta-llama/llama-4-scout-17b-16e-instruct (+10 more) | **PASS**<br>Model llama-3.1-8b-instant responded (2 chars). | **FAIL**<br>Failed to call a function. Please adjust your prompt. See 'failed_generation' for more details. (log: /home/etienne/repos/yagr/reports/provider-advanced-logs/groq-2026-03-23T20-26-20-476Z.log) checklist: n8nac=no, actions=none, push=no, verify=no, embed=no, embedUrl=no, embedDiagram=no, workflowFile=no, remoteCreated=0 |
| `Mistral (mistral)` | `ministral-8b-latest` | `weak` | **PASS**<br>API key detected in environment. | **PASS**<br>62 models: codestral-2508, codestral-embed, codestral-embed-2505, codestral-latest, devstral-2512, devstral-latest, devstral-medium-2507, devstral-medium-latest (+54 more) | **PASS**<br>Model ministral-8b-latest responded (2 chars). | **PASS**<br>CLI scenario succeeded with model ministral-8b-latest. checklist: n8nac=yes, actions=list/list/push/verify/push/push, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=0 |
| `OpenRouter (openrouter)` | `google/gemini-3-flash-preview` | `weak` | **PASS**<br>API key detected in environment. | **PASS**<br>349 models: ai21/jamba-large-1.7, aion-labs/aion-1.0, aion-labs/aion-1.0-mini, aion-labs/aion-2.0, aion-labs/aion-rp-llama-3.1-8b, alfredpros/codellama-7b-instruct-solidity, alibaba/tongyi-deepresearch-30b-a3b, allenai/olmo-2-0325-32b-instruct (+341 more) | **PASS**<br>Model google/gemini-3-flash-preview responded (2 chars). | **FAIL**<br>Failed to process successful response (log: /home/etienne/repos/yagr/reports/provider-advanced-logs/openrouter-2026-03-23T20-30-16-006Z.log) checklist: n8nac=yes, actions=list, push=no, verify=no, embed=no, embedUrl=no, embedDiagram=no, workflowFile=no, remoteCreated=0 |
| `OpenAI (openai-proxy)` | `gpt-5.1-codex-mini` | `compatible` | **PASS**<br>8 models: gpt-5.1, gpt-5.1-codex-max, gpt-5.1-codex-mini, gpt-5.2, gpt-5.2-codex, gpt-5.3-codex, gpt-5.3-codex-spark, gpt-5.4 | **PASS**<br>8 models: gpt-5.1, gpt-5.1-codex-max, gpt-5.1-codex-mini, gpt-5.2, gpt-5.2-codex, gpt-5.3-codex, gpt-5.3-codex-spark, gpt-5.4 | **PASS**<br>Model gpt-5.1-codex-mini responded (2 chars). | **PASS**<br>CLI scenario succeeded with model gpt-5.1-codex-mini. checklist: n8nac=yes, actions=list/skills/skills/skills/skills/skills/skills/list/push/verify/skills/skills/pull, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=0 |
| `Claude (anthropic-proxy)` | `claude-3-haiku-20240307` | `native` | **PASS**<br>9 models: claude-3-haiku-20240307, claude-haiku-4-5-20251001, claude-opus-4-1-20250805, claude-opus-4-20250514, claude-opus-4-5-20251101, claude-opus-4-6, claude-sonnet-4-20250514, claude-sonnet-4-5-20250929 (+1 more) | **PASS**<br>9 models: claude-3-haiku-20240307, claude-haiku-4-5-20251001, claude-opus-4-1-20250805, claude-opus-4-20250514, claude-opus-4-5-20251101, claude-opus-4-6, claude-sonnet-4-20250514, claude-sonnet-4-5-20250929 (+1 more) | **PASS**<br>Model claude-3-haiku-20240307 responded (2 chars). | **FAIL**<br>Failed after 3 attempts. Last error: This request would exceed your organization's maximum usage increase rate for input tokens per minute (org: f1c66ceb-0643-47cc-9937-23647fff5a04, model: claude-3-haiku-20240307). Your current limit is 61,780 input tokens per minute, and will increase to 71,780 at the next minute boundary. Please scale up your input tokens usage more gradually to stay within the acceleration limit. For details, refer to: https://docs.claude.com/en/api/rate-limits. (log: /home/etienne/repos/yagr/reports/provider-advanced-logs/anthropic-proxy-2026-03-23T20-32-55-891Z.log) checklist: n8nac=yes, actions=init_auth/init_project, push=no, verify=no, embed=no, embedUrl=no, embedDiagram=no, workflowFile=no, remoteCreated=0 |
| `GitHub (copilot-proxy)` | `gpt-4.1` | `compatible` | **PASS**<br>41 models: claude-haiku-4.5, claude-opus-4.5, claude-opus-4.6, claude-opus-4.6-fast, claude-sonnet-4, claude-sonnet-4.5, claude-sonnet-4.6, gemini-2.5-pro (+33 more) | **PASS**<br>41 models: claude-haiku-4.5, claude-opus-4.5, claude-opus-4.6, claude-opus-4.6-fast, claude-sonnet-4, claude-sonnet-4.5, claude-sonnet-4.6, gemini-2.5-pro (+33 more) | **PASS**<br>Model gpt-4.1 responded (2 chars). | **PASS**<br>CLI scenario succeeded with model gpt-4.1. checklist: n8nac=yes, actions=skills/skills/skills/skills/validate/push/verify/push, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=0 |

## Detailed Results

### Claude (anthropic)

- Model: `claude-3-haiku-20240307`
- Tooling level: `native`
- Setup: **PASS**
- Model listing: **PASS**
- Inference: **PASS**
- Advanced scenario: **FAIL**

**Notes**

- Setup: API key detected in environment.
- Model listing: 9 models: claude-3-haiku-20240307, claude-haiku-4-5-20251001, claude-opus-4-1-20250805, claude-opus-4-20250514, claude-opus-4-5-20251101, claude-opus-4-6, claude-sonnet-4-20250514, claude-sonnet-4-5-20250929 (+1 more)
- Inference: Model claude-3-haiku-20240307 responded (2 chars).
- Advanced scenario: Failed after 3 attempts. Last error: This request would exceed your organization's maximum usage increase rate for input tokens per minute (org: f1c66ceb-0643-47cc-9937-23647fff5a04, model: claude-3-haiku-20240307). Your current limit is 58,276 input tokens per minute, and will increase to 68,276 at the next minute boundary. Please scale up your input tokens usage more gradually to stay within the acceleration limit. For details, refer to: https://docs.claude.com/en/api/rate-limits. (log: /home/etienne/repos/yagr/reports/provider-advanced-logs/anthropic-2026-03-23T20-25-21-558Z.log) checklist: n8nac=yes, actions=validate/init_auth/init_project, push=no, verify=no, embed=no, embedUrl=no, embedDiagram=no, workflowFile=yes, remoteCreated=0

### OpenAI (openai)

- Model: `gpt-4.1-mini`
- Tooling level: `native`
- Setup: **PASS**
- Model listing: **PASS**
- Inference: **PASS**
- Advanced scenario: **PASS**

**Notes**

- Setup: API key detected in environment.
- Model listing: 129 models: babbage-002, chatgpt-image-latest, dall-e-2, dall-e-3, davinci-002, gpt-3.5-turbo, gpt-3.5-turbo-0125, gpt-3.5-turbo-1106 (+121 more)
- Inference: Model gpt-4.1-mini responded (2 chars).
- Advanced scenario: CLI scenario succeeded with model gpt-4.1-mini. checklist: n8nac=yes, actions=push/verify/validate, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=0

**Advanced Final Response**

```text
Le workflow `yagr-it-openai-1774297523803802` est pret, valide, pousse vers n8n, verifie.
Lien du workflow: http://localhost:5678/workflow/Pt0atC51Bwxvyb7M
La carte du workflow ci-dessous contient le lien direct et le schema.
Actions n8nac en echec: validate (yagr-it-openai-1774297523803802.workflow.ts)
Le run s’est arrete alors que certaines actions avaient encore echoue. Une correction supplementaire reste necessaire ou un bloqueur externe persiste.
```

### Gemini (google)

- Model: `gemini-2.5-flash`
- Tooling level: `compatible`
- Setup: **PASS**
- Model listing: **PASS**
- Inference: **PASS**
- Advanced scenario: **FAIL**

**Notes**

- Setup: API key detected in environment.
- Model listing: 28 models: gemini-2.0-flash, gemini-2.0-flash-001, gemini-2.0-flash-lite, gemini-2.0-flash-lite-001, gemini-2.5-computer-use-preview-10-2025, gemini-2.5-flash, gemini-2.5-flash-image, gemini-2.5-flash-lite (+20 more)
- Inference: Model gemini-2.5-flash responded (2 chars).
- Advanced scenario: CLI scenario exited cleanly but created or modified no .workflow.ts file in the active workflow directory: Le run s’est termine avec la raison: error. (log: /home/etienne/repos/yagr/reports/provider-advanced-logs/google-2026-03-23T20-26-17-954Z.log) checklist: n8nac=no, actions=none, push=no, verify=no, embed=no, embedUrl=no, embedDiagram=no, workflowFile=no, remoteCreated=0

**Advanced Final Response**

```text
Le run s’est termine avec la raison: error.
```

### Groq (groq)

- Model: `llama-3.1-8b-instant`
- Tooling level: `compatible`
- Setup: **PASS**
- Model listing: **PASS**
- Inference: **PASS**
- Advanced scenario: **FAIL**

**Notes**

- Setup: API key detected in environment.
- Model listing: 18 models: allam-2-7b, canopylabs/orpheus-arabic-saudi, canopylabs/orpheus-v1-english, groq/compound, groq/compound-mini, llama-3.1-8b-instant, llama-3.3-70b-versatile, meta-llama/llama-4-scout-17b-16e-instruct (+10 more)
- Inference: Model llama-3.1-8b-instant responded (2 chars).
- Advanced scenario: Failed to call a function. Please adjust your prompt. See 'failed_generation' for more details. (log: /home/etienne/repos/yagr/reports/provider-advanced-logs/groq-2026-03-23T20-26-20-476Z.log) checklist: n8nac=no, actions=none, push=no, verify=no, embed=no, embedUrl=no, embedDiagram=no, workflowFile=no, remoteCreated=0

### Mistral (mistral)

- Model: `ministral-8b-latest`
- Tooling level: `weak`
- Setup: **PASS**
- Model listing: **PASS**
- Inference: **PASS**
- Advanced scenario: **PASS**

**Notes**

- Setup: API key detected in environment.
- Model listing: 62 models: codestral-2508, codestral-embed, codestral-embed-2505, codestral-latest, devstral-2512, devstral-latest, devstral-medium-2507, devstral-medium-latest (+54 more)
- Inference: Model ministral-8b-latest responded (2 chars).
- Advanced scenario: CLI scenario succeeded with model ministral-8b-latest. checklist: n8nac=yes, actions=list/list/push/verify/push/push, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=0

**Advanced Final Response**

```text
Le workflow `yagr-it-mistral-1774297581208` est pret, valide, pousse vers n8n, verifie.
Lien du workflow: http://localhost:5678/workflow/rlwUbOHjJiSaItPy
La carte du workflow ci-dessous contient le lien direct et le schema.
```

### OpenRouter (openrouter)

- Model: `google/gemini-3-flash-preview`
- Tooling level: `weak`
- Setup: **PASS**
- Model listing: **PASS**
- Inference: **PASS**
- Advanced scenario: **FAIL**

**Notes**

- Setup: API key detected in environment.
- Model listing: 349 models: ai21/jamba-large-1.7, aion-labs/aion-1.0, aion-labs/aion-1.0-mini, aion-labs/aion-2.0, aion-labs/aion-rp-llama-3.1-8b, alfredpros/codellama-7b-instruct-solidity, alibaba/tongyi-deepresearch-30b-a3b, allenai/olmo-2-0325-32b-instruct (+341 more)
- Inference: Model google/gemini-3-flash-preview responded (2 chars).
- Advanced scenario: Failed to process successful response (log: /home/etienne/repos/yagr/reports/provider-advanced-logs/openrouter-2026-03-23T20-30-16-006Z.log) checklist: n8nac=yes, actions=list, push=no, verify=no, embed=no, embedUrl=no, embedDiagram=no, workflowFile=no, remoteCreated=0

### OpenAI (openai-proxy)

- Model: `gpt-5.1-codex-mini`
- Tooling level: `compatible`
- Setup: **PASS**
- Model listing: **PASS**
- Inference: **PASS**
- Advanced scenario: **PASS**

**Notes**

- Setup: 8 models: gpt-5.1, gpt-5.1-codex-max, gpt-5.1-codex-mini, gpt-5.2, gpt-5.2-codex, gpt-5.3-codex, gpt-5.3-codex-spark, gpt-5.4
- Model listing: 8 models: gpt-5.1, gpt-5.1-codex-max, gpt-5.1-codex-mini, gpt-5.2, gpt-5.2-codex, gpt-5.3-codex, gpt-5.3-codex-spark, gpt-5.4
- Inference: Model gpt-5.1-codex-mini responded (2 chars).
- Advanced scenario: CLI scenario succeeded with model gpt-5.1-codex-mini. checklist: n8nac=yes, actions=list/skills/skills/skills/skills/skills/skills/list/push/verify/skills/skills/pull, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=0

**Advanced Final Response**

```text
Workflow `yagr-it-openai-proxy-1774297819330-basic` now exists as requested. It contains a Manual Trigger feeding into a Set node that assigns `status: "ok"`, matches the unique name requirement, and was created from scratch in the local sync folder. I validated the workflow locally, pushed it to the n8n instance, and the post-push verification succeeded.
```

### Claude (anthropic-proxy)

- Model: `claude-3-haiku-20240307`
- Tooling level: `native`
- Setup: **PASS**
- Model listing: **PASS**
- Inference: **PASS**
- Advanced scenario: **FAIL**

**Notes**

- Setup: 9 models: claude-3-haiku-20240307, claude-haiku-4-5-20251001, claude-opus-4-1-20250805, claude-opus-4-20250514, claude-opus-4-5-20251101, claude-opus-4-6, claude-sonnet-4-20250514, claude-sonnet-4-5-20250929 (+1 more)
- Model listing: 9 models: claude-3-haiku-20240307, claude-haiku-4-5-20251001, claude-opus-4-1-20250805, claude-opus-4-20250514, claude-opus-4-5-20251101, claude-opus-4-6, claude-sonnet-4-20250514, claude-sonnet-4-5-20250929 (+1 more)
- Inference: Model claude-3-haiku-20240307 responded (2 chars).
- Advanced scenario: Failed after 3 attempts. Last error: This request would exceed your organization's maximum usage increase rate for input tokens per minute (org: f1c66ceb-0643-47cc-9937-23647fff5a04, model: claude-3-haiku-20240307). Your current limit is 61,780 input tokens per minute, and will increase to 71,780 at the next minute boundary. Please scale up your input tokens usage more gradually to stay within the acceleration limit. For details, refer to: https://docs.claude.com/en/api/rate-limits. (log: /home/etienne/repos/yagr/reports/provider-advanced-logs/anthropic-proxy-2026-03-23T20-32-55-891Z.log) checklist: n8nac=yes, actions=init_auth/init_project, push=no, verify=no, embed=no, embedUrl=no, embedDiagram=no, workflowFile=no, remoteCreated=0

### GitHub (copilot-proxy)

- Model: `gpt-4.1`
- Tooling level: `compatible`
- Setup: **PASS**
- Model listing: **PASS**
- Inference: **PASS**
- Advanced scenario: **PASS**

**Notes**

- Setup: 41 models: claude-haiku-4.5, claude-opus-4.5, claude-opus-4.6, claude-opus-4.6-fast, claude-sonnet-4, claude-sonnet-4.5, claude-sonnet-4.6, gemini-2.5-pro (+33 more)
- Model listing: 41 models: claude-haiku-4.5, claude-opus-4.5, claude-opus-4.6, claude-opus-4.6-fast, claude-sonnet-4, claude-sonnet-4.5, claude-sonnet-4.6, gemini-2.5-pro (+33 more)
- Inference: Model gpt-4.1 responded (2 chars).
- Advanced scenario: CLI scenario succeeded with model gpt-4.1. checklist: n8nac=yes, actions=skills/skills/skills/skills/validate/push/verify/push, push=yes, verify=yes, embed=yes, embedUrl=yes, embedDiagram=yes, workflowFile=yes, remoteCreated=0

**Advanced Final Response**

```text
Le workflow `yagr-it-copilot-proxy-1774297978431-minimal` est pret, valide, pousse vers n8n, verifie.
Lien du workflow: http://localhost:5678/workflow/yLFOGXOww7Uh6kxV
La carte du workflow ci-dessous contient le lien direct et le schema.
```

