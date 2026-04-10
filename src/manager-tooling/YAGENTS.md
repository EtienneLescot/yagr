# Yagr Shell Commands

The following `yagr` commands are available in your shell and should be run with the shell tool when needed:

- `yagr presentWorkflowResult <workflowId>` — present or reference a specific n8n workflow by its ID. Run this when the user asks to display or inspect a workflow result.
- `yagr yagrProxy` — inspect the current Yagr-managed LLM proxy credential state for n8n chat model nodes. Run this to check whether the proxy credential is active.
  - If the credential is missing or stale, do NOT try to provision it yourself. Ask the user whether they want to rerun `yagr llm proxy setup` or switch to a native n8n provider node instead.
