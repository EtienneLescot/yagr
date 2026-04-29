import assert from 'node:assert/strict';
import test from 'node:test';

import { buildYagrSetupStatus, getYagrSetupStatus } from '../dist/setup.js';

test('buildYagrSetupStatus reports missing llm setup when runtime is not ready', () => {
  const status = buildYagrSetupStatus({
    llmConfigured: false,
    enabledSurfaces: [],
    startableSurfaces: [],
  });

  assert.equal(status.ready, false);
  assert.deepEqual(status.missingSteps, ['llm']);
});

test('buildYagrSetupStatus readiness depends only on llm setup', () => {
  const status = buildYagrSetupStatus({
    llmConfigured: true,
    enabledSurfaces: ['telegram', 'webui'],
    startableSurfaces: ['telegram'],
  });

  assert.equal(status.ready, true);
  assert.deepEqual(status.missingSteps, []);
});

test('getYagrSetupStatus treats the active webui as a startable surface', () => {
  const yagrConfigService = {
    getLocalConfig() {
      return { provider: 'openai', model: 'gpt-4o', gateway: { enabledSurfaces: [] } };
    },
    updateLocalConfig(updater) {
      return updater(this.getLocalConfig());
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

  const status = getYagrSetupStatus(yagrConfigService, { activeSurfaces: ['webui'] });

  assert.equal(status.ready, true);
  assert.deepEqual(status.missingSteps, []);
  assert.deepEqual(status.startableSurfaces, ['webui']);
});

test('getYagrSetupStatus accepts account-backed providers without api keys', () => {
  const yagrConfigService = {
    updateLocalConfig(updater) {
      return updater(this.getLocalConfig());
    },
    getLocalConfig() {
      return {
        provider: 'anthropic-proxy',
        model: 'claude-sonnet-4',
        baseUrl: 'http://127.0.0.1:3456/v1',
        gateway: { enabledSurfaces: [] },
      };
    },
    getEnabledGatewaySurfaces() {
      return [];
    },
    getApiKey() {
      return undefined;
    },
    getTelegramBotToken() {
      return undefined;
    },
  };

  const status = getYagrSetupStatus(yagrConfigService, { activeSurfaces: ['webui'] });

  assert.equal(status.llmConfigured, true);
  assert.equal(status.ready, true);
});
