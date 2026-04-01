import type { ToolExecutionObserver } from './observer.js';
import { createDeleteWorkspaceFileTool } from './delete-workspace-file.js';
import { createListDirectoryTool } from './list-directory.js';
import { createMoveWorkspaceFileTool } from './move-workspace-file.js';
import { createN8nAcTool } from './n8nac.js';
import { createReadWorkspaceFileTool } from './read-workspace-file.js';
import { createReplaceInWorkspaceFileTool } from './replace-in-workspace-file.js';
import { createReportProgressTool } from './report-progress.js';
import { createRequestRequiredActionTool } from './request-required-action.js';
import { createSearchWorkspaceTool } from './search-workspace.js';
import { createWriteWorkspaceFileTool } from './write-workspace-file.js';
import { createPresentWorkflowResultTool } from './present-workflow-result.js';
import { FULL_RUNTIME_TOOL_NAMES } from './toolsets.js';

function createAllTools(observer?: ToolExecutionObserver) {
  return {
    reportProgress: createReportProgressTool(observer),
    requestRequiredAction: createRequestRequiredActionTool(observer),
    n8nac: createN8nAcTool(observer),
    listDirectory: createListDirectoryTool(observer),
    readWorkspaceFile: createReadWorkspaceFileTool(observer),
    searchWorkspace: createSearchWorkspaceTool(observer),
    writeWorkspaceFile: createWriteWorkspaceFileTool(observer),
    replaceInWorkspaceFile: createReplaceInWorkspaceFileTool(observer),
    moveWorkspaceFile: createMoveWorkspaceFileTool(observer),
    deleteWorkspaceFile: createDeleteWorkspaceFileTool(observer),
    presentWorkflowResult: createPresentWorkflowResultTool(observer),
  };
}

/** The full shape of the tool set when no filtering is applied. */
export type AllBuiltTools = ReturnType<typeof createAllTools>;

export function buildTools(
  observer?: ToolExecutionObserver,
  options: { allowedToolNames?: string[] } = {},
): Partial<AllBuiltTools> {
  const allTools = createAllTools(observer);

  const requestedToolNames = options.allowedToolNames && options.allowedToolNames.length > 0
    ? options.allowedToolNames
    : [...FULL_RUNTIME_TOOL_NAMES];

  return Object.fromEntries(
    requestedToolNames
      .filter((toolName) => toolName in allTools)
      .map((toolName) => [toolName, allTools[toolName as keyof AllBuiltTools]]),
  ) as Partial<AllBuiltTools>;
}
