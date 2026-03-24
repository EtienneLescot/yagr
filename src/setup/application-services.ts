import { randomBytes } from 'node:crypto';
import { N8nApiClient, WorkspaceSetupService, getDisplayProjectName, type IProject } from 'n8nac';
import { Command } from 'commander';
import { UpdateAiCommand } from 'n8nac/dist/commands/init-ai.js';
import { normalizeGatewaySurfaces, type YagrConfigService, type YagrLocalConfig } from '../config/yagr-config-service.js';
import { resolveWorkflowDir, type YagrN8nConfigService } from '../config/n8n-config-service.js';
import { getYagrN8nWorkspaceDir } from '../config/yagr-home.js';
import {
  getDefaultBaseUrlForProvider,
  providerNeedsBaseUrlInput,
  type YagrModelProvider,
} from '../llm/provider-registry.js';
import { prepareProviderRuntime } from '../llm/proxy-runtime.js';
import { fetchAvailableModels } from '../llm/provider-discovery.js';
import { resolveModelProvider } from '../llm/create-language-model.js';
import { beginGitHubCopilotAuth, completeGitHubCopilotAuth } from '../llm/copilot-account.js';
import { beginGeminiAccountAuth, completeGeminiAccountAuth } from '../llm/google-account.js';
import { beginCodexAuth, completeCodexAuth, ensureOpenAiAccountSession } from '../llm/openai-account.js';
import type { GatewaySurface } from '../gateway/types.js';

type N8nProjectClient = Pick<N8nApiClient, 'testConnection' | 'getProjects'>;

interface SetupApplicationServiceDependencies {
  createN8nClient?: (credentials: { host: string; apiKey: string }) => N8nProjectClient;
  ensureWorkspaceFiles?: (workflowDir: string) => void;
  refreshAiContext?: (credentials: { host: string; apiKey: string }) => Promise<void>;
  resolveTelegramIdentity?: (botToken: string) => Promise<{ username: string; firstName: string }>;
  createOnboardingToken?: () => string;
}

interface YagrConfigStoreLike {
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
}

interface YagrN8nConfigStoreLike {
  getLocalConfig(): {
    host?: string;
    syncFolder?: string;
    projectId?: string;
    projectName?: string;
    instanceIdentifier?: string;
    customNodesPath?: string;
    runtimeSource?: 'managed-local' | 'external';
  };
  getApiKey(host: string): string | undefined;
  saveApiKey(host: string, apiKey: string): void;
  saveBootstrapState(host: string, syncFolder?: string, runtimeSource?: 'managed-local' | 'external'): void;
  getOrCreateInstanceIdentifier(host: string): Promise<string>;
  saveLocalConfig(config: {
    host?: string;
    syncFolder?: string;
    projectId?: string;
    projectName?: string;
    instanceIdentifier?: string;
    customNodesPath?: string;
    runtimeSource?: 'managed-local' | 'external';
  }): void;
}

function defaultCreateN8nClient(credentials: { host: string; apiKey: string }): N8nProjectClient {
  return new N8nApiClient(credentials);
}

function defaultCreateOnboardingToken(): string {
  return randomBytes(18).toString('base64url');
}

async function defaultRefreshAiContext(credentials: { host: string; apiKey: string }): Promise<void> {
  const updateAi = new UpdateAiCommand(new Command());
  const previousCwd = process.cwd();

  try {
    process.chdir(getYagrN8nWorkspaceDir());
    await updateAi.run({}, credentials);
  } finally {
    process.chdir(previousCwd);
  }
}

export class YagrSetupApplicationService {
  private readonly createN8nClient: (credentials: { host: string; apiKey: string }) => N8nProjectClient;
  private readonly ensureWorkspaceFiles: (workflowDir: string) => void;
  private readonly refreshAiContextRunner: (credentials: { host: string; apiKey: string }) => Promise<void>;
  private readonly resolveTelegramIdentity: (botToken: string) => Promise<{ username: string; firstName: string }>;
  private readonly createOnboardingToken: () => string;

