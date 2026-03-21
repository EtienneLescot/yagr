import {
  N8nApiClient,
  WorkspaceSetupService,
  getDisplayProjectName,
  type IProject,
} from 'n8nac';
import { Command } from 'commander';
import { UpdateAiCommand } from 'n8nac/dist/commands/init-ai.js';
import { normalizeGatewaySurfaces, YagrConfigService } from './config/yagr-config-service.js';
import { resolveWorkflowDir, YagrN8nConfigService } from './config/n8n-config-service.js';
import { getYagrN8nWorkspaceDir } from './config/yagr-home.js';
import { getGatewaySupervisorStatus } from './gateway/manager.js';
import { createOnboardingToken, resolveTelegramBotIdentity } from './gateway/telegram.js';
import type { GatewaySurface } from './gateway/types.js';
import { resolveLanguageModelConfig, resolveModelName, resolveModelProvider, type YagrModelProvider } from './llm/create-language-model.js';
import { beginGitHubCopilotAuth, completeGitHubCopilotAuth } from './llm/copilot-account.js';
import { beginGeminiAccountAuth, completeGeminiAccountAuth } from './llm/google-account.js';
import { beginCodexAuth, completeCodexAuth, ensureOpenAiAccountSession } from './llm/openai-account.js';
import { fetchAvailableModels } from './llm/provider-discovery.js';
import {
  getDefaultBaseUrlForProvider,
  isProviderConfigured,
  providerNeedsBaseUrlInput,
  YAGR_MODEL_PROVIDERS,
} from './llm/provider-registry.js';
import { prepareProviderRuntime } from './llm/proxy-runtime.js';
import { bootstrapManagedLocalN8n } from './n8n-local/bootstrap.js';
import { installManagedDirectN8n } from './n8n-local/direct-manager.js';
import { installManagedDockerN8n } from './n8n-local/docker-manager.js';
import { inspectLocalN8nBootstrap } from './n8n-local/detect.js';
import { markManagedN8nBootstrapStage } from './n8n-local/state.js';
import { runSetupWizard, type SetupCallbacks } from './setup/setup-wizard.js';
import { openExternalUrl } from './system/open-external.js';

const VALID_PROVIDERS: YagrModelProvider[] = [...YAGR_MODEL_PROVIDERS];

export interface YagrSetupStatus {
  ready: boolean;
  n8nConfigured: boolean;
  llmConfigured: boolean;
  enabledSurfaces: GatewaySurface[];
  startableSurfaces: GatewaySurface[];
  missingSteps: Array<'n8n' | 'llm' | 'surfaces'>;
}

export function buildYagrSetupStatus(input: {
  n8nConfigured: boolean;
  llmConfigured: boolean;
  enabledSurfaces: GatewaySurface[];
  startableSurfaces: GatewaySurface[];
}): YagrSetupStatus {
  const missingSteps: Array<'n8n' | 'llm' | 'surfaces'> = [];

  if (!input.n8nConfigured) {
    missingSteps.push('n8n');
  }

  if (!input.llmConfigured) {
    missingSteps.push('llm');
  }

  if (input.startableSurfaces.length === 0) {
    missingSteps.push('surfaces');
  }

  return {
    ready: missingSteps.length === 0,
    n8nConfigured: input.n8nConfigured,
    llmConfigured: input.llmConfigured,
    enabledSurfaces: input.enabledSurfaces,
    startableSurfaces: input.startableSurfaces,
    missingSteps,
  };
}

export function getYagrSetupStatus(
  yagrConfigService = new YagrConfigService(),
  n8nConfigService = new YagrN8nConfigService(),
  options: { activeSurfaces?: GatewaySurface[] } = {},
): YagrSetupStatus {
  const yagrConfig = yagrConfigService.getLocalConfig();
  const n8nConfig = n8nConfigService.getLocalConfig();
  const gatewayStatus = getGatewaySupervisorStatus(yagrConfigService);
  const activeSurfaces = normalizeGatewaySurfaces(options.activeSurfaces);

  const n8nConfigured = Boolean(
    n8nConfig.host
    && n8nConfig.syncFolder
    && n8nConfig.projectId
    && n8nConfig.projectName
    && n8nConfigService.getApiKey(n8nConfig.host),
  );

  let llmConfigured = false;
  try {
    llmConfigured = isProviderConfigured(yagrConfig, (provider) => yagrConfigService.getApiKey(provider));
  } catch {
    llmConfigured = false;
  }

  const enabledSurfaces = Array.from(new Set([...gatewayStatus.enabledSurfaces, ...activeSurfaces]));
  const startableSurfaces = Array.from(new Set([...gatewayStatus.startableSurfaces, ...activeSurfaces]));

  return buildYagrSetupStatus({
    n8nConfigured,
    llmConfigured,
    enabledSurfaces,
    startableSurfaces,
  });
}

