export const CORE_TOOL_NAMES = [
  'reportProgress',
  'requestRequiredAction',
  'presentWorkflowResult',
] as const;

export const DISCOVERY_TOOL_NAMES = [
  'listDir',
  'readFile',
  'grep',
  'httpRequest',
] as const;

export const EDIT_TOOL_NAMES = [
  'replaceInFile',
  'writeFile',
  'moveFile',
  'deleteFile',
] as const;

export const WORKFLOW_EXECUTION_TOOL_NAMES = [
  'yagrProxy',
  'runScript',
  'runShell',
] as const;

export const MATERIAL_RUNTIME_TOOL_NAMES = [
  ...EDIT_TOOL_NAMES,
  ...WORKFLOW_EXECUTION_TOOL_NAMES,
  'presentWorkflowResult',
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

export const SYNTHETIC_RUNTIME_TOOL_NAMES = [
  ...CORE_TOOL_NAMES,
  'writeFile',
  'yagrProxy',
] as const;

export type YagrToolName =
  | typeof FULL_RUNTIME_TOOL_NAMES[number];