  constructor(
    private readonly yagrConfigService: YagrConfigStoreLike,
    private readonly n8nConfigService: YagrN8nConfigStoreLike,
    dependencies: SetupApplicationServiceDependencies = {},
  ) {
    this.createN8nClient = dependencies.createN8nClient ?? defaultCreateN8nClient;
    this.ensureWorkspaceFiles = dependencies.ensureWorkspaceFiles ?? WorkspaceSetupService.ensureWorkspaceFiles;
    this.refreshAiContextRunner = dependencies.refreshAiContext ?? defaultRefreshAiContext;
    this.resolveTelegramIdentity = dependencies.resolveTelegramIdentity ?? (async () => {
      throw new Error('Telegram identity resolver is not configured.');
    });
    this.createOnboardingToken = dependencies.createOnboardingToken ?? defaultCreateOnboardingToken;
  }

  getLlmDefaults() {
    const cfg = this.yagrConfigService.getLocalConfig();
    let initialProvider = cfg.provider;
    if (!initialProvider) {
      try { initialProvider = resolveModelProvider(undefined, this.yagrConfigService as YagrConfigService); } catch { initialProvider = undefined; }
    }
    return {
      provider: initialProvider,
      getApiKey: (prov: YagrModelProvider) => this.yagrConfigService.getApiKey(prov),
      getDefaultModel: (prov: YagrModelProvider) => cfg.provider === prov && cfg.model ? cfg.model : undefined,
      getBaseUrl: (prov: YagrModelProvider) => cfg.provider === prov ? cfg.baseUrl : getDefaultBaseUrlForProvider(prov),
      needsBaseUrl: (prov: YagrModelProvider) => providerNeedsBaseUrlInput(prov),
    };
  }

