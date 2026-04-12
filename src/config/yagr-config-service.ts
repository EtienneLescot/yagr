import Conf from 'conf';
import fs from 'node:fs';
import { ensureYagrHomeDir, getYagrPaths } from './yagr-home.js';
import type { GatewaySurface } from '../gateway/types.js';
import type { YagrModelProvider } from '../llm/provider-registry.js';

export function normalizeGatewaySurfaces(surfaces: readonly string[] | undefined): GatewaySurface[] {
  const normalized: GatewaySurface[] = [];

  for (const surface of surfaces ?? []) {
    if ((surface === 'telegram' || surface === 'webui' || surface === 'whatsapp') && !normalized.includes(surface)) {
      normalized.push(surface);
    }
  }

  return normalized;
}

export interface YagrTelegramLinkedChat {
  chatId: string;
  userId?: string;
  username?: string;
  firstName?: string;
  linkedAt: string;
  lastSeenAt?: string;
}

export interface YagrTelegramConfig {
  botUsername?: string;
  onboardingToken?: string;
  linkedChats?: YagrTelegramLinkedChat[];
}

export interface YagrGatewayConfig {
  enabledSurfaces?: GatewaySurface[];
  webui?: {
    host?: string;
    port?: number;
  };
}

export type YagrLlmProxyMode = 'local' | 'docker' | 'tunnel';

export interface YagrLlmProxyConfig {
  enabled: boolean;
  mode: YagrLlmProxyMode;
  /** Target URL computed at onboard time (may be docker host or tunnel). Used to build the credential URL. */
  credentialBaseUrl: string;
  /** URL last confirmed written into the n8n credential by yagr_proxy_relay_start. Used to detect stale credentials. */
  confirmedCredentialBaseUrl?: string;
  /** docker bridge gateway address, only set when mode=docker */
  dockerHostAddress?: string;
  /** Cloudflare tunnel URL, only set when mode=tunnel */
  tunnelUrl?: string;
}

export interface N8nTunnelConfig {
  /** Whether the user has enabled the n8n exposure tunnel. */
  enabled: boolean;
  /** The local n8n URL being tunneled (e.g. http://127.0.0.1:5678). */
  targetUrl: string;
  /** Last known public Cloudflare URL — may be stale if the daemon was restarted. */
  publicUrl?: string;
}

export type YagrShellCommandsMode = 'allow-all' | 'user-approved';

export interface YagrShellCommandsConfig {
  /** 'allow-all': every command is allowed. 'user-approved': only approved[] prefixes pass. */
  mode: YagrShellCommandsMode;
  /** Prefix list used when mode is 'user-approved'. Each entry is matched against the start of the command. */
  approved?: string[];
}

export interface YagrLocalConfig {
  provider?: YagrModelProvider;
  model?: string;
  baseUrl?: string;
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  gateway?: YagrGatewayConfig;
  telegram?: YagrTelegramConfig;
  llmProxy?: YagrLlmProxyConfig;
  shellCommands?: YagrShellCommandsConfig;
  n8nTunnel?: N8nTunnelConfig;
}

export interface YagrConfigStoreLike {
  getLocalConfig(): YagrLocalConfig;
  saveLocalConfig(config: YagrLocalConfig): void;
  updateLocalConfig(updater: (config: YagrLocalConfig) => YagrLocalConfig): YagrLocalConfig;
  getEnabledGatewaySurfaces(): GatewaySurface[];
  setEnabledGatewaySurfaces(surfaces: GatewaySurface[]): YagrLocalConfig;
  enableGatewaySurface(surface: GatewaySurface): YagrLocalConfig;
  disableGatewaySurface(surface: GatewaySurface): YagrLocalConfig;
  getApiKey(provider: YagrModelProvider): string | undefined;
  saveApiKey(provider: YagrModelProvider, apiKey: string): void;
  getTelegramBotToken(): string | undefined;
  saveTelegramBotToken(botToken: string): void;
  clearTelegramBotToken(): void;
  getLlmProxyConfig(): YagrLlmProxyConfig | undefined;
  isLlmProxyEnabled(): boolean;
  saveLlmProxyConfig(config: YagrLlmProxyConfig): YagrLocalConfig;
  updateLlmProxyCredentialBaseUrl(credentialBaseUrl: string): void;
  getN8nTunnelConfig(): N8nTunnelConfig | undefined;
  saveN8nTunnelConfig(config: N8nTunnelConfig): YagrLocalConfig;
  clearN8nTunnelConfig(): YagrLocalConfig;
  clearLocalConfig?(): void;
  clearAllApiKeys?(): void;
}

interface YagrCredentialStore {
  providers?: Record<string, string>;
  telegram?: {
    botToken?: string;
  };
}

export class YagrConfigService {
  private readonly globalStore: Conf<YagrCredentialStore>;
  private readonly localConfigPath: string;
  private readonly legacyCredentialsPath: string;

  constructor() {
    const paths = getYagrPaths();
    ensureYagrHomeDir();
    this.globalStore = new Conf<YagrCredentialStore>({
      cwd: paths.homeDir,
      configName: 'credentials',
    });
    this.localConfigPath = paths.yagrConfigPath;
    this.legacyCredentialsPath = paths.legacyYagrCredentialsPath;
    this.migrateLegacyCredentials();
  }

