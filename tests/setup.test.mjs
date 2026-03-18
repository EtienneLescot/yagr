import assert from 'node:assert/strict';
import test from 'node:test';

import { buildYagrSetupStatus, getYagrSetupStatus } from '../dist/setup.js';

test('buildYagrSetupStatus reports all missing setup phases when nothing is ready', () => {
  const status = buildYagrSetupStatus({
    n8nConfigured: false,
    llmConfigured: false,
    enabledSurfaces: [],
    startableSurfaces: [],
  });

  assert.equal(status.ready, false);
  assert.deepEqual(status.missingSteps, ['n8n', 'llm', 'surfaces']);
});

test('buildYagrSetupStatus is ready only when n8n llm and a startable surface exist', () => {
  const status = buildYagrSetupStatus({
    n8nConfigured: true,
    llmConfigured: true,
    enabledSurfaces: ['telegram', 'webui'],
    startableSurfaces: ['telegram'],
  });

  assert.equal(status.ready, true);
  assert.deepEqual(status.missingSteps, []);
});

test('getYagrSetupStatus treats the active webui as a startable surface', () => {
  let localConfig = {
    provider: 'openai',
    model: 'gpt-4o',
    gateway: {
      enabledSurfaces: [],
    },
  };

  const yagrConfigService = {
    getLocalConfig() {
      return localConfig;
    },
    updateLocalConfig(updater) {
      localConfig = updater(localConfig);
      return localConfig;
    },
    getEnabledGatewaySurfaces() {
      return [];
    },
    getApiKey() {
      return 'test-openai-key';
    },
    getTelegramBotToken() {
      return undefined;
    },
  };

  const n8nConfigService = {
    getLocalConfig() {
      return {
        host: 'http://localhost:5678',
        syncFolder: '/tmp/yagr-sync',
        projectId: 'proj_123',
        projectName: 'Test Project',
      };
    },
    getApiKey() {
      return 'test-n8n-key';
    },
  };

  const status = getYagrSetupStatus(
    yagrConfigService,
    n8nConfigService,
    { activeSurfaces: ['webui'] },
  );

  assert.equal(status.ready, true);
  assert.deepEqual(status.missingSteps, []);
  assert.deepEqual(status.startableSurfaces, ['webui']);
});