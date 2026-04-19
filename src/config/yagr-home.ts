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
  deepAgentSessionsDir: string;
  workspaceInstructionsPath: string;
  memorySources: string;
  yagrConfigPath: string;
  yagrCredentialsPath: string;
  proxyRuntimeStatePath: string;
  n8nRelayStatePath: string;
  llmTunnelStatePath: string;
  n8nAuthTunnelStatePath: string;
  n8nConfigPath: string;
  n8nCredentialsPath: string;
  legacyYagrCredentialsDir: string;
  legacyYagrCredentialsPath: string;
  legacyN8nCredentialsDir: string;
  legacyN8nCredentialsPath: string;
}

// ---------------------------------------------------------------------------
// Bundled manager instructions path resolution
// ---------------------------------------------------------------------------

export function resolveBundledManagerInstructionsPath(launchDir: string = getYagrLaunchDir()): string | undefined {
  const candidates = [
    fileURLToPath(new URL('../manager-tooling/YAGENTS.md', import.meta.url)),
    fileURLToPath(new URL('../src/manager-tooling/YAGENTS.md', import.meta.url)),
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

// ---------------------------------------------------------------------------
// memory-sources.json — persistent list of context files injected into the
// agent's system prompt at every session start.
//
// Schema:
//   {
//     "core": "/abs/path/to/YAGENTS.md",     // manager instructions — updated on every startup
//     "contexts": ["/abs/path/to/..."]        // user-registered workspace contexts
//   }
// ---------------------------------------------------------------------------

interface MemorySourcesFile {
  core?: string;
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

/**
 * Returns all active memory source paths in load order:
 *   1. core (manager instructions)
 *   2. registered contexts (e.g. n8n-workspace/AGENTS.md)
 * Only paths that exist on disk are returned.
 */
export function getActiveMemorySourcePaths(memorySources?: string): string[] {
  const filePath = memorySources ?? path.join(getYagrHomeDir(), 'memory-sources.json');
  const data = readMemorySourcesFile(filePath);

  const candidates = [
    data.core,
    ...(data.contexts ?? []),
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);

  return candidates.filter((p) => fs.existsSync(p));
}

/**
 * Register or update the core manager instructions source.
 * Called on every startup from ensureYagrHomeDir so the path
 * stays current after package updates.
 */
export function registerCoreMemorySource(absolutePath: string, memorySources?: string): void {
  const filePath = memorySources ?? path.join(getYagrHomeDir(), 'memory-sources.json');
  const data = readMemorySourcesFile(filePath);
  if (data.core === absolutePath) return;
  writeMemorySourcesFile(filePath, { ...data, core: absolutePath });
}

/**
 * Register a workspace context file (e.g. n8n-workspace/AGENTS.md).
 * Idempotent: calling it twice with the same path is a no-op.
 */
export function registerContextMemorySource(absolutePath: string, memorySources?: string): void {
  const filePath = memorySources ?? path.join(getYagrHomeDir(), 'memory-sources.json');
  const data = readMemorySourcesFile(filePath);
  const contexts = data.contexts ?? [];
  if (contexts.includes(absolutePath)) return;
  writeMemorySourcesFile(filePath, { ...data, contexts: [...contexts, absolutePath] });
}

// ---------------------------------------------------------------------------

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

export function getYagrDeepAgentSessionsDir(): string {
  return path.join(getYagrHomeDir(), 'deepagent-sessions');
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
  const deepAgentSessionsDir = getYagrDeepAgentSessionsDir();
  const legacyYagrCredentialsPath = resolveLegacyConfStorePath('yagr', 'credentials');
  const legacyN8nCredentialsPath = resolveLegacyConfStorePath('n8nac', 'credentials');

  return {
    launchDir,
    homeDir,
    n8nWorkspaceDir,
    managedN8nDir,
    proxyRuntimeDir,
    accountAuthDir,
    deepAgentSessionsDir,
    workspaceInstructionsPath: path.join(n8nWorkspaceDir, 'AGENTS.md'),
    memorySources: path.join(homeDir, 'memory-sources.json'),
    yagrConfigPath: path.join(homeDir, 'yagr-config.json'),
    yagrCredentialsPath: path.join(homeDir, 'credentials.json'),
    proxyRuntimeStatePath: path.join(proxyRuntimeDir, 'state.json'),
    n8nRelayStatePath: path.join(proxyRuntimeDir, 'llm-relay.json'),
    llmTunnelStatePath: path.join(proxyRuntimeDir, 'llm-tunnel.json'),
    n8nAuthTunnelStatePath: path.join(proxyRuntimeDir, 'n8n-auth-tunnel.json'),
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
  fs.mkdirSync(paths.deepAgentSessionsDir, { recursive: true });
  return paths.homeDir;
}
