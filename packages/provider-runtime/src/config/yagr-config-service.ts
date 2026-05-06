import Conf from 'conf';
import fs from 'node:fs';
import { ensureYagrHomeDir, getYagrPaths } from './yagr-home.js';
import { normalizeProviderId, type YagrModelProvider } from '../provider-registry.js';

export type GatewaySurface = 'telegram' | 'webui' | 'whatsapp';

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

export type YagrShellCommandsMode = 'allow-all' | 'user-approved';

export interface YagrShellCommandsConfig {
  mode: YagrShellCommandsMode;
  approved?: string[];
}

export interface YagrLocalConfig {
  provider?: YagrModelProvider;
  model?: string;
  baseUrl?: string;
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  gateway?: YagrGatewayConfig;
  telegram?: YagrTelegramConfig;
  shellCommands?: YagrShellCommandsConfig;
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

  constructor() {
    const paths = getYagrPaths();
    ensureYagrHomeDir();
    this.globalStore = new Conf<YagrCredentialStore>({
      cwd: paths.homeDir,
      configName: 'credentials',
    });
    this.localConfigPath = paths.yagrConfigPath;
  }

  getLocalConfig(): YagrLocalConfig {
    if (!fs.existsSync(this.localConfigPath)) {
      return {};
    }

    try {
      const content = fs.readFileSync(this.localConfigPath, 'utf-8');
      return normalizeLocalConfig(JSON.parse(content) as YagrLocalConfig);
    } catch {
      return {};
    }
  }

  saveLocalConfig(config: YagrLocalConfig): void {
    fs.writeFileSync(this.localConfigPath, JSON.stringify(normalizeLocalConfig(config), null, 2));
  }

  updateLocalConfig(updater: (config: YagrLocalConfig) => YagrLocalConfig): YagrLocalConfig {
    const nextConfig = normalizeLocalConfig(updater(this.getLocalConfig()));
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
}

function normalizeLocalConfig(config: YagrLocalConfig): YagrLocalConfig {
  const provider = normalizeProviderId(config.provider);
  const legacyConfig = config as YagrLocalConfig & Record<string, unknown>;
  delete legacyConfig.llmProxy;
  delete legacyConfig.legacyTunnel;
  const rest = legacyConfig;
  return {
    ...rest,
    ...(provider ? { provider } : {}),
  };
}
