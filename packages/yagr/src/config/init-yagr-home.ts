import { ensureYagrHomeDir } from './yagr-home.js';

const homeDir = ensureYagrHomeDir();

if (process.cwd() !== homeDir) {
  process.chdir(homeDir);
}