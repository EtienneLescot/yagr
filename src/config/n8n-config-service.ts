import Conf from 'conf';
import fs from 'node:fs';
import path from 'node:path';
import {
  ConfigService,
  createFallbackInstanceIdentifier,
  createProjectSlug,
  resolveInstanceIdentifier,
} from 'n8nac';
import { ensureYagrHomeDir, getYagrN8nWorkspaceDir, getYagrPaths } from './yagr-home.js';

export type YagrN8nInstanceProfile =
  | 'yagr-managed-docker'
  | 'custom-local-docker'
  | 'custom-local-direct'
  | 'custom-cloud';

export interface YagrN8nLocalConfig {
  host?: string;
  syncFolder?: string;
  projectId?: string;
  projectName?: string;
  instanceIdentifier?: string;
  customNodesPath?: string;
  instanceProfile?: YagrN8nInstanceProfile;
}

const YAGR_LOCAL_CONFIG_KEYS = new Set([
  'host',
  'syncFolder',
  'projectId',
  'projectName',
  'instanceIdentifier',
  'customNodesPath',
  'instanceProfile',
]);

export interface YagrResolvedN8nRuntimeState {
  host?: string;
  apiKey?: string;
  syncFolder?: string;
  projectId?: string;
  projectName?: string;
  instanceIdentifier?: string;
  workflowDir?: string;
  credentialsAvailable: boolean;
  projectConfigured: boolean;
  initialized: boolean;
}

export interface ResolveN8nRuntimeStateOptions {
  allowEnvironmentFallback?: boolean;
}

interface N8nCredentialStore {
  hosts?: Record<string, string>;
}

/**
 * Computes the fully-qualified workflow directory for the current config:
 *   <syncFolder>/<instanceIdentifier>/<projectSlug>
 *
 * Returns undefined when any required field is missing (e.g. during bootstrap).
 * This is the single source of truth for this path calculation.
 */
