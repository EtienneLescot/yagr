import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const initialLaunchDir = process.env.HOLON_LAUNCH_CWD ?? process.cwd();

if (!process.env.HOLON_LAUNCH_CWD) {
  process.env.HOLON_LAUNCH_CWD = initialLaunchDir;
}

export function getHolonLaunchDir(): string {
  return process.env.HOLON_LAUNCH_CWD ?? initialLaunchDir;
}

export function getHolonHomeDir(): string {
  const configuredHome = process.env.HOLON_HOME?.trim();
  if (configuredHome) {
    return path.isAbsolute(configuredHome)
      ? configuredHome
      : path.resolve(getHolonLaunchDir(), configuredHome);
  }

  return path.join(os.homedir(), '.holon');
}

export function ensureHolonHomeDir(): string {
  const homeDir = getHolonHomeDir();
  fs.mkdirSync(homeDir, { recursive: true });
  return homeDir;
}