import {
  N8nApiClient,
} from 'n8nac';
import { YagrConfigService } from './config/yagr-config-service.js';
import { YagrN8nConfigService } from './config/n8n-config-service.js';
import { createOnboardingToken, resolveTelegramBotIdentity } from './gateway/telegram.js';
import type { GatewaySurface } from './gateway/types.js';
import { bootstrapManagedLocalN8n } from './n8n-local/bootstrap.js';
import { installManagedDirectN8n } from './n8n-local/direct-manager.js';
import { installManagedDockerN8n } from './n8n-local/docker-manager.js';
import { inspectLocalN8nBootstrap } from './n8n-local/detect.js';
import { markManagedN8nBootstrapStage } from './n8n-local/state.js';
import { YagrSetupApplicationService } from './setup/application-services.js';
import {
  buildYagrSetupStatus as buildYagrSetupStatusBase,
  getYagrSetupStatus as getYagrSetupStatusBase,
  type YagrSetupStatus,
} from './setup/status.js';
import { runSetupWizard, type SetupCallbacks } from './setup/setup-wizard.js';
import { openExternalUrl } from './system/open-external.js';

export type { YagrSetupStatus };

export function buildYagrSetupStatus(input: Parameters<typeof buildYagrSetupStatusBase>[0]): YagrSetupStatus {
  return buildYagrSetupStatusBase(input);
}

export function getYagrSetupStatus(
  yagrConfigService = new YagrConfigService(),
  n8nConfigService = new YagrN8nConfigService(),
  options: { activeSurfaces?: GatewaySurface[] } = {},
): YagrSetupStatus {
  return getYagrSetupStatusBase(yagrConfigService, n8nConfigService, options);
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
  const setupService = new YagrSetupApplicationService(yagrConfigService, n8nConfigService, {
    resolveTelegramIdentity: resolveTelegramBotIdentity,
    createOnboardingToken,
  });
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

    async saveN8nConfig({ url, apiKey, project, syncFolder, runtimeSource }) {
      const warning = await setupService.saveN8nConfig({
        host: url,
        apiKey,
        projectId: project.id,
        syncFolder,
        runtimeSource,
      });
      if (warning) {
        process.stderr.write(`Warning: ${warning}\n`);
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
      return setupService.getLlmDefaults();
    },

    async prepareProvider(provider, apiKey) {
      return setupService.prepareProvider(provider, apiKey);
    },

    async hasAccountSession(provider) {
      return setupService.hasAccountSession(provider);
    },

    async startAccountAuth(provider) {
      return setupService.startAccountAuth(provider);
    },

    async completeAccountAuth(provider, input, state) {
      return setupService.completeAccountAuth(provider, input, state);
    },

    async fetchModels(provider, apiKey) {
      return setupService.fetchModels(provider, apiKey);
    },

    saveLlmConfig({ provider, apiKey, model, baseUrl }) {
      setupService.saveLlmConfig({ provider, apiKey, model, baseUrl });
    },

    getSurfaceDefaults() {
      return setupService.getSurfaceDefaults();
    },

    getTelegramToken() {
      return setupService.getTelegramToken();
    },

    async setupTelegram(token) {
      return setupService.setupTelegram(token);
    },

    saveSurfaces({ surfaces, telegram }) {
      setupService.saveSurfaces({ surfaces, telegram });
    },
  };
  return callbacks;
}

export async function refreshN8nWorkspaceInstructionsFromSavedConfig(
  n8nConfigService = new YagrN8nConfigService(),
): Promise<boolean> {
  return new YagrSetupApplicationService(new YagrConfigService(), n8nConfigService).refreshN8nWorkspaceInstructionsFromSavedConfig();
}

function sanitizeInputValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.replace(/^['"]|['"]$/g, '');
}
