import { YagrConfigService } from './config/yagr-config-service.js';
import { createOnboardingToken, resolveTelegramBotIdentity } from './gateway/telegram.js';
import type { GatewaySurface } from './gateway/types.js';
import { YagrSetupApplicationService } from './setup/application-services.js';
import {
  buildYagrSetupStatus as buildYagrSetupStatusBase,
  getYagrSetupStatus as getYagrSetupStatusBase,
  type YagrSetupStatus,
} from './setup/status.js';
import { runSetupWizard, type SetupCallbacks } from './setup/setup-wizard.js';

export type { YagrSetupStatus };

export function buildYagrSetupStatus(input: Parameters<typeof buildYagrSetupStatusBase>[0]): YagrSetupStatus {
  return buildYagrSetupStatusBase(input);
}

export function getYagrSetupStatus(
  yagrConfigService = new YagrConfigService(),
  options: { activeSurfaces?: GatewaySurface[] } = {},
): YagrSetupStatus {
  return getYagrSetupStatusBase(yagrConfigService, options);
}

export async function runYagrSetup(
  yagrConfigService = new YagrConfigService(),
): Promise<boolean> {
  const callbacks = createSetupCallbacks(yagrConfigService);
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
): Promise<boolean> {
  const callbacks = createSetupCallbacks(yagrConfigService);
  const result = await runSetupWizard(callbacks, { mode: 'llm-only' });
  return result.ok;
}

function createSetupCallbacks(
  yagrConfigService: YagrConfigService,
): SetupCallbacks {
  const setupService = new YagrSetupApplicationService(yagrConfigService, {
    resolveTelegramIdentity: resolveTelegramBotIdentity,
    createOnboardingToken,
  });
  return {
    getLlmDefaults() {
      return setupService.getLlmDefaults();
    },

    async prepareProvider(provider, apiKey, baseUrl) {
      return setupService.prepareProvider(provider, apiKey, baseUrl);
    },

    async hasAccountSession(provider) {
      return setupService.hasAccountSession(provider);
    },

    async startAccountAuth(provider, authMethod) {
      return setupService.startAccountAuth(provider, authMethod);
    },

    async completeAccountAuth(provider, input, state) {
      return setupService.completeAccountAuth(provider, input, state);
    },

    async fetchModels(provider, apiKey, baseUrl) {
      return setupService.fetchModels(provider, apiKey, baseUrl);
    },

    saveLlmConfig({ provider, apiKey, model, baseUrl, reasoningEffort }) {
      setupService.saveLlmConfig({ provider, apiKey, model, baseUrl, reasoningEffort });
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
}
