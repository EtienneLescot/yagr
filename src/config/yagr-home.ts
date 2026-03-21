import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const initialLaunchDir = process.env.YAGR_LAUNCH_CWD ?? process.cwd();

export interface YagrPaths {
  launchDir: string;
  homeDir: string;
  n8nWorkspaceDir: string;
  managedN8nDir: string;
  homeInstructionsPath: string;
  workspaceInstructionsPath: string;
  yagrConfigPath: string;
  yagrCredentialsPath: string;
  n8nConfigPath: string;
  n8nCredentialsPath: string;
  legacyYagrCredentialsDir: string;
  legacyYagrCredentialsPath: string;
  legacyN8nCredentialsDir: string;
  legacyN8nCredentialsPath: string;
}

if (!process.env.YAGR_LAUNCH_CWD) {
  process.env.YAGR_LAUNCH_CWD = initialLaunchDir;
}

export function getYagrLaunchDir(): string {
  return process.env.YAGR_LAUNCH_CWD ?? initialLaunchDir;
}

export function resolveYagrHomeDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  homedir: string = os.homedir(),
  launchDir: string = getYagrLaunchDir(),
): string {
  const configuredHome = env.YAGR_HOME?.trim();
  if (configuredHome) {
    return path.isAbsolute(configuredHome)
      ? configuredHome
      : path.resolve(launchDir, configuredHome);
  }

  if (platform === 'win32') {
    const appDataDir = env.APPDATA?.trim();
    if (appDataDir) {
      return path.join(appDataDir, 'yagr');
    }

    return path.join(homedir, 'AppData', 'Roaming', 'yagr');
  }

  return path.join(homedir, '.yagr');
}

export function getYagrHomeDir(): string {
  return resolveYagrHomeDir(process.env, process.platform, os.homedir(), getYagrLaunchDir());
}

export function getYagrN8nWorkspaceDir(): string {
  return path.join(getYagrHomeDir(), 'n8n-workspace');
}

export function getYagrManagedN8nDir(): string {
  return path.join(getYagrHomeDir(), 'n8n');
}

export function resolveLegacyConfStorePath(
  projectName: string,
  configName: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  homedir: string = os.homedir(),
): string {
  const suffix = `${projectName}-nodejs`;
  if (platform === 'win32') {
    const appDataDir = env.APPDATA?.trim() || path.join(homedir, 'AppData', 'Roaming');
    return path.join(appDataDir, suffix, `${configName}.json`);
  }

  if (platform === 'darwin') {
    return path.join(homedir, 'Library', 'Preferences', suffix, `${configName}.json`);
  }

  const xdgConfigHome = env.XDG_CONFIG_HOME?.trim() || path.join(homedir, '.config');
  return path.join(xdgConfigHome, suffix, `${configName}.json`);
}

export function getYagrPaths(): YagrPaths {
  const launchDir = getYagrLaunchDir();
  const homeDir = getYagrHomeDir();
  const n8nWorkspaceDir = getYagrN8nWorkspaceDir();
  const managedN8nDir = getYagrManagedN8nDir();
  const legacyYagrCredentialsPath = resolveLegacyConfStorePath('yagr', 'credentials');
  const legacyN8nCredentialsPath = resolveLegacyConfStorePath('n8nac', 'credentials');

  return {
    launchDir,
    homeDir,
    n8nWorkspaceDir,
    managedN8nDir,
    homeInstructionsPath: path.join(homeDir, 'AGENTS.md'),
    workspaceInstructionsPath: path.join(n8nWorkspaceDir, 'AGENTS.md'),
    yagrConfigPath: path.join(homeDir, 'yagr-config.json'),
    yagrCredentialsPath: path.join(homeDir, 'credentials.json'),
    n8nConfigPath: path.join(n8nWorkspaceDir, 'n8nac-config.json'),
    n8nCredentialsPath: path.join(homeDir, 'n8n-credentials.json'),
    legacyYagrCredentialsDir: path.dirname(legacyYagrCredentialsPath),
    legacyYagrCredentialsPath,
    legacyN8nCredentialsDir: path.dirname(legacyN8nCredentialsPath),
    legacyN8nCredentialsPath,
  };
}

export function ensureYagrHomeDir(): string {
  const paths = getYagrPaths();
  fs.mkdirSync(paths.homeDir, { recursive: true });
  fs.mkdirSync(paths.n8nWorkspaceDir, { recursive: true });
  fs.mkdirSync(paths.managedN8nDir, { recursive: true });
  return paths.homeDir;
}
