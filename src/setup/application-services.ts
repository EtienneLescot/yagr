import { randomBytes } from 'node:crypto';
import {
  normalizeGatewaySurfaces,
  type YagrConfigService,
  type YagrConfigStoreLike,
  type YagrTelegramLinkedChat,
} from '../config/yagr-config-service.js';
import {
  getDefaultBaseUrlForProvider,
  providerNeedsBaseUrlInput,
  type YagrModelProvider,
} from '../llm/provider-registry.js';
import { prepareProviderRuntime } from '../llm/proxy-runtime.js';
import { fetchAvailableModels } from '../llm/provider-discovery.js';
import { resolveModelProvider } from '../llm/create-langchain-model.js';
import { beginGitHubCopilotAuth, completeGitHubCopilotAuth, ensureGitHubCopilotSession } from '../llm/copilot-account.js';
import { beginCodexAuth, beginCodexDeviceAuth, completeCodexAuth, completeCodexDeviceAuth, ensureOpenAiAccountSession, getOpenAiAccountSession } from '../llm/openai-account.js';
import type { GatewaySurface } from '../gateway/types.js';
import { getYagrSetupStatus, type YagrSetupStatus } from './status.js';

interface SetupApplicationServiceDependencies {
  resolveTelegramIdentity?: (botToken: string) => Promise<{ username: string; firstName: string }>;
  createOnboardingToken?: () => string;
  fetchAvailableModels?: (provider: YagrModelProvider, apiKey?: string, baseUrl?: string) => Promise<string[]>;
}

function defaultCreateOnboardingToken(): string {
  return randomBytes(18).toString('base64url');
}

function buildTelegramDeepLink(botUsername: string, onboardingToken: string): string {
  return `https://t.me/${botUsername}?start=${onboardingToken}`;
}

export class YagrSetupApplicationService {
  private readonly resolveTelegramIdentity: (botToken: string) => Promise<{ username: string; firstName: string }>;
  private readonly createOnboardingToken: () => string;
  private readonly fetchAvailableModelsRunner: (provider: YagrModelProvider, apiKey?: string, baseUrl?: string) => Promise<string[]>;

  constructor(
    private readonly yagrConfigService: YagrConfigStoreLike,
    dependencies: SetupApplicationServiceDependencies = {},
  ) {
    this.resolveTelegramIdentity = dependencies.resolveTelegramIdentity ?? (async () => {
      throw new Error('Telegram identity resolver is not configured.');
    });
    this.createOnboardingToken = dependencies.createOnboardingToken ?? defaultCreateOnboardingToken;
    this.fetchAvailableModelsRunner = dependencies.fetchAvailableModels ?? fetchAvailableModels;
  }

  getLlmDefaults() {
    const cfg = this.yagrConfigService.getLocalConfig();
    let initialProvider = cfg.provider;
    if (!initialProvider) {
      try { initialProvider = resolveModelProvider(undefined, this.yagrConfigService as YagrConfigService); } catch { initialProvider = undefined; }
    }
    return {
      provider: initialProvider,
      reasoningEffort: cfg.reasoningEffort,
      getApiKey: (prov: YagrModelProvider) => this.yagrConfigService.getApiKey(prov),
      getDefaultModel: (prov: YagrModelProvider) => cfg.provider === prov && cfg.model ? cfg.model : undefined,
      getBaseUrl: (prov: YagrModelProvider) => cfg.provider === prov ? cfg.baseUrl : getDefaultBaseUrlForProvider(prov),
      needsBaseUrl: (prov: YagrModelProvider) => providerNeedsBaseUrlInput(prov),
    };
  }

  async prepareProvider(provider: YagrModelProvider, apiKey?: string, baseUrl?: string) {
    const cfg = this.yagrConfigService.getLocalConfig();
    const prepared = await prepareProviderRuntime(provider, {
      apiKey,
      baseUrl: baseUrl ?? (cfg.provider === provider ? cfg.baseUrl : getDefaultBaseUrlForProvider(provider)),
    });

    return {
      ready: prepared.ready,
      apiKey: prepared.runtime?.apiKey,
      baseUrl: prepared.runtime?.baseUrl,
      models: prepared.runtime?.models,
      notes: prepared.notes,
      error: prepared.reason,
    };
  }

  async hasAccountSession(provider: YagrModelProvider): Promise<boolean> {
    if (provider === 'copilot-proxy') {
      return (await ensureGitHubCopilotSession()) !== undefined;
    }
    if (provider === 'openai-oauth') {
      return (await ensureOpenAiAccountSession()) !== undefined;
    }
    return false;
  }

