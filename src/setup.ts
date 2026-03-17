import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  ConfigService as N8nConfigService,
  N8nApiClient,
  WorkspaceSetupService,
  getDisplayProjectName,
  type IProject,
} from 'n8nac';
import { YagrConfigService } from './config/yagr-config-service.js';
import { getYagrHomeDir } from './config/yagr-home.js';
import { getGatewaySupervisorStatus } from './gateway/manager.js';
import { createOnboardingToken, resolveTelegramBotIdentity } from './gateway/telegram.js';
import type { GatewaySurface } from './gateway/types.js';
import { resolveLanguageModelConfig, resolveModelName, resolveModelProvider, type YagrModelProvider } from './llm/create-language-model.js';
import { runSetupWizard, type SetupCallbacks } from './setup/setup-wizard.js';

const execFileAsync = promisify(execFile);

const VALID_PROVIDERS: YagrModelProvider[] = [
  'anthropic',
  'openai',
  'google',
  'groq',
  'mistral',
  'openrouter',
];

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
  n8nConfigService = new N8nConfigService(),
): YagrSetupStatus {
  const yagrConfig = yagrConfigService.getLocalConfig();
  const n8nConfig = n8nConfigService.getLocalConfig();
  const gatewayStatus = getGatewaySupervisorStatus(yagrConfigService);

  const n8nConfigured = Boolean(
    n8nConfig.host
    && n8nConfig.syncFolder
    && n8nConfig.projectId
    && n8nConfig.projectName
    && n8nConfigService.getApiKey(n8nConfig.host),
  );

  let llmConfigured = false;
  try {
    const resolvedConfig = resolveLanguageModelConfig({}, yagrConfigService);
    llmConfigured = Boolean(resolvedConfig.provider && resolvedConfig.model && resolvedConfig.apiKey);
  } catch {
    llmConfigured = false;
  }

  return buildYagrSetupStatus({
    n8nConfigured,
    llmConfigured,
    enabledSurfaces: gatewayStatus.enabledSurfaces,
    startableSurfaces: gatewayStatus.startableSurfaces,
  });
}

export async function runYagrSetup(
  yagrConfigService = new YagrConfigService(),
  n8nConfigService = new N8nConfigService(),
): Promise<boolean> {
  const callbacks: SetupCallbacks = {
    getN8nDefaults() {
      const cfg = n8nConfigService.getLocalConfig();
      return {
        url: sanitizeInputValue(cfg.host) ?? 'http://localhost:5678',
        apiKey: cfg.host ? n8nConfigService.getApiKey(cfg.host) : undefined,
        projectId: cfg.projectId,
        syncFolder: cfg.syncFolder,
      };
    },

    async testN8nConnection(url, apiKey) {
      const client = new N8nApiClient({ host: url, apiKey });
      const connected = await client.testConnection();
      if (!connected) throw new Error('Unable to connect to n8n with the provided URL and API key.');
      const projects = await client.getProjects();
      if (projects.length === 0) throw new Error('No n8n projects found. Create one in n8n first, then rerun setup.');
      return projects;
    },

    async saveN8nConfig({ url, apiKey, project, syncFolder }) {
      n8nConfigService.saveApiKey(url, apiKey);
      n8nConfigService.saveBootstrapState(url, syncFolder);
      const instanceIdentifier = await n8nConfigService.getOrCreateInstanceIdentifier(url);
      const currentConfig = n8nConfigService.getLocalConfig();
      n8nConfigService.saveLocalConfig({
        host: url,
        syncFolder,
        projectId: project.id,
        projectName: getDisplayProjectName(project),
        instanceIdentifier,
        customNodesPath: currentConfig.customNodesPath,
      });
      WorkspaceSetupService.ensureWorkspaceFiles(syncFolder);
      try {
        await runN8nacCommand(['update-ai']);
      } catch (err) {
        process.stderr.write(`Warning: AGENTS.md refresh failed: ${err instanceof Error ? err.message : String(err)}\n`);
      }
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
        getDefaultModel: (prov) => resolveModelName(prov, cfg.provider === prov ? cfg.model : undefined, yagrConfigService),
        getBaseUrl: (prov) => cfg.provider === prov ? cfg.baseUrl : getBaseUrlForProvider(prov),
        needsBaseUrl: (prov) => ['groq', 'mistral', 'openrouter'].includes(prov),
      };
    },

    async fetchModels(provider, apiKey) {
      return fetchAvailableModels(provider, apiKey);
    },

    saveLlmConfig({ provider, apiKey, model, baseUrl }) {
      const cfg = yagrConfigService.getLocalConfig();
      yagrConfigService.saveApiKey(provider, apiKey);
      yagrConfigService.saveLocalConfig({
        ...cfg,
        provider,
        model,
        baseUrl: baseUrl ?? getBaseUrlForProvider(provider),
      });
    },

    getSurfaceDefaults() {
      return { surfaces: yagrConfigService.getEnabledGatewaySurfaces() };
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

async function runN8nacCommand(args: string[]): Promise<void> {
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  await execFileAsync(command, ['--yes', 'n8nac', ...args], {
    cwd: getYagrHomeDir(),
    env: process.env,
  });
}

function getBaseUrlForProvider(provider: YagrModelProvider): string | undefined {
  switch (provider) {
    case 'openrouter': return 'https://openrouter.ai/api/v1';
    case 'openai': return undefined;
    case 'groq': return 'https://api.groq.com/openai/v1';
    case 'mistral': return 'https://api.mistral.ai/v1';
    case 'anthropic': return undefined;
    default: return undefined;
  }
}

function validateUrl(value: string): string | undefined {
  const normalized = sanitizeInputValue(value);
  if (!normalized) {
    return 'A URL is required.';
  }

  try {
    new URL(normalized);
    return undefined;
  } catch {
    return 'Enter a valid URL.';
  }
}

function sanitizeInputValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.replace(/^['"]|['"]$/g, '');
}
async function fetchAvailableModels(provider: YagrModelProvider, apiKey: string): Promise<string[]> {
  const endpoints: Partial<Record<YagrModelProvider, {
    url: string;
    map: (data: Record<string, unknown>) => string[];
  }>> = {
    openrouter: {
      url: 'https://openrouter.ai/api/v1/models',
      map: (data) => (data['data'] as Array<{ id: string }> | undefined)?.map((m) => m.id) ?? [],
    },
    openai: {
      url: 'https://api.openai.com/v1/models',
      map: (data) => (data['data'] as Array<{ id: string }> | undefined)?.map((m) => m.id) ?? [],
    },
    groq: {
      url: 'https://api.groq.com/openai/v1/models',
      map: (data) => (data['data'] as Array<{ id: string }> | undefined)?.map((m) => m.id) ?? [],
    },
    mistral: {
      url: 'https://api.mistral.ai/v1/models',
      map: (data) => (data['data'] as Array<{ id: string }> | undefined)?.map((m) => m.id) ?? [],
    },
  };

  const endpoint = endpoints[provider];
  if (!endpoint) return [];

  try {
    const response = await fetch(endpoint.url, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const payload = await response.json() as Record<string, unknown>;
    return endpoint.map(payload).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}