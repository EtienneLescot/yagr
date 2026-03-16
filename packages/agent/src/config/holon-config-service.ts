import Conf from 'conf';
import fs from 'node:fs';
import path from 'node:path';
import type { HolonModelProvider } from '../llm/create-language-model.js';

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

export interface HolonLocalConfig {
  provider?: HolonModelProvider;
  model?: string;
  baseUrl?: string;
  telegram?: HolonTelegramConfig;
}

export class HolonConfigService {
  private readonly globalStore: Conf;
  private readonly localConfigPath: string;

  constructor() {
    this.globalStore = new Conf({
      projectName: 'holon',
      configName: 'credentials',
    });
    this.localConfigPath = path.join(process.cwd(), 'holon-config.json');
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