  async startAccountAuth(provider: YagrModelProvider, authMethod?: 'browser' | 'headless') {
    if (provider === 'openai-oauth') {
      if (authMethod === 'headless') {
        const challenge = await beginCodexDeviceAuth();
        return {
          kind: 'input' as const,
          title: 'Connect OpenAI account (Device Code)',
          instructions: [
            `Open: ${challenge.verificationUriComplete ?? challenge.verificationUri}`,
            `Enter code: ${challenge.userCode}`,
            'Sign in with your ChatGPT account in the browser, then press Enter below to continue.',
            'If device login is not enabled for your account or workspace, go back and use browser sign-in instead.',
          ],
          placeholder: 'Press Enter after browser authorization',
          submitLabel: 'Continue after authorization',
          state: JSON.stringify({ method: 'device', ...challenge }),
        };
      }

      const challenge = await beginCodexAuth();
      const callbackHint = challenge.callbackServerStarted
        ? 'After signing in, Yagr captures the callback automatically.'
        : 'If the browser does not open, copy the URL above and visit it manually.';
      return {
        kind: 'input' as const,
        title: 'Connect OpenAI account (ChatGPT Plus)',
        instructions: [
          'Open this URL in your browser and sign in with your ChatGPT account:',
          challenge.authUrl,
          'This uses your ChatGPT subscription — no API credits are consumed.',
          callbackHint,
          'If the localhost callback cannot reach this terminal, paste the final callback URL here instead of waiting.',
        ],
        placeholder: 'Press Enter after signing in or paste callback URL',
        submitLabel: challenge.callbackServerStarted ? 'Continue after sign-in' : 'Submit redirect URL',
        state: JSON.stringify({ method: 'browser' }),
      };
    }

    if (provider === 'anthropic-proxy') {
      return {
        kind: 'input' as const,
        title: 'Connect Claude token',
        instructions: [
          'On a machine where Claude CLI is installed and logged in, run:',
          'claude setup-token',
          'Paste the generated setup-token below.',
        ],
        placeholder: 'Paste setup-token',
        submitLabel: 'Continue with setup-token',
      };
    }

    if (provider === 'copilot-proxy') {
      const challenge = await beginGitHubCopilotAuth();
      return {
        kind: 'input' as const,
        title: 'Complete GitHub Copilot OAuth',
        instructions: [
          `Open: ${challenge.verificationUri}`,
          `Enter code: ${challenge.userCode}`,
          'Authorize GitHub Copilot in your browser, then press Enter below to continue.',
        ],
        placeholder: 'Press Enter after browser authorization',
        submitLabel: 'Continue after authorization',
        state: JSON.stringify(challenge),
      };
    }

    return { kind: 'none' as const };
  }

  async completeAccountAuth(provider: YagrModelProvider, input: string, state?: string) {
    if (provider === 'openai-oauth') {
      const parsed = state ? JSON.parse(state) as { method?: 'browser' | 'device'; deviceAuthId?: string; userCode?: string; intervalMs?: number; expiresAt?: number } : undefined;
      if (parsed?.method === 'device') {
        if (!parsed.deviceAuthId || !parsed.userCode || !parsed.intervalMs || !parsed.expiresAt) {
          return { ok: false, error: 'OpenAI device flow state is missing.' };
        }
        await completeCodexDeviceAuth({
          deviceAuthId: parsed.deviceAuthId,
          userCode: parsed.userCode,
          intervalMs: parsed.intervalMs,
          expiresAt: parsed.expiresAt,
        });
      } else {
        await completeCodexAuth(input);
      }
      const session = getOpenAiAccountSession();
      if (!session) {
        throw new Error('OpenAI OAuth completed but could not read session. Try again.');
      }
      return { ok: true, apiKey: session.accessToken };
    }

    if (provider === 'copilot-proxy') {
      if (!state) {
        return { ok: false, error: 'GitHub Copilot device flow state is missing.' };
      }
      const challenge = JSON.parse(state) as { deviceCode: string; intervalMs: number; expiresAt: number };
      await completeGitHubCopilotAuth(challenge);
      return { ok: true };
    }

    if (provider === 'anthropic-proxy') {
      const credential = input.trim();
      if (!credential) {
        return { ok: false, error: 'Paste a Claude setup-token.' };
      }
      return { ok: true, apiKey: credential };
    }

    return { ok: true };
  }

  async fetchModels(provider: YagrModelProvider, apiKey?: string, baseUrlOverride?: string): Promise<string[]> {
    const cfg = this.yagrConfigService.getLocalConfig();
    const baseUrl = baseUrlOverride ?? (cfg.provider === provider ? cfg.baseUrl : getDefaultBaseUrlForProvider(provider));
    return this.fetchAvailableModelsRunner(provider, apiKey, baseUrl);
  }

