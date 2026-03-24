import type {
  NodeCatalogPort,
  TemplateCatalogPort,
  WorkflowLifecyclePort,
} from '../engine/engine.js';
import type { ToolExecutionObserver } from './observer.js';
import { createDeleteWorkspaceFileTool } from './delete-workspace-file.js';
import { createListDirectoryTool } from './list-directory.js';
import { createListWorkflowsTool } from './list-workflows.js';
import { createManageWorkflowTool } from './manage-workflow.js';
import { createMoveWorkspaceFileTool } from './move-workspace-file.js';
import { createN8nAcTool } from './n8nac.js';
import { createNodeInfoTool } from './node-info.js';
import { createReadWorkspaceFileTool } from './read-workspace-file.js';
import { createReplaceInWorkspaceFileTool } from './replace-in-workspace-file.js';
import { createReportProgressTool } from './report-progress.js';
import { createSearchNodesTool } from './search-nodes.js';
import { createSearchTemplatesTool } from './search-templates.js';
import { createRequestRequiredActionTool } from './request-required-action.js';
import { createSearchWorkspaceTool } from './search-workspace.js';
import { createWriteWorkspaceFileTool } from './write-workspace-file.js';
import { createPresentWorkflowResultTool } from './present-workflow-result.js';

export function buildTools(
  engine: NodeCatalogPort & TemplateCatalogPort & WorkflowLifecyclePort,
  observer?: ToolExecutionObserver,
  options: { allowedToolNames?: string[] } = {},
) {
  const allTools = {
    reportProgress: createReportProgressTool(observer),
    requestRequiredAction: createRequestRequiredActionTool(observer),
    n8nac: createN8nAcTool(observer),
    searchNodes: createSearchNodesTool(engine),
    nodeInfo: createNodeInfoTool(engine),
    searchTemplates: createSearchTemplatesTool(engine),
    listDirectory: createListDirectoryTool(observer),
    listWorkflows: createListWorkflowsTool(engine),
    manageWorkflow: createManageWorkflowTool(engine),
    readWorkspaceFile: createReadWorkspaceFileTool(observer),
    searchWorkspace: createSearchWorkspaceTool(observer),
    writeWorkspaceFile: createWriteWorkspaceFileTool(observer),
    replaceInWorkspaceFile: createReplaceInWorkspaceFileTool(observer),
    moveWorkspaceFile: createMoveWorkspaceFileTool(observer),
    deleteWorkspaceFile: createDeleteWorkspaceFileTool(observer),
    presentWorkflowResult: createPresentWorkflowResultTool(observer),
  };

  if (!options.allowedToolNames || options.allowedToolNames.length === 0) {
    return allTools;
  }

  const allowed = new Set(options.allowedToolNames);
  return Object.fromEntries(
    Object.entries(allTools).filter(([toolName]) => allowed.has(toolName)),
  );
}
