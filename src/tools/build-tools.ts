import type { ToolExecutionObserver } from './observer.js';
import { createDeleteFileTool } from './delete-workspace-file.js';
import { createHttpRequestTool } from './http-request.js';
import { createListDirTool } from './list-directory.js';
import { createRunScriptTool } from './run-script.js';
import { createRunShellTool } from './run-shell.js';
import { createMoveFileTool } from './move-workspace-file.js';
import { createN8nAcTool } from './n8nac.js';
import { createReadFileTool } from './read-workspace-file.js';
import { createReplaceInFileTool } from './replace-in-workspace-file.js';
import { createReportProgressTool } from './report-progress.js';
import { createRequestRequiredActionTool } from './request-required-action.js';
import { createGrepTool } from './search-workspace.js';
import { createWriteFileTool } from './write-workspace-file.js';
import { createPresentWorkflowResultTool } from './present-workflow-result.js';
import { FULL_RUNTIME_TOOL_NAMES } from './toolsets.js';

function createAllTools(observer?: ToolExecutionObserver) {
  return {
    reportProgress: createReportProgressTool(observer),
    requestRequiredAction: createRequestRequiredActionTool(observer),
    n8nac: createN8nAcTool(observer),
    httpRequest: createHttpRequestTool(observer),
    runScript: createRunScriptTool(observer),
    runShell: createRunShellTool(observer),
    listDir: createListDirTool(observer),
    readFile: createReadFileTool(observer),
    grep: createGrepTool(observer),
    writeFile: createWriteFileTool(observer),
    replaceInFile: createReplaceInFileTool(observer),
    moveFile: createMoveFileTool(observer),
    deleteFile: createDeleteFileTool(observer),
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