  async fetchModelsForSelection(input: {
    provider: YagrModelProvider;
    apiKey?: string;
    baseUrl?: string;
    requiresApiKey: (provider: YagrModelProvider) => boolean;
  }): Promise<string[]> {
    const configuredLlm = this.yagrConfigService.getLocalConfig();
    const apiKey = input.apiKey ?? this.yagrConfigService.getApiKey(input.provider);
    if (input.requiresApiKey(input.provider) && !apiKey) {
      throw new Error(`No API key available for ${input.provider}. Save one first.`);
    }

    const baseUrl = input.baseUrl ?? (configuredLlm.provider === input.provider ? configuredLlm.baseUrl : undefined);
    return this.fetchAvailableModelsRunner(input.provider, apiKey, baseUrl);
  }

  getSetupStatus(options: { activeSurfaces?: GatewaySurface[] } = {}): YagrSetupStatus {
    return getYagrSetupStatus(this.yagrConfigService, options);
  }

  getTelegramStatus(): {
    configured: boolean;
    botUsername?: string;
    linkedChats: YagrTelegramLinkedChat[];
    deepLink?: string;
  } {
    const localConfig = this.yagrConfigService.getLocalConfig();
    const telegram = localConfig.telegram;
    const botToken = this.yagrConfigService.getTelegramBotToken();
    const linkedChats = telegram?.linkedChats ?? [];
    const deepLink = telegram?.botUsername && telegram.onboardingToken
      ? buildTelegramDeepLink(telegram.botUsername, telegram.onboardingToken)
      : undefined;

    return {
      configured: Boolean(botToken && telegram?.botUsername && telegram?.onboardingToken),
      botUsername: telegram?.botUsername,
      linkedChats,
      deepLink,
    };
  }

  getTelegramRuntimeConfig(overrideBotToken?: string) {
    const status = this.getTelegramStatus();
    const localConfig = this.yagrConfigService.getLocalConfig();
    return {
      status,
      botToken: overrideBotToken ?? this.yagrConfigService.getTelegramBotToken(),
      onboardingToken: localConfig.telegram?.onboardingToken,
    };
  }

  async buildWebUiSnapshot(input: {
    activeSurfaces: GatewaySurface[];
    webUiStatus: {
      configured: boolean;
      host: string;
      port: number;
      url: string;
    };
    selectableProviders: YagrModelProvider[];
  }): Promise<Record<string, unknown>> {
    const setupStatus = this.getSetupStatus({ activeSurfaces: input.activeSurfaces });
    const yagrConfig = this.yagrConfigService.getLocalConfig();
    const telegramStatus = this.getTelegramStatus();
    const enabledSurfaces = Array.from(new Set([...this.yagrConfigService.getEnabledGatewaySurfaces(), ...input.activeSurfaces]));
    const startableSurfaces = enabledSurfaces.filter((surface) => surface === 'webui' || (surface === 'telegram' && telegramStatus.configured));

    let availableModels: string[] = [];
    if (yagrConfig.provider) {
      const apiKey = this.yagrConfigService.getApiKey(yagrConfig.provider);
      try {
        availableModels = await this.fetchModels(yagrConfig.provider, apiKey);
      } catch {
        availableModels = [];
      }
    }

    return {
      setupStatus,
      gatewayStatus: {
        enabledSurfaces,
        startableSurfaces,
      },
      telegram: telegramStatus,
      webui: input.webUiStatus,
      yagr: {
        provider: yagrConfig.provider,
        model: yagrConfig.model,
        baseUrl: yagrConfig.baseUrl,
        providers: input.selectableProviders.map((provider) => ({
          provider,
          apiKeyStored: Boolean(this.yagrConfigService.getApiKey(provider)),
        })),
      },
      availableModels,
    };
  }

