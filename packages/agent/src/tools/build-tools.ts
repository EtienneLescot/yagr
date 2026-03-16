import type { Engine } from '../engine/engine.js';
import type { ToolExecutionObserver } from './observer.js';
import { createListDirectoryTool } from './list-directory.js';
import { createN8nAcTool } from './n8nac.js';
import { createReadWorkspaceFileTool } from './read-workspace-file.js';
import { createReplaceInWorkspaceFileTool } from './replace-in-workspace-file.js';
import { createReportProgressTool } from './report-progress.js';
import { createRequestRequiredActionTool } from './request-required-action.js';
import { createSearchWorkspaceTool } from './search-workspace.js';
import { createWriteWorkspaceFileTool } from './write-workspace-file.js';

export function buildTools(engine: Engine, observer?: ToolExecutionObserver) {
  void engine;

  return {
    reportProgress: createReportProgressTool(observer),
    requestRequiredAction: createRequestRequiredActionTool(observer),
    n8nac: createN8nAcTool(observer),
    listDirectory: createListDirectoryTool(observer),
    readWorkspaceFile: createReadWorkspaceFileTool(observer),
    searchWorkspace: createSearchWorkspaceTool(observer),
    writeWorkspaceFile: createWriteWorkspaceFileTool(observer),
    replaceInWorkspaceFile: createReplaceInWorkspaceFileTool(observer),
  };
}
