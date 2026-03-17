import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const initialLaunchDir = process.env.YAGR_LAUNCH_CWD ?? process.cwd();

if (!process.env.YAGR_LAUNCH_CWD) {
  process.env.YAGR_LAUNCH_CWD = initialLaunchDir;
}

export function getYagrLaunchDir(): string {
  return process.env.YAGR_LAUNCH_CWD ?? initialLaunchDir;
}

export function getYagrHomeDir(): string {
  const configuredHome = process.env.YAGR_HOME?.trim();
  if (configuredHome) {
    return path.isAbsolute(configuredHome)
      ? configuredHome
      : path.resolve(getYagrLaunchDir(), configuredHome);
  }

  return path.join(os.homedir(), '.yagr');
}

export function ensureYagrHomeDir(): string {
  const homeDir = getYagrHomeDir();
  fs.mkdirSync(homeDir, { recursive: true });
  return homeDir;
}