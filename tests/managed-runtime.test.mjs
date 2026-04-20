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
    instanceProfile: 'yagr-managed-direct',
  });

  const state = getConfiguredManagedN8nState(configService);
  assert.ok(state);
  assert.equal(state?.strategy, 'direct');
  assert.equal(state?.url, 'http://127.0.0.1:5678');
});

test('getConfiguredManagedN8nState upgrades configs without explicit managed classification when managed state matches host', async (t) => {
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
  });

  const state = getConfiguredManagedN8nState(configService);
  assert.ok(state);
  assert.equal(state?.strategy, 'direct');
  assert.equal(state?.url, 'http://127.0.0.1:5678');
});

test('getConfiguredManagedN8nState upgrades custom-local profiles when managed runtime matches host', async (t) => {
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
    instanceProfile: 'custom-local-direct',
  });

  const state = getConfiguredManagedN8nState(configService);
  assert.ok(state);
  assert.equal(state?.strategy, 'docker');
  assert.equal(state?.url, 'http://127.0.0.1:5678');
});

test('getConfiguredExternalN8nReachabilityWarning returns a warning for unreachable external instances', async () => {
  const { getConfiguredExternalN8nReachabilityWarning } = await import(modulePath);

  const warning = await getConfiguredExternalN8nReachabilityWarning({
    getLocalConfig() {
      return {
        host: 'http://127.0.0.1:1',
        instanceProfile: 'custom-local-direct',
      };
    },
    getApiKey() {
      return 'test-n8n-key';
    },
  });

  assert.match(warning ?? '', /Configured external n8n instance is not reachable/);
});

test('prepareConfiguredN8nForLaunch reconciles managed startup when the instance is not fully connected', async (t) => {
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

  const { buildManagedN8nState, readManagedN8nState, writeManagedN8nState } = await import(stateModulePath);
  const { YagrN8nConfigService } = await import(configModulePath);
  const { prepareConfiguredN8nForLaunch } = await import(modulePath);

  const managedState = buildManagedN8nState({
    strategy: 'direct',
    image: '',
    port: 16578,
    status: 'ready',
    bootstrapStage: 'owner-pending',
  });
  writeManagedN8nState(managedState);

  const configService = new YagrN8nConfigService();
  configService.saveLocalConfig({
    host: managedState.url,
    syncFolder: 'workflows',
    instanceProfile: 'yagr-managed-direct',
  });

  let bootstrapCalls = 0;
  const completionCalls = [];
  const preparation = await prepareConfiguredN8nForLaunch(configService, {
    async ensureManagedRunning() {
      return { state: managedState, started: true };
    },
    async bootstrapManaged(url) {
      bootstrapCalls += 1;
      assert.equal(url, managedState.url);
      return { mode: 'silent', apiKey: 'fresh-api-key' };
    },
    setupServiceFactory() {
      return {
        async completeManagedN8nConnection(input) {
          completionCalls.push(input);
          return {
            project: { id: 'proj_1', name: 'Primary Project' },
            warning: undefined,
          };
        },
      };
    },
  });

  assert.equal(preparation.mode, 'yagr-managed-local');
  assert.equal(preparation.started, true);
  assert.equal(preparation.reconciled, true);
  assert.equal(bootstrapCalls, 1);
  assert.equal(completionCalls.length, 1);
  assert.equal(completionCalls[0].host, managedState.url);
  assert.equal(completionCalls[0].apiKey, 'fresh-api-key');
  assert.equal(readManagedN8nState()?.bootstrapStage, 'connected');
});

test('prepareConfiguredN8nForLaunch is idempotent for already connected managed instances', async (t) => {
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
  const { prepareConfiguredN8nForLaunch } = await import(modulePath);

  const managedState = buildManagedN8nState({
    strategy: 'docker',
    image: 'docker.n8n.io/n8nio/n8n:stable',
    port: 5678,
    status: 'ready',
    bootstrapStage: 'connected',
  });
  writeManagedN8nState(managedState);

  const configService = new YagrN8nConfigService();
  configService.saveApiKey(managedState.url, 'stored-api-key');
  configService.saveLocalConfig({
    host: managedState.url,
    syncFolder: 'workflows',
    projectId: 'proj_1',
    projectName: 'Primary Project',
    instanceProfile: 'yagr-managed-docker',
  });

  const preparation = await prepareConfiguredN8nForLaunch(configService, {
    async ensureManagedRunning() {
      return { state: managedState, started: false };
    },
    async bootstrapManaged() {
      assert.fail('bootstrap should not run for already connected instances');
    },
    setupServiceFactory() {
      return {
        async completeManagedN8nConnection() {
          assert.fail('connection persistence should not run for already connected instances');
        },
      };
    },
  });

  assert.equal(preparation.mode, 'yagr-managed-local');
  assert.equal(preparation.started, false);
  assert.equal(preparation.reconciled, false);
  assert.equal(preparation.warning, undefined);
});

test('ensureConfiguredManagedN8nRunning recovers a managed Docker runtime from persisted instanceProfile when state is missing', async (t) => {
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

  const { YagrN8nConfigService } = await import(configModulePath);
  const { ensureConfiguredManagedN8nRunning } = await import(modulePath);

  const configService = new YagrN8nConfigService();
  configService.saveLocalConfig({
    host: 'http://127.0.0.1:5678',
    syncFolder: 'workflows',
    instanceProfile: 'yagr-managed-docker',
  });

  const installCalls = [];
  const recoveredState = {
    strategy: 'docker',
    image: 'docker.n8n.io/n8nio/n8n:stable',
    port: 5678,
    url: 'http://127.0.0.1:5678',
    dataDir: path.join(tempHome, 'managed-data'),
    status: 'ready',
    bootstrapStage: 'runtime-only',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const result = await ensureConfiguredManagedN8nRunning(configService, {
    async installDocker(options) {
      installCalls.push(options);
      return recoveredState;
    },
  });

  assert.equal(result.started, true);
  assert.deepEqual(result.state, recoveredState);
  assert.deepEqual(installCalls, [{ port: 5678 }]);
});

test('ensureConfiguredManagedN8nRunning recreates stale managed state from persisted profile and configured host', async (t) => {
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
  const { ensureConfiguredManagedN8nRunning } = await import(modulePath);

  writeManagedN8nState(buildManagedN8nState({
    strategy: 'direct',
    image: '',
    port: 9999,
    status: 'ready',
    bootstrapStage: 'runtime-only',
  }));

  const configService = new YagrN8nConfigService();
  configService.saveLocalConfig({
    host: 'http://127.0.0.1:5678',
    syncFolder: 'workflows',
    instanceProfile: 'yagr-managed-docker',
  });

  let startDockerCalls = 0;
  let installDockerCalls = 0;
  const recoveredState = {
    strategy: 'docker',
    image: 'docker.n8n.io/n8nio/n8n:stable',
    port: 5678,
    url: 'http://127.0.0.1:5678',
    dataDir: path.join(tempHome, 'managed-data'),
    status: 'ready',
    bootstrapStage: 'runtime-only',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const result = await ensureConfiguredManagedN8nRunning(configService, {
    async startDocker() {
      startDockerCalls += 1;
      throw new Error('stale state should not trigger a direct restart');
    },
    async installDocker() {
      installDockerCalls += 1;
      return recoveredState;
    },
  });

  assert.equal(result.started, true);
  assert.deepEqual(result.state, recoveredState);
  assert.equal(startDockerCalls, 0);
  assert.equal(installDockerCalls, 1);
});
