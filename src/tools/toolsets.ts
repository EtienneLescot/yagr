export const CORE_TOOL_NAMES = [
  'reportProgress',
  'requestRequiredAction',
  'presentWorkflowResult',
] as const;

export const DISCOVERY_TOOL_NAMES = [
  'searchNodes',
  'nodeInfo',
  'searchTemplates',
  'listDirectory',
  'listWorkflows',
  'manageWorkflow',
  'readWorkspaceFile',
  'searchWorkspace',
] as const;

export const EDIT_TOOL_NAMES = [
  'writeWorkspaceFile',
  'replaceInWorkspaceFile',
  'moveWorkspaceFile',
  'deleteWorkspaceFile',
] as const;

export const WORKFLOW_EXECUTION_TOOL_NAMES = [
  'n8nac',
] as const;

export const FULL_RUNTIME_TOOL_NAMES = [
  ...CORE_TOOL_NAMES,
  ...DISCOVERY_TOOL_NAMES,
  ...EDIT_TOOL_NAMES,
  ...WORKFLOW_EXECUTION_TOOL_NAMES,
] as const;

export const MINIMAL_RUNTIME_TOOL_NAMES = [
  ...CORE_TOOL_NAMES,
] as const;

export const POST_SYNC_RUNTIME_TOOL_NAMES = [
  'reportProgress',
  'requestRequiredAction',
  'presentWorkflowResult',
] as const;

export type YagrToolName =
  | typeof FULL_RUNTIME_TOOL_NAMES[number];
