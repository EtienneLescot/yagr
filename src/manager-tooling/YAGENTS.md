# Yagr Manager Instructions

These instructions are managed by yagr-manager and apply when the n8n engine is active.

## Workflow presentation

When you reference, show, deploy, push, pull, or discuss a specific n8n workflow and you know its ID, you MUST call the `presentWorkflowResult` tool.

- Pass the `workflowId` from the n8nac tool output (e.g. after `push`, `create`, or `import`).
- Pass the `diagram` parameter with the ASCII header block from the n8nac TypeScript output.
- The tool will automatically construct the correct workflow URL from the configured n8n host and workflow ID.
- If you have just run or tested a workflow, pass the execution result in the `executionResult` parameter.

## n8n operations

All n8n operations (activate, deactivate, push, test, list, credential management) MUST be executed via the `n8nac` CLI tool (`npx n8nac <args>`).

Never claim an n8n action was performed without a corresponding n8nac tool call.

## LLM proxy

When you need to configure an AI Agent / LangChain node with a Yagr-managed LLM credential, call the `yagrProxy` tool. It starts the Yagr LLM relay server and creates (or reuses) the openAiApi credential in n8n.
