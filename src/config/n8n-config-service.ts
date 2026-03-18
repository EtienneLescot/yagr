import Conf from 'conf';
import fs from 'node:fs';
import { createFallbackInstanceIdentifier, resolveInstanceIdentifier } from 'n8nac';
import { ensureYagrHomeDir, getYagrPaths } from './yagr-home.js';

export interface YagrN8nLocalConfig {
  host?: string;
  syncFolder?: string;
  projectId?: string;
  projectName?: string;
  instanceIdentifier?: string;
  customNodesPath?: string;
}

interface N8nCredentialStore {
  hosts?: Record<string, string>;
}

export class YagrN8nConfigService {
  private readonly globalStore: Conf<N8nCredentialStore>;
  private readonly localConfigPath: string;
  private readonly legacyCredentialsPath: string;

  constructor() {
    const paths = getYagrPaths();
    ensureYagrHomeDir();
    this.globalStore = new Conf<N8nCredentialStore>({
      cwd: paths.homeDir,
      configName: 'n8n-credentials',
    });
    this.localConfigPath = paths.n8nConfigPath;
    this.legacyCredentialsPath = paths.legacyN8nCredentialsPath;
    this.migrateLegacyCredentials();
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

  saveBootstrapState(host: string, syncFolder = 'workflows'): void {
    const current = this.getLocalConfig();
    const bootstrapState: YagrN8nLocalConfig = {
      host,
      syncFolder,
    };

    if (current.customNodesPath) {
      bootstrapState.customNodesPath = current.customNodesPath;
    }

    this.saveLocalConfig(bootstrapState);
  }

  getApiKey(host: string): string | undefined {
    const credentials = this.globalStore.get('hosts') ?? {};
    return credentials[this.normalizeHost(host)];
  }

  saveApiKey(host: string, apiKey: string): void {
    const credentials = this.globalStore.get('hosts') ?? {};
    credentials[this.normalizeHost(host)] = apiKey;
    this.globalStore.set('hosts', credentials);
  }

  clearLocalConfig(): void {
    if (fs.existsSync(this.localConfigPath)) {
      fs.unlinkSync(this.localConfigPath);
    }
  }

  clearAllApiKeys(): void {
    this.globalStore.set('hosts', {});
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
}