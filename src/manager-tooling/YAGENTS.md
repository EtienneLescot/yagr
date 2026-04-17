# Yagr Shell Commands

The following `yagr` commands are available in your shell and should be run with the shell tool when needed:

- use `yagr presentWorkflowResult --workflow-id <workflowId>` — present or reference a specific n8n workflow by its ID. Run this whenever you are presenting a workflow or the user requests the workflow URL. This will allow Yagr surfaces to render the workflow link and graph correctly.
  - **After running a workflow via `n8nac` or similar, you MUST call this command to present the result.**
  - After running it, do not restate the raw JSON payload.
  - If the user only asked to present or open the workflow, keep the follow-up text minimal. Do not paraphrase the full workflow structure unless the user explicitly asked for an explanation.
- `yagr yagrProxy` — inspect the current Yagr-managed LLM proxy credential state for n8n chat model nodes. Run this to check whether the proxy credential is active.
  - If the credential is missing or stale, do NOT try to provision it yourself. Ask the user whether they want to rerun `yagr llm proxy setup` or switch to a native n8n provider node instead.

## Workflow Creation/Modification/Execution Guidelines

- **After creation/modification/execution of a workflow via `n8nac`**, you MUST call `yagr presentWorkflowResult --workflow-id <id>` to present the result to the user.
- **If workflow activation fails repeatedly**, you MUST stop retrying. Do not continue attempting the same failed activation.
  - Summarize the failure to the user
  - Explain what went wrong
  - Suggest alternatives or next steps
- **Only retry** if new information changes the situation (e.g., user provides different input, you discover a configuration issue that can be fixed).
- **Do not loop** — if you have already tried 2-3 times and it keeps failing, stop and explain the situation to the user instead of retrying indefinitely.
