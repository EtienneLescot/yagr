# Yagr Manager Instructions

- When the user asks about workflows, automations, n8n, webhooks, `n8nac`, workflow tests, workflow execution, or workflow deployment, enter `./n8n-workspace` and read `./n8n-workspace/AGENTS.md` before acting there.

Manager-specific behaviors available in this environment:

- `yagr presentWorkflowResult`: use this manager command when you need to present or reference a specific n8n workflow and you know its workflow ID.
- `yagr yagrProxy`: use this manager command when you need to configure a chatLLM node for n8n agents (such as LangChain agent node) with a Yagr-managed LLM proxy credential.
list available credentials and if you find none, add a new one of type `LLM_PROXY`.
if yagrProxy is not available, ask the user which credential they want to use and assume and ask them for API key.