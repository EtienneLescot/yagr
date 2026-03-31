# Scenario Integration Report

- Generated at: 2026-03-31T17:15:04.140Z
- Provider: `openrouter`
- Model: `google/gemini-3-flash-preview`
- n8n: `http://localhost:5678`

## Summary

| Status | Count |
| --- | ---: |
| PASS | 1 |
| FAIL | 0 |
| SKIP | 0 |

## Scenario Results

| ID | Name | Status | Steps | Note |
| --- | --- | --- | ---: | --- |
| `list-workflows` | Listing des workflows existants | **PASS** | 9 | A utilisé n8nac (list). Réponse: Voici la liste de vos workflows n8n disponibles :
*   My workflow
*   My workflo… |

## Scenario Details

### list-workflows — Listing des workflows existants

- **Status:** PASS
- **Steps:** 9
- **Note:** A utilisé n8nac (list). Réponse: Voici la liste de vos workflows n8n disponibles :
*   My workflow
*   My workflo…
- **Prompt:** Liste tous mes workflows n8n disponibles. Montre-moi leurs noms.

**Response (truncated):**

```text
Voici la liste de vos workflows n8n disponibles :
*   My workflow
*   My workflow 2
```
