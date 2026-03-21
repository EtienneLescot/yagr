import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const modulePath = '../dist/n8n-local/managed-runtime.js';
const stateModulePath = '../dist/n8n-local/state.js';
const configModulePath = '../dist/config/n8n-config-service.js';

test('getConfiguredManagedN8nState returns managed state when configured host matches', async (t) => {
  const previousHome = process.env.YAGR_HOME;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-managed-runtime-'));
  process.env.YAGR_HOME = tempHome;

  t.after(() => {
    if (previousHome === undefined) {
      delete process.env.YAGR_HOME;
    } else {
      process.env.YAGR_HOME = previousHome;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  const { buildManagedN8nState, writeManagedN8nState } = await import(stateModulePath);
  const { YagrN8nConfigService } = await import(configModulePath);
  const { getConfiguredManagedN8nState } = await import(modulePath);

  writeManagedN8nState(buildManagedN8nState({
    strategy: 'direct',
    image: '',
    port: 5678,
    status: 'ready',
    bootstrapStage: 'connected',
  }));

  const configService = new YagrN8nConfigService();
  configService.saveLocalConfig({
    host: 'http://127.0.0.1:5678',
    syncFolder: 'workflows',
    projectId: 'p1',
    projectName: 'Demo',
    runtimeSource: 'managed-local',
  });

  const state = getConfiguredManagedN8nState(configService);
  assert.ok(state);
  assert.equal(state?.strategy, 'direct');
  assert.equal(state?.url, 'http://127.0.0.1:5678');
});

test('getConfiguredManagedN8nState ignores external configured instances even when the host matches', async (t) => {
  const previousHome = process.env.YAGR_HOME;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-managed-runtime-'));
  process.env.YAGR_HOME = tempHome;

  t.after(() => {
    if (previousHome === undefined) {
      delete process.env.YAGR_HOME;
    } else {
      process.env.YAGR_HOME = previousHome;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  const { buildManagedN8nState, writeManagedN8nState } = await import(stateModulePath);
  const { YagrN8nConfigService } = await import(configModulePath);
  const { getConfiguredManagedN8nState } = await import(modulePath);

  writeManagedN8nState(buildManagedN8nState({
    strategy: 'docker',
    image: 'docker.n8n.io/n8nio/n8n:stable',
    port: 5678,
    status: 'ready',
    bootstrapStage: 'connected',
  }));

  const configService = new YagrN8nConfigService();
  configService.saveLocalConfig({
    host: 'http://127.0.0.1:5678',
    syncFolder: 'workflows',
    projectId: 'p1',
    projectName: 'Demo',
    runtimeSource: 'external',
  });

  const state = getConfiguredManagedN8nState(configService);
  assert.equal(state, undefined);
});

test('getConfiguredExternalN8nReachabilityWarning returns a warning for unreachable external instances', async () => {
  const { getConfiguredExternalN8nReachabilityWarning } = await import(modulePath);

  const warning = await getConfiguredExternalN8nReachabilityWarning({
    getLocalConfig() {
      return {
        host: 'http://127.0.0.1:1',
        runtimeSource: 'external',
      };
    },
    getApiKey() {
      return 'test-n8n-key';
    },
  });

  assert.match(warning ?? '', /Configured external n8n instance is not reachable/);
});
