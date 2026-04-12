# Yagr Shell Commands

The following `yagr` commands are available in your shell and should be run with the shell tool when needed:

- use `yagr presentWorkflowResult  --workflow-id <workflowId>` — present or reference a specific n8n workflow by its ID. Run this whenever you are presenting a workflow or the user requests the workflow URL. This will allow Yagr surfaces to render the workflow link and graph correctly.
  - After running it, do not restate the raw JSON payload.
  - If the user only asked to present or open the workflow, keep the follow-up text minimal. Do not paraphrase the full workflow structure unless the user explicitly asked for an explanation.
- `yagr yagrProxy` — inspect the current Yagr-managed LLM proxy credential state for n8n chat model nodes. Run this to check whether the proxy credential is active.
  - If the credential is missing or stale, do NOT try to provision it yourself. Ask the user whether they want to rerun `yagr llm proxy setup` or switch to a native n8n provider node instead.