  getLocalConfig(): YagrLocalConfig {
    if (!fs.existsSync(this.localConfigPath)) {
      return {};
    }

    try {
      const content = fs.readFileSync(this.localConfigPath, 'utf-8');
      return JSON.parse(content) as YagrLocalConfig;
    } catch {
      return {};
    }
  }

  saveLocalConfig(config: YagrLocalConfig): void {
    fs.writeFileSync(this.localConfigPath, JSON.stringify(config, null, 2));
  }

  updateLocalConfig(updater: (config: YagrLocalConfig) => YagrLocalConfig): YagrLocalConfig {
    const nextConfig = updater(this.getLocalConfig());
    this.saveLocalConfig(nextConfig);
    return nextConfig;
  }

  getEnabledGatewaySurfaces(): GatewaySurface[] {
    const localConfig = this.getLocalConfig();
    if (Array.isArray(localConfig.gateway?.enabledSurfaces)) {
      return normalizeGatewaySurfaces(localConfig.gateway.enabledSurfaces);
    }

    if (localConfig.telegram) {
      return ['telegram'];
    }

    return [];
  }

  setEnabledGatewaySurfaces(surfaces: GatewaySurface[]): YagrLocalConfig {
    const nextSurfaces = normalizeGatewaySurfaces(surfaces);
    return this.updateLocalConfig((localConfig) => ({
      ...localConfig,
      gateway: {
        ...localConfig.gateway,
        enabledSurfaces: nextSurfaces,
      },
    }));
  }

  enableGatewaySurface(surface: GatewaySurface): YagrLocalConfig {
    const nextSurfaces = normalizeGatewaySurfaces([...this.getEnabledGatewaySurfaces(), surface]);
    return this.setEnabledGatewaySurfaces(nextSurfaces);
  }

  disableGatewaySurface(surface: GatewaySurface): YagrLocalConfig {
    const nextSurfaces = this.getEnabledGatewaySurfaces().filter((entry) => entry !== surface);
    return this.setEnabledGatewaySurfaces(nextSurfaces);
  }

  getApiKey(provider: YagrModelProvider): string | undefined {
    const credentials = (this.globalStore.get('providers') as Record<string, string> | undefined) ?? {};
    return credentials[provider];
  }

  saveApiKey(provider: YagrModelProvider, apiKey: string): void {
    const credentials = (this.globalStore.get('providers') as Record<string, string> | undefined) ?? {};
    credentials[provider] = apiKey;
    this.globalStore.set('providers', credentials);
  }

  hasApiKey(provider: YagrModelProvider): boolean {
    return Boolean(this.getApiKey(provider));
  }

  clearLocalConfig(): void {
    if (fs.existsSync(this.localConfigPath)) {
      fs.unlinkSync(this.localConfigPath);
    }
  }

  clearAllApiKeys(): void {
    this.globalStore.set('providers', {});
  }

  getTelegramBotToken(): string | undefined {
    return this.globalStore.get('telegram.botToken') as string | undefined;
  }

  saveTelegramBotToken(botToken: string): void {
    this.globalStore.set('telegram.botToken', botToken);
  }

  clearTelegramBotToken(): void {
    this.globalStore.delete('telegram.botToken');
  }

  getLlmProxyConfig(): YagrLlmProxyConfig | undefined {
    return this.getLocalConfig().llmProxy;
  }

  isLlmProxyEnabled(): boolean {
    return this.getLocalConfig().llmProxy?.enabled === true;
  }

  saveLlmProxyConfig(config: YagrLlmProxyConfig): YagrLocalConfig {
    return this.updateLocalConfig((localConfig) => ({ ...localConfig, llmProxy: config }));
  }

  updateLlmProxyCredentialBaseUrl(credentialBaseUrl: string): void {
    this.updateLocalConfig((localConfig) => ({
      ...localConfig,
      llmProxy: localConfig.llmProxy ? { ...localConfig.llmProxy, confirmedCredentialBaseUrl: credentialBaseUrl } : localConfig.llmProxy,
    }));
  }

  getN8nTunnelConfig(): N8nTunnelConfig | undefined {
    return this.getLocalConfig().n8nTunnel;
  }

  saveN8nTunnelConfig(config: N8nTunnelConfig): YagrLocalConfig {
    return this.updateLocalConfig((localConfig) => ({ ...localConfig, n8nTunnel: config }));
  }

  clearN8nTunnelConfig(): YagrLocalConfig {
    return this.updateLocalConfig(({ n8nTunnel: _removed, ...rest }) => rest);
  }

  private migrateLegacyCredentials(): void {
    if (this.globalStore.path === this.legacyCredentialsPath) {
      return;
    }

    const currentProviders = this.globalStore.get('providers') ?? {};
    const currentBotToken = this.globalStore.get('telegram.botToken');
    if ((Object.keys(currentProviders).length > 0 || currentBotToken) || !fs.existsSync(this.legacyCredentialsPath)) {
      return;
    }

    try {
      const content = JSON.parse(fs.readFileSync(this.legacyCredentialsPath, 'utf-8')) as YagrCredentialStore;
      if (content.providers && Object.keys(content.providers).length > 0) {
        this.globalStore.set('providers', content.providers);
      }
      if (content.telegram?.botToken) {
        this.globalStore.set('telegram.botToken', content.telegram.botToken);
      }
    } catch {
      // Ignore malformed legacy files and start fresh in the Yagr home.
    }
  }
}
