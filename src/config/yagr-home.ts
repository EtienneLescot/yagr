import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const initialLaunchDir = process.env.YAGR_LAUNCH_CWD ?? process.cwd();

export interface YagrPaths {
  launchDir: string;
  homeDir: string;
  proxyRuntimeDir: string;
  accountAuthDir: string;
  deepAgentSessionsDir: string;
  skillsDir: string;
  memorySources: string;
  yagrConfigPath: string;
  yagrCredentialsPath: string;
  proxyRuntimeStatePath: string;
  localOpenBridgeStatePath: string;
}

interface MemorySourcesFile {
  contexts?: string[];
}

function readMemorySourcesFile(memorySources: string): MemorySourcesFile {
  try {
    if (!fs.existsSync(memorySources)) return {};
    const raw = fs.readFileSync(memorySources, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as MemorySourcesFile;
    }
    return {};
  } catch {
    return {};
  }
}

function writeMemorySourcesFile(memorySources: string, data: MemorySourcesFile): void {
  try {
    fs.writeFileSync(memorySources, JSON.stringify(data, null, 2));
  } catch {
    // Best effort only.
  }
}

export function getActiveMemorySourcePaths(memorySources?: string): string[] {
  const filePath = memorySources ?? path.join(getYagrHomeDir(), 'memory-sources.json');
  const data = readMemorySourcesFile(filePath);
  const candidates = (data.contexts ?? []).filter((p): p is string => typeof p === 'string' && p.length > 0);
  return candidates.filter((p) => fs.existsSync(p));
}

export function registerContextMemorySource(absolutePath: string, memorySources?: string): void {
  const filePath = memorySources ?? path.join(getYagrHomeDir(), 'memory-sources.json');
  const data = readMemorySourcesFile(filePath);
  const contexts = data.contexts ?? [];
  if (contexts.includes(absolutePath)) return;
  writeMemorySourcesFile(filePath, { ...data, contexts: [...contexts, absolutePath] });
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

export function getYagrProxyRuntimeDir(): string {
  return path.join(getYagrHomeDir(), 'proxy-runtime');
}

export function getYagrAccountAuthDir(): string {
  return path.join(getYagrHomeDir(), 'oauth');
}

export function getYagrSessionsDir(): string {
  return path.join(getYagrHomeDir(), 'sessions');
}

export function getYagrMemoriesDir(): string {
  return path.join(getYagrHomeDir(), 'memories');
}

export function getYagrDeepAgentSessionsDir(): string {
  return path.join(getYagrHomeDir(), 'deepagent-sessions');
}

export function getYagrSkillsDir(): string {
  return path.join(getYagrHomeDir(), 'skills');
}

export function getYagrWorkspaceSkillsDir(contextRoot: string = getYagrLaunchDir()): string {
  return path.join(contextRoot, '.agents', 'skills');
}

export function getYagrPaths(): YagrPaths {
  const launchDir = getYagrLaunchDir();
  const homeDir = getYagrHomeDir();
  const proxyRuntimeDir = getYagrProxyRuntimeDir();
  const accountAuthDir = getYagrAccountAuthDir();
  const deepAgentSessionsDir = getYagrDeepAgentSessionsDir();
  const skillsDir = getYagrSkillsDir();

  return {
    launchDir,
    homeDir,
    proxyRuntimeDir,
    accountAuthDir,
    deepAgentSessionsDir,
    skillsDir,
    memorySources: path.join(homeDir, 'memory-sources.json'),
    yagrConfigPath: path.join(homeDir, 'yagr-config.json'),
    yagrCredentialsPath: path.join(homeDir, 'credentials.json'),
    proxyRuntimeStatePath: path.join(proxyRuntimeDir, 'state.json'),
    localOpenBridgeStatePath: path.join(proxyRuntimeDir, 'local-open-bridge.json'),
  };
}

export function ensureYagrHomeDir(): string {
  const paths = getYagrPaths();
  fs.mkdirSync(paths.homeDir, { recursive: true });
  fs.mkdirSync(paths.proxyRuntimeDir, { recursive: true });
  fs.mkdirSync(paths.accountAuthDir, { recursive: true });
  fs.mkdirSync(paths.deepAgentSessionsDir, { recursive: true });
  fs.mkdirSync(paths.skillsDir, { recursive: true });
  return paths.homeDir;
}
