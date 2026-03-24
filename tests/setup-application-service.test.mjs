import assert from 'node:assert/strict';
import test from 'node:test';

import { YagrSetupApplicationService } from '../dist/setup/application-services.js';

function createYagrConfigStore(initialConfig = {}) {
  let localConfig = { ...initialConfig };
  const apiKeys = new Map();
  let telegramBotToken;

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
  };
}

function createN8nConfigStore(initialConfig = {}) {
  let localConfig = { ...initialConfig };
  const apiKeys = new Map();

  return {
    getLocalConfig() {
      return { ...localConfig };
    },
    getApiKey(host) {
      return apiKeys.get(host);
    },
    saveApiKey(host, apiKey) {
      apiKeys.set(host, apiKey);
    },
    saveBootstrapState(host, syncFolder = 'workflows', runtimeSource = 'external') {
      localConfig = {
        host,
        syncFolder,
        runtimeSource,
      };
    },
    async getOrCreateInstanceIdentifier() {
      return 'instance_test';
    },
    saveLocalConfig(config) {
      localConfig = { ...config };
    },
  };
}

test('saveN8nConfig persists host project and workflow workspace and returns refresh warning', async () => {
  const yagrConfigStore = createYagrConfigStore();
  const n8nConfigStore = createN8nConfigStore({ customNodesPath: '/tmp/custom-nodes' });
  const ensuredDirs = [];

  const service = new YagrSetupApplicationService(yagrConfigStore, n8nConfigStore, {
    createN8nClient: () => ({
      async testConnection() { return true; },
      async getProjects() {
        return [{ id: 'proj_1', name: 'Primary Project' }];
      },
    }),
    ensureWorkspaceFiles(workflowDir) {
      ensuredDirs.push(workflowDir);
    },
    async refreshAiContext() {
      throw new Error('update-ai failed');
    },
  });

  const warning = await service.saveN8nConfig({
    host: 'http://localhost:5678',
    apiKey: 'n8n-key',
    projectId: 'proj_1',
    syncFolder: 'workflows',
  });

  assert.match(warning, /workspace instructions refresh failed/i);
  assert.equal(n8nConfigStore.getApiKey('http://localhost:5678'), 'n8n-key');
  assert.equal(n8nConfigStore.getLocalConfig().projectId, 'proj_1');
  assert.equal(n8nConfigStore.getLocalConfig().instanceIdentifier, 'instance_test');
  assert.equal(ensuredDirs.length, 1);
  assert.match(ensuredDirs[0], /workflows/);
});

test('saveLlmConfig writes provider model baseUrl and api key through the shared service', () => {
  const yagrConfigStore = createYagrConfigStore();
  const n8nConfigStore = createN8nConfigStore();
  const service = new YagrSetupApplicationService(yagrConfigStore, n8nConfigStore);

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
  const yagrConfigStore = createYagrConfigStore({
    gateway: { enabledSurfaces: [] },
  });
  const n8nConfigStore = createN8nConfigStore();
  const service = new YagrSetupApplicationService(yagrConfigStore, n8nConfigStore, {
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

  const n8nConfigStore = createN8nConfigStore({
    host: 'http://localhost:5678',
    syncFolder: 'workflows',
    projectId: 'proj_1',
    projectName: 'Primary Project',
  });
  n8nConfigStore.saveApiKey('http://localhost:5678', 'n8n-key');

  const service = new YagrSetupApplicationService(yagrConfigStore, n8nConfigStore, {
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
  assert.equal(snapshot.n8n.projectId, 'proj_1');
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
  const n8nConfigStore = createN8nConfigStore();
  const service = new YagrSetupApplicationService(yagrConfigStore, n8nConfigStore);

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
