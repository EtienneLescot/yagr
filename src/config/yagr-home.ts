import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const initialLaunchDir = process.env.YAGR_LAUNCH_CWD ?? process.cwd();

export interface YagrPaths {
  launchDir: string;
  homeDir: string;
  n8nWorkspaceDir: string;
  managedN8nDir: string;
  proxyRuntimeDir: string;
  accountAuthDir: string;
  homeInstructionsPath: string;
  workspaceInstructionsPath: string;
  yagrConfigPath: string;
  yagrCredentialsPath: string;
  proxyRuntimeStatePath: string;
  n8nRelayStatePath: string;
  proxyTunnelStatePath: string;
  n8nConfigPath: string;
  n8nCredentialsPath: string;
  legacyYagrCredentialsDir: string;
  legacyYagrCredentialsPath: string;
  legacyN8nCredentialsDir: string;
  legacyN8nCredentialsPath: string;
}

function resolveBundledManagerInstructionsPath(launchDir: string = getYagrLaunchDir()): string | undefined {
  const moduleRelativeCandidates = [
    fileURLToPath(new URL('../manager-tooling/YAGENTS.md', import.meta.url)),
    fileURLToPath(new URL('../src/manager-tooling/YAGENTS.md', import.meta.url)),
  ];
  const candidates = [
    ...moduleRelativeCandidates,
    path.join(launchDir, 'node_modules', '@yagr', 'manager-tooling', 'YAGENTS.md'),
    path.join(launchDir, 'src', 'manager-tooling', 'YAGENTS.md'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function isManagedHomeInstructions(content: string): boolean {
  return content.includes('# Yagr Manager Instructions')
    && content.includes('Manager-specific behaviors available in this environment:');
}

function buildManagedHomeInstructionsContent(bundledContent: string, paths: YagrPaths): string {
  const runtimeContext = [
    '',
    'Runtime-specific path anchors for this environment:',
    '',
    `- Backend working directory: ${paths.homeDir}`,
    '',
  ].join('\n');

  return `${bundledContent.trim()}\n${runtimeContext}`;
}

function ensureHomeInstructionsSeeded(paths: YagrPaths): void {
  const bundledInstructionsPath = resolveBundledManagerInstructionsPath(paths.launchDir);
  if (!bundledInstructionsPath) {
    return;
  }

  try {
    const bundledContent = fs.readFileSync(bundledInstructionsPath, 'utf8').trim();
    if (!bundledContent) {
      return;
    }

    const nextContent = buildManagedHomeInstructionsContent(bundledContent, paths);

    if (!fs.existsSync(paths.homeInstructionsPath)) {
      fs.writeFileSync(paths.homeInstructionsPath, nextContent);
      return;
    }

    const existingContent = fs.readFileSync(paths.homeInstructionsPath, 'utf8');
    if (!isManagedHomeInstructions(existingContent)) {
      return;
    }

    if (existingContent !== nextContent) {
      fs.writeFileSync(paths.homeInstructionsPath, nextContent);
    }
  } catch {
    // Best effort only.
  }
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
  const proxyRuntimeDir = getYagrProxyRuntimeDir();
  const accountAuthDir = getYagrAccountAuthDir();
  const legacyYagrCredentialsPath = resolveLegacyConfStorePath('yagr', 'credentials');
  const legacyN8nCredentialsPath = resolveLegacyConfStorePath('n8nac', 'credentials');

  return {
    launchDir,
    homeDir,
    n8nWorkspaceDir,
    managedN8nDir,
    proxyRuntimeDir,
    accountAuthDir,
    homeInstructionsPath: path.join(homeDir, 'AGENTS.md'),
    workspaceInstructionsPath: path.join(n8nWorkspaceDir, 'AGENTS.md'),
    yagrConfigPath: path.join(homeDir, 'yagr-config.json'),
    yagrCredentialsPath: path.join(homeDir, 'credentials.json'),
    proxyRuntimeStatePath: path.join(proxyRuntimeDir, 'state.json'),
    n8nRelayStatePath: path.join(proxyRuntimeDir, 'llm-relay.json'),
    proxyTunnelStatePath: path.join(proxyRuntimeDir, 'proxy-tunnel.json'),
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
  fs.mkdirSync(paths.proxyRuntimeDir, { recursive: true });
  fs.mkdirSync(paths.accountAuthDir, { recursive: true });
  ensureHomeInstructionsSeeded(paths);
  return paths.homeDir;
}