  saveLlmConfig(input: { provider: YagrModelProvider; apiKey?: string; model: string; baseUrl?: string; reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' }): void {
    const cfg = this.yagrConfigService.getLocalConfig();
    if (input.apiKey) {
      this.yagrConfigService.saveApiKey(input.provider, input.apiKey);
    }
    this.yagrConfigService.saveLocalConfig({
      ...cfg,
      provider: input.provider,
      model: input.model,
      baseUrl: input.baseUrl ?? getDefaultBaseUrlForProvider(input.provider),
      reasoningEffort: input.reasoningEffort,
    });
  }

  saveResolvedCliModelSelection(input: { provider: YagrModelProvider; model: string; baseUrl?: string; apiKey?: string; reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' }): void {
    this.saveLlmConfig(input);
  }

  resetYagrConfig(): void {
    if ('clearLocalConfig' in this.yagrConfigService && typeof this.yagrConfigService.clearLocalConfig === 'function') {
      this.yagrConfigService.clearLocalConfig();
    }
    if ('clearAllApiKeys' in this.yagrConfigService && typeof this.yagrConfigService.clearAllApiKeys === 'function') {
      this.yagrConfigService.clearAllApiKeys();
    }
  }

  getSurfaceDefaults(): { surfaces: GatewaySurface[] } {
    return { surfaces: this.yagrConfigService.getEnabledGatewaySurfaces() };
  }

  getTelegramToken(): string | undefined {
    return this.yagrConfigService.getTelegramBotToken();
  }

  async setupTelegram(token: string): Promise<{ username: string; firstName: string }> {
    return this.resolveTelegramIdentity(token);
  }

  saveSurfaces(input: { surfaces: GatewaySurface[]; telegram?: { token: string; username: string } }): void {
    if (input.telegram) {
      this.yagrConfigService.saveTelegramBotToken(input.telegram.token);
      this.yagrConfigService.updateLocalConfig((cfg) => ({
        ...cfg,
        telegram: {
          ...cfg.telegram,
          botUsername: input.telegram?.username,
          onboardingToken: cfg.telegram?.onboardingToken ?? this.createOnboardingToken(),
          linkedChats: cfg.telegram?.linkedChats ?? [],
        },
      }));
      this.yagrConfigService.enableGatewaySurface('telegram');
    }

    this.yagrConfigService.setEnabledGatewaySurfaces(input.surfaces);
  }

  async configureTelegram(botToken: string): Promise<{ username: string; firstName: string }> {
    const token = botToken.trim();
    if (!token || !token.includes(':')) {
      throw new Error('Enter a valid Telegram BotFather token.');
    }

    const identity = await this.resolveTelegramIdentity(token);
    this.saveSurfaces({
      surfaces: normalizeGatewaySurfaces([...this.yagrConfigService.getEnabledGatewaySurfaces(), 'telegram']),
      telegram: {
        token,
        username: identity.username,
      },
    });

    return identity;
  }

  resetTelegram(): void {
    this.yagrConfigService.clearTelegramBotToken();
    this.yagrConfigService.disableGatewaySurface('telegram');
    this.yagrConfigService.updateLocalConfig((localConfig) => {
      const nextConfig = { ...localConfig };
      delete nextConfig.telegram;
      return nextConfig;
    });
  }

  getLinkedTelegramChats(): YagrTelegramLinkedChat[] {
    return this.yagrConfigService.getLocalConfig().telegram?.linkedChats ?? [];
  }

  isTelegramChatLinked(chatId: string): boolean {
    return this.getLinkedTelegramChats().some((entry) => String(entry.chatId) === String(chatId));
  }

  linkTelegramChat(chat: YagrTelegramLinkedChat): void {
    const normalizedChatId = String(chat.chatId);
    this.yagrConfigService.updateLocalConfig((localConfig) => {
      const linkedChats = localConfig.telegram?.linkedChats ?? [];
      const existing = linkedChats.find((entry) => String(entry.chatId) === normalizedChatId);
      const nextLinkedChats = existing
        ? linkedChats.map((entry) => (
            String(entry.chatId) === normalizedChatId
              ? { ...entry, ...chat, chatId: normalizedChatId }
              : entry
          ))
        : [...linkedChats, { ...chat, chatId: normalizedChatId }];

      return {
        ...localConfig,
        telegram: {
          ...localConfig.telegram,
          linkedChats: nextLinkedChats,
        },
      };
    });
  }

  unlinkTelegramChat(chatId: string): void {
    const normalizedChatId = String(chatId);
    this.yagrConfigService.updateLocalConfig((localConfig) => ({
      ...localConfig,
      telegram: {
        ...localConfig.telegram,
        linkedChats: (localConfig.telegram?.linkedChats ?? []).filter((entry) => String(entry.chatId) !== normalizedChatId),
      },
    }));
  }

  touchTelegramChat(chatId: string, userId?: number, username?: string, firstName?: string): void {
    const existing = this.getLinkedTelegramChats().find((entry) => String(entry.chatId) === String(chatId));
    if (!existing) {
      return;
    }

    this.linkTelegramChat({
      ...existing,
      chatId: String(chatId),
      userId: userId ? String(userId) : existing.userId,
      username: username ?? existing.username,
      firstName: firstName ?? existing.firstName,
      lastSeenAt: new Date().toISOString(),
    });
  }
}
