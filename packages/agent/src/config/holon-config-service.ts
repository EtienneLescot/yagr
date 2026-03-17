import Conf from 'conf';
import fs from 'node:fs';
import path from 'node:path';
import { ensureHolonHomeDir, getHolonHomeDir } from './holon-home.js';
import type { GatewaySurface } from '../gateway/types.js';
import type { HolonModelProvider } from '../llm/create-language-model.js';

export function normalizeGatewaySurfaces(surfaces: readonly string[] | undefined): GatewaySurface[] {
  const normalized: GatewaySurface[] = [];

  for (const surface of surfaces ?? []) {
    if ((surface === 'telegram' || surface === 'webui' || surface === 'whatsapp') && !normalized.includes(surface)) {
      normalized.push(surface);
    }
  }

  return normalized;
}

export interface HolonTelegramLinkedChat {
  chatId: string;
  userId?: string;
  username?: string;
  firstName?: string;
  linkedAt: string;
  lastSeenAt?: string;
}

export interface HolonTelegramConfig {
  botUsername?: string;
  onboardingToken?: string;
  linkedChats?: HolonTelegramLinkedChat[];
}

export interface HolonGatewayConfig {
  enabledSurfaces?: GatewaySurface[];
}

export interface HolonLocalConfig {
  provider?: HolonModelProvider;
  model?: string;
  baseUrl?: string;
  gateway?: HolonGatewayConfig;
  telegram?: HolonTelegramConfig;
}

export class HolonConfigService {
  private readonly globalStore: Conf;
  private readonly localConfigPath: string;

  constructor() {
    ensureHolonHomeDir();
    this.globalStore = new Conf({
      projectName: 'holon',
      configName: 'credentials',
    });
    this.localConfigPath = path.join(getHolonHomeDir(), 'holon-config.json');
  }

  getLocalConfig(): HolonLocalConfig {
    if (!fs.existsSync(this.localConfigPath)) {
      return {};
    }

    try {
      const content = fs.readFileSync(this.localConfigPath, 'utf-8');
      return JSON.parse(content) as HolonLocalConfig;
    } catch {
      return {};
    }
  }

  saveLocalConfig(config: HolonLocalConfig): void {
    fs.writeFileSync(this.localConfigPath, JSON.stringify(config, null, 2));
  }

  updateLocalConfig(updater: (config: HolonLocalConfig) => HolonLocalConfig): HolonLocalConfig {
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

  setEnabledGatewaySurfaces(surfaces: GatewaySurface[]): HolonLocalConfig {
    const nextSurfaces = normalizeGatewaySurfaces(surfaces);
    return this.updateLocalConfig((localConfig) => ({
      ...localConfig,
      gateway: {
        ...localConfig.gateway,
        enabledSurfaces: nextSurfaces,
      },
    }));
  }

  enableGatewaySurface(surface: GatewaySurface): HolonLocalConfig {
    const nextSurfaces = normalizeGatewaySurfaces([...this.getEnabledGatewaySurfaces(), surface]);
    return this.setEnabledGatewaySurfaces(nextSurfaces);
  }

  disableGatewaySurface(surface: GatewaySurface): HolonLocalConfig {
    const nextSurfaces = this.getEnabledGatewaySurfaces().filter((entry) => entry !== surface);
    return this.setEnabledGatewaySurfaces(nextSurfaces);
  }

  getApiKey(provider: HolonModelProvider): string | undefined {
    const credentials = (this.globalStore.get('providers') as Record<string, string> | undefined) ?? {};
    return credentials[provider];
  }

  saveApiKey(provider: HolonModelProvider, apiKey: string): void {
    const credentials = (this.globalStore.get('providers') as Record<string, string> | undefined) ?? {};
    credentials[provider] = apiKey;
    this.globalStore.set('providers', credentials);
  }

  hasApiKey(provider: HolonModelProvider): boolean {
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