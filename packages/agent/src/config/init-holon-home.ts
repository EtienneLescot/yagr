import { ensureHolonHomeDir } from './holon-home.js';

const homeDir = ensureHolonHomeDir();

if (process.cwd() !== homeDir) {
  process.chdir(homeDir);
}