export async function runYagrSetup(
  yagrConfigService = new YagrConfigService(),
  n8nConfigService = new YagrN8nConfigService(),
): Promise<boolean> {
  const callbacks = createSetupCallbacks(yagrConfigService, n8nConfigService);
  const result = await runSetupWizard(callbacks);

  if (result.ok && result.telegramDeepLink) {
    process.stdout.write(`\nTelegram onboarding link: ${result.telegramDeepLink}\n`);
    try {
      const { default: qrcode } = await import('qrcode-terminal');
      qrcode.generate(result.telegramDeepLink, { small: true });
    } catch { /* optional */ }
  }

  return result.ok;
}

export async function runYagrLlmSetup(
  yagrConfigService = new YagrConfigService(),
  n8nConfigService = new YagrN8nConfigService(),
): Promise<boolean> {
  const callbacks = createSetupCallbacks(yagrConfigService, n8nConfigService);
  const result = await runSetupWizard(callbacks, { mode: 'llm-only' });
  return result.ok;
}

function createSetupCallbacks(
  yagrConfigService: YagrConfigService,
  n8nConfigService: YagrN8nConfigService,
): SetupCallbacks {
  const callbacks: SetupCallbacks = {
    getN8nDefaults(urlOverride?: string) {
      const cfg = n8nConfigService.getLocalConfig();
      const hostForKey = urlOverride ?? cfg.host;
      return {
        url: sanitizeInputValue(cfg.host) ?? 'http://localhost:5678',
        apiKey: hostForKey ? n8nConfigService.getApiKey(hostForKey) : undefined,
        projectId: cfg.projectId,
        syncFolder: cfg.syncFolder,
      };
    },

    async testN8nConnection(url, apiKey) {
      const client = new N8nApiClient({ host: url, apiKey });
      const connected = await client.testConnection();
      if (!connected) throw new Error('Unable to connect to n8n with the provided URL and API key.');
      markManagedN8nBootstrapStage(url, 'api-key-pending');
      const projects = await client.getProjects();
      if (projects.length === 0) throw new Error('No n8n projects found. Create one in n8n first, then rerun setup.');
      return projects;
    },

    async saveN8nConfig({ url, apiKey, project, syncFolder }) {
      n8nConfigService.saveApiKey(url, apiKey);
      n8nConfigService.saveBootstrapState(url, syncFolder);
      const instanceIdentifier = await n8nConfigService.getOrCreateInstanceIdentifier(url);
      const currentConfig = n8nConfigService.getLocalConfig();
      const projectName = getDisplayProjectName(project);
      n8nConfigService.saveLocalConfig({
        host: url,
        syncFolder,
        projectId: project.id,
        projectName,
        instanceIdentifier,
        customNodesPath: currentConfig.customNodesPath,
      });
      const workflowDir = resolveWorkflowDir({ syncFolder, instanceIdentifier, projectName });
      if (workflowDir) {
        WorkspaceSetupService.ensureWorkspaceFiles(workflowDir);
      }
      try {
        await refreshAiContext({ host: url, apiKey });
      } catch (err) {
        process.stderr.write(`Warning: n8n workspace instructions refresh failed: ${err instanceof Error ? err.message : String(err)}\n`);
      }
      markManagedN8nBootstrapStage(url, 'connected');
    },

    async installManagedLocalN8n(strategy) {
      const assessment = await inspectLocalN8nBootstrap();
      if (strategy === 'docker') {
        if (!assessment.docker.available) {
          throw new Error('Docker is not running. Choose the local managed n8n option without Docker, or install/run Docker.');
        }
        if (assessment.docker.reachable === false) {
          throw new Error('Docker is not running. Choose the local managed n8n option without Docker, or install/run Docker.');
        }
        return installManagedDockerN8n();
      }

      if (strategy === 'direct') {
        if (!assessment.node.supportedForDirectRuntime) {
          throw new Error('A compatible local Node.js runtime is required for the non-Docker local n8n install. Run `yagr n8n doctor` for details.');
        }
        return installManagedDirectN8n();
      }

      if (assessment.recommendedStrategy === 'docker') {
        return installManagedDockerN8n();
      }
      if (assessment.recommendedStrategy === 'direct') {
        return installManagedDirectN8n();
      }
      throw new Error('No supported automatic local n8n runtime is available. Run `yagr n8n doctor` for details.');
    },

    async bootstrapManagedLocalN8n(url) {
      const result = await bootstrapManagedLocalN8n({ url });
      if (result.apiKey) {
        n8nConfigService.saveApiKey(url, result.apiKey);
      }
      return result;
    },

    async openUrl(url) {
      await openExternalUrl(url);
    },

    getLlmDefaults() {
      const cfg = yagrConfigService.getLocalConfig();
      let initialProvider = cfg.provider;
      if (!initialProvider) {
        try { initialProvider = resolveModelProvider(undefined, yagrConfigService); } catch { initialProvider = undefined; }
      }
      return {
        provider: initialProvider,
        getApiKey: (prov) => yagrConfigService.getApiKey(prov),
        getDefaultModel: (prov) => cfg.provider === prov && cfg.model ? cfg.model : undefined,
        getBaseUrl: (prov) => cfg.provider === prov ? cfg.baseUrl : getDefaultBaseUrlForProvider(prov),
        needsBaseUrl: (prov) => providerNeedsBaseUrlInput(prov),
      };
    },

    async prepareProvider(provider, apiKey) {
      const cfg = yagrConfigService.getLocalConfig();
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
    },

    async startAccountAuth(provider) {
      if (provider === 'openai-proxy') {
        const session = await ensureOpenAiAccountSession();
        if (session) {
          return { kind: 'none' };
        }
        const challenge = await beginCodexAuth();
        const callbackHint = challenge.callbackServerStarted
          ? 'After signing in, Yagr captures the callback automatically.'
          : 'If the browser does not open, copy the URL above and visit it manually.';
        return {
          kind: 'input',
          title: 'Connect OpenAI account (ChatGPT Plus)',
          instructions: [
            'Open this URL in your browser and sign in with your ChatGPT account:',
            challenge.authUrl,
            'This uses your ChatGPT subscription — no API credits are consumed.',
            callbackHint,
          ],
          placeholder: challenge.callbackServerStarted
            ? 'Press Enter after signing in'
            : `http://localhost:1455/auth/callback?code=...`,
          submitLabel: challenge.callbackServerStarted ? 'Continue after sign-in' : 'Submit redirect URL',
        };
      }

      if (provider === 'anthropic-proxy') {
        return {
          kind: 'input',
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
          kind: 'input',
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
          kind: 'input',
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

      return { kind: 'none' };
    },

    async completeAccountAuth(provider, input, state) {
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
    },

    async fetchModels(provider, apiKey) {
      const cfg = yagrConfigService.getLocalConfig();
      const baseUrl = cfg.provider === provider ? cfg.baseUrl : getDefaultBaseUrlForProvider(provider);
      return fetchAvailableModels(provider, apiKey, baseUrl);
    },

    saveLlmConfig({ provider, apiKey, model, baseUrl }) {
      const cfg = yagrConfigService.getLocalConfig();
      if (apiKey) {
        yagrConfigService.saveApiKey(provider, apiKey);
      }
      yagrConfigService.saveLocalConfig({
        ...cfg,
        provider,
        model,
        baseUrl: baseUrl ?? getDefaultBaseUrlForProvider(provider),
      });
    },

    getSurfaceDefaults() {
      return { surfaces: yagrConfigService.getEnabledGatewaySurfaces() };
    },

    getTelegramToken() {
      return yagrConfigService.getTelegramBotToken();
    },

    async setupTelegram(token) {
      return resolveTelegramBotIdentity(token);
    },

    saveSurfaces({ surfaces, telegram }) {
      if (telegram) {
        yagrConfigService.saveTelegramBotToken(telegram.token);
        yagrConfigService.updateLocalConfig((cfg) => ({
          ...cfg,
          telegram: {
            ...cfg.telegram,
            botUsername: telegram.username,
            onboardingToken: cfg.telegram?.onboardingToken ?? createOnboardingToken(),
            linkedChats: cfg.telegram?.linkedChats ?? [],
          },
        }));
        yagrConfigService.enableGatewaySurface('telegram');
      }
      yagrConfigService.setEnabledGatewaySurfaces(surfaces);
    },
  };
  return callbacks;
}

export async function refreshN8nWorkspaceInstructionsFromSavedConfig(
  n8nConfigService = new YagrN8nConfigService(),
): Promise<boolean> {
  const config = n8nConfigService.getLocalConfig();
  if (!config.host) {
    return false;
  }

  const apiKey = n8nConfigService.getApiKey(config.host);
  if (!apiKey) {
    return false;
  }

  await refreshAiContext({ host: config.host, apiKey });
  return true;
}

async function refreshAiContext(credentials: { host: string; apiKey: string }): Promise<void> {
  const updateAi = new UpdateAiCommand(new Command());
  const previousCwd = process.cwd();

  try {
    process.chdir(getYagrN8nWorkspaceDir());
    await updateAi.run({}, credentials);
  } finally {
    process.chdir(previousCwd);
  }
}

function sanitizeInputValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.replace(/^['"]|['"]$/g, '');
}
