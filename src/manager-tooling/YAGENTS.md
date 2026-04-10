# Yagr Manager Instructions

Manager-specific behaviors available in this environment:

- `yagr presentWorkflowResult`: use this manager command when you need to present or reference a specific n8n workflow and you know its workflow ID.
- `yagr yagrProxy`: use this manager command to inspect the current Yagr-managed LLM proxy credential state for n8n chat model nodes.
- If the credential is missing or stale, do not try to provision it from the agent, ask the user wether he wants to rerun `yagr llm proxy setup` or to choose a n8n native provide node instead.