export function resolveWorkflowDir(config: YagrN8nLocalConfig): string | undefined {
  const { syncFolder, instanceIdentifier, projectName } = config;
  if (!syncFolder || !instanceIdentifier || !projectName) {
    return undefined;
  }

  const workspaceDir = getYagrN8nWorkspaceDir();
  const resolvedSyncFolder = path.isAbsolute(syncFolder)
    ? syncFolder
    : path.join(workspaceDir, syncFolder);

  // Strip characters that are invalid in Windows path components (colon, etc.)
  // Identifiers stored on Linux/macOS may contain ':' from IP:port slugs.
  const safeInstanceId = instanceIdentifier.replace(/[:<>"|?*]/g, '_');
  return path.join(resolvedSyncFolder, safeInstanceId, createProjectSlug(projectName));
}

function sanitizeRuntimeValue(value: string | undefined): string | undefined {
  const trimmed = String(value ?? '').trim().replace(/^['"]|['"]$/g, '');
  return trimmed || undefined;
}

function preferEnvironmentCredentials(env: NodeJS.ProcessEnv): boolean {
  return /^(1|true|yes|on)$/i.test(String(env.YAGR_PREFER_ENV_CREDENTIALS || '').trim());
}

export function resolveN8nRuntimeState(
  configService: Pick<YagrN8nConfigService, 'getLocalConfig' | 'getApiKey'>,
  env: NodeJS.ProcessEnv = process.env,
  options: ResolveN8nRuntimeStateOptions = {},
): YagrResolvedN8nRuntimeState {
  const localConfig = configService.getLocalConfig();
  const envHost = options.allowEnvironmentFallback ? sanitizeRuntimeValue(env.N8N_HOST) : undefined;
  const preferEnv = preferEnvironmentCredentials(env);
  const host = preferEnv ? (envHost ?? sanitizeRuntimeValue(localConfig.host)) : (sanitizeRuntimeValue(localConfig.host) ?? envHost);
  const storedApiKey = preferEnv ? undefined : (host ? sanitizeRuntimeValue(configService.getApiKey(host)) : undefined);
  const envApiKey = options.allowEnvironmentFallback ? sanitizeRuntimeValue(env.N8N_API_KEY) : undefined;
  const apiKey = envApiKey ?? storedApiKey;
  const projectConfigured = Boolean(
    host
    && localConfig.syncFolder
    && localConfig.projectId
    && localConfig.projectName,
  );

  return {
    host,
    apiKey,
    syncFolder: localConfig.syncFolder,
    projectId: localConfig.projectId,
    projectName: localConfig.projectName,
    instanceIdentifier: localConfig.instanceIdentifier,
    workflowDir: resolveWorkflowDir(localConfig),
    credentialsAvailable: Boolean(host && apiKey),
    projectConfigured,
    initialized: Boolean(projectConfigured && apiKey),
  };
}

export class YagrN8nConfigService {
  private readonly globalStore: Conf<N8nCredentialStore>;
  private readonly compatibilityStore: Conf<N8nCredentialStore>;
  private readonly localConfigPath: string;

  constructor() {
    const paths = getYagrPaths();
    ensureYagrHomeDir();
    this.globalStore = new Conf<N8nCredentialStore>({
      cwd: paths.homeDir,
      configName: 'n8n-credentials',
    });
    this.compatibilityStore = new Conf<N8nCredentialStore>({
      projectName: 'n8nac',
      configName: 'credentials',
    });
    this.localConfigPath = paths.n8nConfigPath;
    this.syncCompatibilityCredentials();
  }

  getLocalConfig(): YagrN8nLocalConfig {
    if (!fs.existsSync(this.localConfigPath)) {
      return {};
    }

    try {
      const content = fs.readFileSync(this.localConfigPath, 'utf-8');
      return JSON.parse(content) as YagrN8nLocalConfig;
    } catch {
      return {};
    }
  }

  saveLocalConfig(config: YagrN8nLocalConfig): void {
    const existing = this.readRawLocalConfig();
    for (const key of YAGR_LOCAL_CONFIG_KEYS) {
      delete existing[key];
    }

    fs.writeFileSync(this.localConfigPath, JSON.stringify({
      ...existing,
      ...config,
    }, null, 2));
  }

  saveBootstrapState(
    host: string,
    syncFolder = 'workflows',
    instanceProfile?: YagrN8nLocalConfig['instanceProfile'],
  ): void {
    const current = this.getLocalConfig();
    const bootstrapState: YagrN8nLocalConfig = {
      host,
      syncFolder,
      instanceProfile,
    };

    if (current.customNodesPath) {
      bootstrapState.customNodesPath = current.customNodesPath;
    }

    this.saveLocalConfig(bootstrapState);
  }

  getApiKey(host: string): string | undefined {
    const credentials = this.globalStore.get('hosts') ?? {};
    const normalizedHost = this.normalizeHost(host);
    if (credentials[normalizedHost]) {
      return credentials[normalizedHost];
    }

    const compatibilityCredentials = this.compatibilityStore.get('hosts') ?? {};
    return compatibilityCredentials[normalizedHost];
  }

  saveApiKey(host: string, apiKey: string): void {
    const credentials = this.globalStore.get('hosts') ?? {};
    const compatibilityCredentials = this.compatibilityStore.get('hosts') ?? {};
    const normalizedHost = this.normalizeHost(host);
    credentials[normalizedHost] = apiKey;
    compatibilityCredentials[normalizedHost] = apiKey;
    this.globalStore.set('hosts', credentials);
    this.compatibilityStore.set('hosts', compatibilityCredentials);
  }

  /**
   * n8nac resolves API keys with instanceProfiles[activeInstanceId] before hosts[].
   * Yagr only wrote `hosts`, so a stale per-instance secret (e.g. from an older CLI init)
   * could shadow the current key and make `npx n8nac credential …` return 401.
   * Mirror the active instance key into n8nac's ConfigService store.
   */
  syncN8nacCliApiKey(): void {
    ensureYagrHomeDir();
    const workspaceDir = getYagrN8nWorkspaceDir();
    const n8nacConfigPath = path.join(workspaceDir, 'n8nac-config.json');
    if (!fs.existsSync(n8nacConfigPath)) {
      return;
    }

    const host = String(this.getLocalConfig().host ?? '').trim();
    if (!host) {
      return;
    }

    const apiKey = this.getApiKey(host);
    if (!apiKey) {
      return;
    }

    try {
      const n8nacWorkspace = new ConfigService(workspaceDir);
      const workspace = n8nacWorkspace.getWorkspaceConfig();
      const activeId = workspace.activeInstanceId;
      if (typeof activeId !== 'string' || !activeId) {
        return;
      }
      n8nacWorkspace.saveApiKey(host, apiKey, activeId);
    } catch {
      /* best effort */
    }
  }

  /**
   * When a Cloudflare tunnel is active for a Yagr-managed n8n instance, the
   * n8nac workspace host URL needs to be updated so that webhook URLs
   * constructed by n8nac (which uses the configured host, not n8n's reported URL)
   * are correct.
   *
   * For Yagr-managed instances the instance identifier stays stable as
   * `"yagr-managed"` — only the host URL changes to the tunnel public URL.
   *
   * Best effort: errors are silently ignored so tunnel issues don't block startup.
   */
  syncN8nacHostUrl(tunnelPublicUrl: string): void {
    ensureYagrHomeDir();
    const workspaceDir = getYagrN8nWorkspaceDir();
    const n8nacConfigPath = path.join(workspaceDir, 'n8nac-config.json');
    if (!fs.existsSync(n8nacConfigPath)) {
      return;
    }

    try {
      const raw = fs.readFileSync(n8nacConfigPath, 'utf-8');
      const config = JSON.parse(raw) as {
        activeInstanceId?: string;
        instances?: Array<{ id: string; host?: string; name?: string }>;
      };

      const instances = config.instances ?? [];
      const activeId = config.activeInstanceId;
      const activeIndex = instances.findIndex((i) => i.id === activeId);
      if (activeIndex === -1) {
        return;
      }

      // Normalize both to `${protocol}//${host}` for reliable comparison.
      const tunnelOrigin = tunnelPublicUrl.replace(/\/+$/, '');
      const currentHost = instances[activeIndex].host?.replace(/\/+$/, '') ?? '';
      const currentRootHost = typeof (config as { host?: string }).host === 'string'
        ? (config as { host?: string }).host?.replace(/\/+$/, '') ?? ''
        : '';
      if (currentHost === tunnelOrigin && currentRootHost === tunnelOrigin) {
        return; // Already up to date.
      }

      instances[activeIndex] = { ...instances[activeIndex], host: tunnelPublicUrl };
      const updated = { ...config, instances, host: tunnelPublicUrl };
      fs.writeFileSync(n8nacConfigPath, JSON.stringify(updated, null, 2), 'utf-8');
    } catch {
      /* best effort */
    }
  }

  clearLocalConfig(): void {
    if (fs.existsSync(this.localConfigPath)) {
      fs.unlinkSync(this.localConfigPath);
    }
  }

  clearAllApiKeys(): void {
    this.globalStore.set('hosts', {});
    this.compatibilityStore.set('hosts', {});
  }

  async getOrCreateInstanceIdentifier(host: string): Promise<string> {
    const local = this.getLocalConfig();
    const apiKey = this.getApiKey(host);
    if (!apiKey) {
      throw new Error('API key not found');
    }

    try {
      const { identifier } = await resolveInstanceIdentifier({ host, apiKey });
      this.saveLocalConfig({
        ...local,
        host,
        instanceIdentifier: identifier,
      });
      return identifier;
    } catch {
      const fallbackIdentifier = createFallbackInstanceIdentifier(host, apiKey);
      this.saveLocalConfig({
        ...local,
        host,
        instanceIdentifier: fallbackIdentifier,
      });
      return fallbackIdentifier;
    }
  }

  private normalizeHost(host: string): string {
    try {
      const url = new URL(host);
      return url.origin;
    } catch {
      return host.replace(/\/$/, '');
    }
  }

  private readRawLocalConfig(): Record<string, unknown> {
    if (!fs.existsSync(this.localConfigPath)) {
      return {};
    }

    try {
      const content = fs.readFileSync(this.localConfigPath, 'utf-8');
      const parsed = JSON.parse(content) as unknown;
      return typeof parsed === 'object' && parsed !== null
        ? { ...(parsed as Record<string, unknown>) }
        : {};
    } catch {
      return {};
    }
  }

  private syncCompatibilityCredentials(): void {
    const homeHosts = this.globalStore.get('hosts') ?? {};
    const compatibilityHosts = this.compatibilityStore.get('hosts') ?? {};
    const mergedHosts = {
      ...compatibilityHosts,
      ...homeHosts,
    };

    if (Object.keys(mergedHosts).length === 0) {
      return;
    }

    this.globalStore.set('hosts', mergedHosts);
    this.compatibilityStore.set('hosts', mergedHosts);
  }
}
