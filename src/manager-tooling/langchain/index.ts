/**
 * n8n manager tools in LangChain (`@langchain/core`) format.
 *
 * These tools are registered in the deep-agent runtime only when the n8n
 * engine is active.  They live here (separate from `src/tools/langchain/`)
 * so the n8n-specific coupling stays in `src/manager-tooling/`.
 */
export { presentWorkflowResultTool, WORKFLOW_EMBED_TYPE } from './present-workflow-result.js';
export type { WorkflowEmbedPayload } from './present-workflow-result.js';
export { yagrProxyTool } from './yagr-proxy.js';
