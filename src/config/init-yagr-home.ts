import { ensureYagrHomeDir, getYagrN8nWorkspaceDir } from './yagr-home.js';

ensureYagrHomeDir();
const workspaceDir = getYagrN8nWorkspaceDir();

if (process.cwd() !== workspaceDir) {
  process.chdir(workspaceDir);
}