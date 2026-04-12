# Yagr Shell Commands

The following `yagr` commands are available in your shell and should be run with the shell tool when needed:

- use `yagr presentWorkflowResult <workflowId>` — present or reference a specific n8n workflow by its ID. Run this whenever you are presenting a workflow or the user requests the workflow URL. This will allow you to show the correct URL to the user.
- `yagr yagrProxy` — inspect the current Yagr-managed LLM proxy credential state for n8n chat model nodes. Run this to check whether the proxy credential is active.
  - If the credential is missing or stale, do NOT try to provision it yourself. Ask the user whether they want to rerun `yagr llm proxy setup` or switch to a native n8n provider node instead.
