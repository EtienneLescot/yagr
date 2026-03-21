import fs from 'node:fs';
import path from 'node:path';
import { YagrN8nConfigService } from '../config/n8n-config-service.js';
import { ensureYagrHomeDir, getYagrPaths } from '../config/yagr-home.js';

export interface ManagedN8nInstanceState {
  strategy: 'docker' | 'direct';
  image?: string;
  port: number;
  url: string;
  composeFile?: string;
  envFile?: string;
  dataDir: string;
  logFile?: string;
  pid?: number;
  status: 'created' | 'starting' | 'ready' | 'stopped' | 'error';
  bootstrapStage: 'runtime-only' | 'owner-pending' | 'api-key-pending' | 'connected';
  createdAt: string;
  updatedAt: string;
  lastError?: string;
}

export interface ManagedN8nPaths {
  rootDir: string;
  stateFile: string;
  composeFile: string;
  envFile: string;
  dataDir: string;
  logFile: string;
}

export function getManagedN8nPaths(): ManagedN8nPaths {
  const { managedN8nDir } = getYagrPaths();
  return {
    rootDir: managedN8nDir,
    stateFile: path.join(managedN8nDir, 'instance.json'),
    composeFile: path.join(managedN8nDir, 'compose.yaml'),
    envFile: path.join(managedN8nDir, '.env'),
    dataDir: path.join(managedN8nDir, 'data'),
    logFile: path.join(managedN8nDir, 'runtime.log'),
  };
}

export function ensureManagedN8nDirs(): ManagedN8nPaths {
  ensureYagrHomeDir();
  const paths = getManagedN8nPaths();
  fs.mkdirSync(paths.rootDir, { recursive: true });
  fs.mkdirSync(paths.dataDir, { recursive: true });
  return paths;
}

export function readManagedN8nState(): ManagedN8nInstanceState | undefined {
  const { stateFile } = getManagedN8nPaths();
  if (!fs.existsSync(stateFile)) {
    return undefined;
  }

  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as ManagedN8nInstanceState;
  } catch {
    return undefined;
  }
}

export function writeManagedN8nState(state: ManagedN8nInstanceState): ManagedN8nInstanceState {
  const paths = ensureManagedN8nDirs();
  fs.writeFileSync(paths.stateFile, `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

export function buildManagedN8nState(input: {
  strategy?: ManagedN8nInstanceState['strategy'];
  image: string;
  port: number;
  status?: ManagedN8nInstanceState['status'];
  bootstrapStage?: ManagedN8nInstanceState['bootstrapStage'];
  lastError?: string;
  pid?: number;
  logFile?: string;
}): ManagedN8nInstanceState {
  const paths = ensureManagedN8nDirs();
  const now = new Date().toISOString();

  return {
    strategy: input.strategy ?? 'docker',
    image: input.image || undefined,
    port: input.port,
    url: `http://127.0.0.1:${input.port}`,
    composeFile: input.strategy === 'direct' ? undefined : paths.composeFile,
    envFile: input.strategy === 'direct' ? undefined : paths.envFile,
    dataDir: paths.dataDir,
    logFile: input.logFile ?? paths.logFile,
    pid: input.pid,
    status: input.status ?? 'created',
    bootstrapStage: input.bootstrapStage ?? 'runtime-only',
    createdAt: now,
    updatedAt: now,
    lastError: input.lastError,
  };
}

export function updateManagedN8nState(
  updater: (current: ManagedN8nInstanceState | undefined) => ManagedN8nInstanceState,
): ManagedN8nInstanceState {
  const current = readManagedN8nState();
  const next = updater(current);
  next.updatedAt = new Date().toISOString();
  if (!next.createdAt) {
    next.createdAt = next.updatedAt;
  }
  return writeManagedN8nState(next);
}

export function markManagedN8nBootstrapStage(
  url: string,
  bootstrapStage: ManagedN8nInstanceState['bootstrapStage'],
): ManagedN8nInstanceState | undefined {
  const current = readManagedN8nState();
  if (!current || current.url !== url) {
    return undefined;
  }

  return updateManagedN8nState((state) => ({
    ...(state ?? current),
    bootstrapStage,
    status: bootstrapStage === 'connected' ? 'ready' : (state ?? current).status,
    lastError: undefined,
  }));
}

export function resolveManagedN8nBootstrapStage(url: string): ManagedN8nInstanceState['bootstrapStage'] {
  const configService = new YagrN8nConfigService();
  const localConfig = configService.getLocalConfig();
  const configuredHost = normalizeUrlOrigin(localConfig.host);
  const managedHost = normalizeUrlOrigin(url);

  if (
    localConfig.runtimeSource === 'managed-local'
    && configuredHost
    && managedHost
    && configuredHost === managedHost
    && localConfig.projectId
    && localConfig.projectName
    && configService.getApiKey(localConfig.host ?? '')
  ) {
    return 'connected';
  }

  return readManagedN8nState()?.bootstrapStage ?? 'owner-pending';
}

function normalizeUrlOrigin(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }

  try {
    return new URL(url).origin;
  } catch {
    return url.replace(/\/$/, '');
  }
}
