import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Load .env files if present (prefer .env.test if it exists)
const envTest = join(process.cwd(), '.env.test');
if (existsSync(envTest)) {
  dotenvConfig({ path: envTest });
} else {
  dotenvConfig();
}
export { HolonAgent } from './agent.js';
export { HolonRunEngine } from './runtime/run-engine.js';
export {
  createN8nEngineFromWorkspace,
  loadN8nEngineConfig,
} from './config/load-n8n-engine-config.js';
export { HolonConfigService } from './config/holon-config-service.js';
export { runCliGateway } from './gateway/cli.js';
export { N8nEngine } from './engine/n8n-engine.js';
export { HolonNativeEngine } from './engine/holon-engine.js';
export {
  createLanguageModel,
  resolveModelName,
  resolveModelProvider,
} from './llm/create-language-model.js';
export { buildSystemPrompt } from './prompt/build-system-prompt.js';
export {
  buildTools,
  createListDirectoryTool,
  createDeleteWorkspaceFileTool,
  createN8nAcTool,
  createMoveWorkspaceFileTool,
  createReadWorkspaceFileTool,
  createReplaceInWorkspaceFileTool,
  createRequestRequiredActionTool,
  createSearchWorkspaceTool,
  createWriteWorkspaceFileTool,
  createDeployWorkflowTool,
  createGenerateWorkflowTool,
  createListWorkflowsTool,
  createManageWorkflowTool,
  createNodeInfoTool,
  createSearchNodesTool,
  createSearchTemplatesTool,
  createValidateWorkflowTool,
} from './tools/index.js';

export type { Engine } from './engine/engine.js';

export type {
  CredentialRequirement,
  DeployedWorkflow,
  EngineName,
  GeneratedWorkflow,
  HolonLanguageModelConfig,
  HolonModelProvider,
  N8nEngineConfig,
  NodeSummary,
  TemplateSummary,
  HolonRunOptions,
  HolonRunResult,
  HolonRunJournalEntry,
  HolonStateEvent,
  HolonAgentState,
  HolonRequiredAction,
  HolonRequiredActionKind,
  HolonRuntimeContext,
  HolonToolHookContext,
  HolonToolHookDecision,
  HolonCompletionAttempt,
  HolonCompletionHookDecision,
  HolonRuntimeHook,
  HolonRunPhase,
  HolonRunStep,
  HolonPhaseEvent,
  WorkflowSpec,
  WorkflowSpecConnection,
  WorkflowSpecNode,
  WorkflowValidationResult,
} from './types.js';
