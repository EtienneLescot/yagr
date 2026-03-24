import Conf from 'conf';
import fs from 'node:fs';
import path from 'node:path';
import { createFallbackInstanceIdentifier, createProjectSlug, resolveInstanceIdentifier } from 'n8nac';
import { ensureYagrHomeDir, getYagrN8nWorkspaceDir, getYagrPaths } from './yagr-home.js';

export interface YagrN8nLocalConfig {
  host?: string;
  syncFolder?: string;
  projectId?: string;
  projectName?: string;
  instanceIdentifier?: string;
  customNodesPath?: string;
  runtimeSource?: 'managed-local' | 'external';
}

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

  return path.join(resolvedSyncFolder, instanceIdentifier, createProjectSlug(projectName));
}

function sanitizeRuntimeValue(value: string | undefined): string | undefined {
  const trimmed = String(value ?? '').trim().replace(/^['"]|['"]$/g, '');
  return trimmed || undefined;
}

export function resolveN8nRuntimeState(
  configService: Pick<YagrN8nConfigService, 'getLocalConfig' | 'getApiKey'>,
  env: NodeJS.ProcessEnv = process.env,
  options: ResolveN8nRuntimeStateOptions = {},
): YagrResolvedN8nRuntimeState {
  const localConfig = configService.getLocalConfig();
  const envHost = options.allowEnvironmentFallback ? sanitizeRuntimeValue(env.N8N_HOST) : undefined;
  const host = sanitizeRuntimeValue(localConfig.host) ?? envHost;
  const storedApiKey = host ? sanitizeRuntimeValue(configService.getApiKey(host)) : undefined;
  const envApiKey = options.allowEnvironmentFallback ? sanitizeRuntimeValue(env.N8N_API_KEY) : undefined;
  const apiKey = storedApiKey ?? envApiKey;
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
  private readonly legacyCredentialsPath: string;

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
    this.legacyCredentialsPath = paths.legacyN8nCredentialsPath;
    this.migrateLegacyCredentials();
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
    fs.writeFileSync(this.localConfigPath, JSON.stringify(config, null, 2));
  }

  saveBootstrapState(
    host: string,
    syncFolder = 'workflows',
    runtimeSource: YagrN8nLocalConfig['runtimeSource'] = 'external',
  ): void {
    const current = this.getLocalConfig();
    const bootstrapState: YagrN8nLocalConfig = {
      host,
      syncFolder,
      runtimeSource,
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

  private migrateLegacyCredentials(): void {
    if (this.globalStore.path === this.legacyCredentialsPath) {
      return;
    }

    const currentHosts = this.globalStore.get('hosts') ?? {};
    if (Object.keys(currentHosts).length > 0 || !fs.existsSync(this.legacyCredentialsPath)) {
      return;
    }

    try {
      const content = JSON.parse(fs.readFileSync(this.legacyCredentialsPath, 'utf-8')) as N8nCredentialStore;
      const legacyHosts = content.hosts ?? {};
      if (Object.keys(legacyHosts).length > 0) {
        this.globalStore.set('hosts', legacyHosts);
      }
    } catch {
      // Ignore malformed legacy files and start fresh in the Yagr home.
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