  async prepareProvider(provider: YagrModelProvider, apiKey?: string) {
    const cfg = this.yagrConfigService.getLocalConfig();
    const prepared = await prepareProviderRuntime(provider, {
      apiKey,
      baseUrl: cfg.provider === provider ? cfg.baseUrl : getDefaultBaseUrlForProvider(provider),
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

  async startAccountAuth(provider: YagrModelProvider) {
    if (provider === 'openai-proxy') {
      const session = await ensureOpenAiAccountSession();
      if (session) {
        return { kind: 'none' as const };
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
        ],
        placeholder: challenge.callbackServerStarted
          ? 'Press Enter after signing in'
          : 'http://localhost:1455/auth/callback?code=...',
        submitLabel: challenge.callbackServerStarted ? 'Continue after sign-in' : 'Submit redirect URL',
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

    if (provider === 'google-proxy') {
      const challenge = await beginGeminiAccountAuth();
      const callbackHint = challenge.callbackServerStarted
        ? 'After authorization, Yagr captures the callback automatically on http://127.0.0.1:8085.'
        : 'If local callback is unavailable, paste the full redirect URL below.';
      return {
        kind: 'input' as const,
        title: 'Complete Gemini OAuth',
        instructions: [
          'Open this URL in your browser and sign in with Google:',
          challenge.authUrl,
          callbackHint,
        ],
        placeholder: challenge.callbackServerStarted
          ? 'Press Enter after browser authorization'
          : 'http://localhost:8085/oauth2callback?code=...',
        submitLabel: challenge.callbackServerStarted
          ? 'Continue after authorization'
          : 'Submit redirect URL',
        state: challenge.verifier,
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
    if (provider === 'openai-proxy') {
      await completeCodexAuth();
      return { ok: true };
    }

    if (provider === 'google-proxy') {
      if (!state) {
        return { ok: false, error: 'Gemini OAuth state is missing.' };
      }
      await completeGeminiAccountAuth(input, state);
      return { ok: true };
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

  async fetchModels(provider: YagrModelProvider, apiKey?: string): Promise<string[]> {
    const cfg = this.yagrConfigService.getLocalConfig();
    const baseUrl = cfg.provider === provider ? cfg.baseUrl : getDefaultBaseUrlForProvider(provider);
    return fetchAvailableModels(provider, apiKey, baseUrl);
  }

  saveLlmConfig(input: { provider: YagrModelProvider; apiKey?: string; model: string; baseUrl?: string }): void {
    const cfg = this.yagrConfigService.getLocalConfig();
    if (input.apiKey) {
      this.yagrConfigService.saveApiKey(input.provider, input.apiKey);
    }
    this.yagrConfigService.saveLocalConfig({
      ...cfg,
      provider: input.provider,
      model: input.model,
      baseUrl: input.baseUrl ?? getDefaultBaseUrlForProvider(input.provider),
    });
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

  async fetchN8nProjects(host: string, apiKeyOverride?: string): Promise<IProject[]> {
    const normalizedHost = host.trim();
    if (!normalizedHost) {
      throw new Error('n8n host is required.');
    }

    const apiKey = apiKeyOverride ?? this.n8nConfigService.getApiKey(normalizedHost);
    if (!apiKey) {
      throw new Error('No n8n API key available for that host.');
    }

    const client = this.createN8nClient({ host: normalizedHost, apiKey });
    const connected = await client.testConnection();
    if (!connected) {
      throw new Error('Unable to connect to n8n with the provided URL and API key.');
    }

    return client.getProjects();
  }

  async saveN8nConfig(input: {
    host: string;
    apiKey?: string;
    projectId: string;
    syncFolder: string;
    runtimeSource?: 'managed-local' | 'external';
  }): Promise<string | undefined> {
    const host = input.host.trim();
    const projectId = input.projectId.trim();
    const syncFolder = input.syncFolder.trim() || 'workflows';
    const runtimeSource = input.runtimeSource ?? 'external';

    if (!host) {
      throw new Error('n8n host is required.');
    }
    if (!projectId) {
      throw new Error('Select an n8n project first.');
    }

    const apiKey = input.apiKey?.trim() || this.n8nConfigService.getApiKey(host);
    if (!apiKey) {
      throw new Error('An n8n API key is required.');
    }

    const projects = await this.fetchN8nProjects(host, apiKey);
    const selectedProject = projects.find((project) => project.id === projectId);
    if (!selectedProject) {
      throw new Error('The selected n8n project could not be found. Reload projects and try again.');
    }

    this.n8nConfigService.saveApiKey(host, apiKey);
    this.n8nConfigService.saveBootstrapState(host, syncFolder, runtimeSource);
    const instanceIdentifier = await this.n8nConfigService.getOrCreateInstanceIdentifier(host);
    const currentConfig = this.n8nConfigService.getLocalConfig();
    const projectName = getDisplayProjectName(selectedProject);
    this.n8nConfigService.saveLocalConfig({
      host,
      syncFolder,
      projectId: selectedProject.id,
      projectName,
      instanceIdentifier,
      customNodesPath: currentConfig.customNodesPath,
      runtimeSource,
    });

    const workflowDir = resolveWorkflowDir({ syncFolder, instanceIdentifier, projectName });
    if (workflowDir) {
      this.ensureWorkspaceFiles(workflowDir);
    }

    try {
      await this.refreshAiContextRunner({ host, apiKey });
      return undefined;
    } catch (error) {
      return `Workspace saved, but the n8n workspace instructions refresh failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  async refreshN8nWorkspaceInstructionsFromSavedConfig(): Promise<boolean> {
    const config = this.n8nConfigService.getLocalConfig();
    if (!config.host) {
      return false;
    }

    const apiKey = this.n8nConfigService.getApiKey(config.host);
    if (!apiKey) {
      return false;
    }

    await this.refreshAiContextRunner({ host: config.host, apiKey });
    return true;
  }
}

export async function refreshAiContext(credentials: { host: string; apiKey: string }): Promise<void> {
  await defaultRefreshAiContext(credentials);
}
