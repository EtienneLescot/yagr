import assert from 'node:assert/strict';
import test from 'node:test';

import { YagrSetupApplicationService } from '../dist/setup/application-services.js';

function createYagrConfigStore(initialConfig = {}) {
  let localConfig = { ...initialConfig };
  const apiKeys = new Map();
  let telegramBotToken;
  let clearedLocalConfig = 0;
  let clearedApiKeys = 0;

  return {
    getLocalConfig() {
      return { ...localConfig };
    },
    saveLocalConfig(config) {
      localConfig = { ...config };
    },
    updateLocalConfig(updater) {
      localConfig = updater({ ...localConfig });
      return { ...localConfig };
    },
    getEnabledGatewaySurfaces() {
      return Array.isArray(localConfig.gateway?.enabledSurfaces) ? [...localConfig.gateway.enabledSurfaces] : [];
    },
    setEnabledGatewaySurfaces(surfaces) {
      localConfig = {
        ...localConfig,
        gateway: {
          ...localConfig.gateway,
          enabledSurfaces: [...surfaces],
        },
      };
      return { ...localConfig };
    },
    enableGatewaySurface(surface) {
      const current = new Set(this.getEnabledGatewaySurfaces());
      current.add(surface);
      return this.setEnabledGatewaySurfaces([...current]);
    },
    disableGatewaySurface(surface) {
      return this.setEnabledGatewaySurfaces(this.getEnabledGatewaySurfaces().filter((entry) => entry !== surface));
    },
    getApiKey(provider) {
      return apiKeys.get(provider);
    },
    saveApiKey(provider, apiKey) {
      apiKeys.set(provider, apiKey);
    },
    getTelegramBotToken() {
      return telegramBotToken;
    },
    saveTelegramBotToken(botToken) {
      telegramBotToken = botToken;
    },
    clearTelegramBotToken() {
      telegramBotToken = undefined;
    },
    clearLocalConfig() {
      clearedLocalConfig += 1;
      localConfig = {};
    },
    clearAllApiKeys() {
      clearedApiKeys += 1;
      apiKeys.clear();
    },
    getDebugCounters() {
      return { clearedLocalConfig, clearedApiKeys };
    },
  };
}

test('saveLlmConfig writes provider model baseUrl and api key through the shared service', () => {
  const yagrConfigStore = createYagrConfigStore();
  const service = new YagrSetupApplicationService(yagrConfigStore);

  service.saveLlmConfig({
    provider: 'openrouter',
    apiKey: 'or-key',
    model: 'openai/gpt-5',
    baseUrl: 'https://openrouter.ai/api/v1',
  });

  const localConfig = yagrConfigStore.getLocalConfig();
  assert.equal(localConfig.provider, 'openrouter');
  assert.equal(localConfig.model, 'openai/gpt-5');
  assert.equal(localConfig.baseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(yagrConfigStore.getApiKey('openrouter'), 'or-key');
});

test('configureTelegram and resetTelegram share the same configuration path', async () => {
  const yagrConfigStore = createYagrConfigStore({ gateway: { enabledSurfaces: [] } });
  const service = new YagrSetupApplicationService(yagrConfigStore, {
    async resolveTelegramIdentity() {
      return { username: 'yagr_bot', firstName: 'Yagr' };
    },
    createOnboardingToken() {
      return 'onboarding-token';
    },
  });

  const identity = await service.configureTelegram('123456:ABC');
  assert.equal(identity.username, 'yagr_bot');
  assert.equal(yagrConfigStore.getTelegramBotToken(), '123456:ABC');
  assert.deepEqual(yagrConfigStore.getEnabledGatewaySurfaces(), ['telegram']);
  assert.equal(yagrConfigStore.getLocalConfig().telegram.botUsername, 'yagr_bot');
  assert.equal(yagrConfigStore.getLocalConfig().telegram.onboardingToken, 'onboarding-token');

  service.resetTelegram();
  assert.equal(yagrConfigStore.getTelegramBotToken(), undefined);
  assert.deepEqual(yagrConfigStore.getEnabledGatewaySurfaces(), []);
  assert.equal(yagrConfigStore.getLocalConfig().telegram, undefined);
});

test('buildWebUiSnapshot centralizes setup and config state for the Web UI', async () => {
  const yagrConfigStore = createYagrConfigStore({
    provider: 'openrouter',
    model: 'openai/gpt-5',
    baseUrl: 'https://openrouter.ai/api/v1',
    gateway: { enabledSurfaces: ['telegram'] },
    telegram: {
      botUsername: 'yagr_bot',
      onboardingToken: 'token',
      linkedChats: [],
    },
  });
  yagrConfigStore.saveApiKey('openrouter', 'or-key');

  const service = new YagrSetupApplicationService(yagrConfigStore, {
    async fetchAvailableModels() {
      return ['openai/gpt-5', 'openai/gpt-5-mini'];
    },
  });

  const snapshot = await service.buildWebUiSnapshot({
    activeSurfaces: ['webui'],
    webUiStatus: {
      configured: true,
      host: '127.0.0.1',
      port: 3789,
      url: 'http://127.0.0.1:3789',
    },
    selectableProviders: ['openrouter', 'openai'],
  });

  assert.equal(snapshot.setupStatus.ready, true);
  assert.deepEqual(snapshot.gatewayStatus.enabledSurfaces, ['telegram', 'webui']);
  assert.equal(snapshot.yagr.provider, 'openrouter');
  assert.deepEqual(snapshot.availableModels, ['openai/gpt-5', 'openai/gpt-5-mini']);
});

test('telegram chat state mutations are centralized in the setup application service', () => {
  const yagrConfigStore = createYagrConfigStore({
    telegram: {
      botUsername: 'yagr_bot',
      onboardingToken: 'token',
      linkedChats: [],
    },
  });
  const service = new YagrSetupApplicationService(yagrConfigStore);

  service.linkTelegramChat({
    chatId: '42',
    username: 'alice',
    linkedAt: '2026-03-23T10:00:00.000Z',
  });
  assert.equal(service.isTelegramChatLinked('42'), true);
  assert.equal(service.getLinkedTelegramChats().length, 1);

  service.touchTelegramChat('42', 99, 'alice2', 'Alice');
  assert.equal(service.getLinkedTelegramChats()[0].username, 'alice2');
  assert.equal(service.getLinkedTelegramChats()[0].userId, '99');

  service.unlinkTelegramChat('42');
  assert.equal(service.isTelegramChatLinked('42'), false);
  assert.deepEqual(service.getLinkedTelegramChats(), []);
});

test('resetYagrConfig delegates config reset to the shared application service', () => {
  const yagrConfigStore = createYagrConfigStore({ provider: 'openai', model: 'gpt-4o' });
  yagrConfigStore.saveApiKey('openai', 'sk-test');
  const service = new YagrSetupApplicationService(yagrConfigStore);

  service.resetYagrConfig();

  const counters = yagrConfigStore.getDebugCounters();
  assert.equal(counters.clearedLocalConfig, 1);
  assert.equal(counters.clearedApiKeys, 1);
  assert.deepEqual(yagrConfigStore.getLocalConfig(), {});
  assert.equal(yagrConfigStore.getApiKey('openai'), undefined);
});
