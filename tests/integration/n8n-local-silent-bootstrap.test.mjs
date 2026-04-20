import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import net from 'node:net';
import { promisify } from 'node:util';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOCKER_COMPOSE_TIMEOUT_MS = Number.parseInt(process.env.YAGR_N8N_DOCKER_COMPOSE_TIMEOUT_MS ?? '600000', 10);
const COLD_START_SCRIPT_TIMEOUT_MS = DOCKER_COMPOSE_TIMEOUT_MS + 60_000;
const COLD_START_TEST_TIMEOUT_MS = COLD_START_SCRIPT_TIMEOUT_MS + 60_000;

function parseLastJsonLine(stdout) {
  const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!line) {
    throw new Error('Test script did not emit a JSON payload.');
  }

  return JSON.parse(line);
}

async function isDockerHostAvailable() {
  try {
    await execFileAsync('docker', ['info'], { timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

async function allocateLocalPort() {
  await new Promise((resolve) => setTimeout(resolve, 50));
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not resolve a free local port.')));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

test('managed local n8n can bootstrap owner and API key silently', async (t) => {
  if (!(await isDockerHostAvailable())) {
    t.skip('Docker host is not available for integration tests.');
    return;
  }

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-n8n-silent-'));
  const port = await allocateLocalPort();
  const env = {
    ...process.env,
    YAGR_HOME: tempHome,
  };

  t.after(async () => {
    try {
      await execFileAsync('node', ['dist/cli.js', 'n8n', 'local', 'stop'], {
        cwd: repoRoot,
        env,
        timeout: 120_000,
      });
    } catch {
      // Ignore cleanup failures for already-stopped instances.
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  const bootstrapScript = `
    import { N8nApiClient } from 'n8nac';
    import { bootstrapManagedLocalN8n } from './dist/n8n-local/bootstrap.js';
    import { installManagedDockerN8n } from './dist/n8n-local/docker-manager.js';
    import { readManagedN8nState } from './dist/n8n-local/state.js';

    await installManagedDockerN8n({ port: ${port} });
    const state = readManagedN8nState();
    if (!state) {
      throw new Error('Managed n8n state is missing after install.');
    }

    const result = await bootstrapManagedLocalN8n({ url: state.url });
    const client = new N8nApiClient({ host: state.url, apiKey: result.apiKey });
    const connected = await client.testConnection();
    const projects = await client.getProjects();

    console.log(JSON.stringify({
      mode: result.mode,
      hasApiKey: Boolean(result.apiKey),
      ownerEmail: result.ownerCredentials?.email,
      connected,
      projectCount: projects.length,
    }));
  `;

  const bootstrap = await execFileAsync('node', ['--input-type=module', '-e', bootstrapScript], {
    cwd: repoRoot,
    env,
    timeout: COLD_START_SCRIPT_TIMEOUT_MS,
  });

  const payload = parseLastJsonLine(bootstrap.stdout);
  assert.equal(payload.mode, 'silent');
  assert.equal(payload.hasApiKey, true);
  assert.match(payload.ownerEmail, /@local\.yagr$/);
  assert.equal(payload.connected, true);
  assert.ok(payload.projectCount >= 1);
}, COLD_START_TEST_TIMEOUT_MS);

test('managed local n8n can silently bootstrap immediately after install', async (t) => {
  if (!(await isDockerHostAvailable())) {
    t.skip('Docker host is not available for integration tests.');
    return;
  }

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-n8n-silent-immediate-'));
  const port = await allocateLocalPort();
  const env = {
    ...process.env,
    YAGR_HOME: tempHome,
  };

  t.after(async () => {
    try {
      await execFileAsync('node', ['dist/cli.js', 'n8n', 'local', 'stop'], {
        cwd: repoRoot,
        env,
        timeout: 120_000,
      });
    } catch {
      // Ignore cleanup failures for already-stopped instances.
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  const bootstrapScript = `
    import { bootstrapManagedLocalN8n } from './dist/n8n-local/bootstrap.js';
    import { installManagedDockerN8n } from './dist/n8n-local/docker-manager.js';
    import { readManagedN8nState } from './dist/n8n-local/state.js';

    const installPromise = installManagedDockerN8n({ port: ${port} });
    let state;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      state = readManagedN8nState();
      if (state) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!state) throw new Error('Managed n8n state was not persisted early enough.');
    const result = await bootstrapManagedLocalN8n({ url: state.url });
    await installPromise;

    console.log(JSON.stringify({
      mode: result.mode,
      hasApiKey: Boolean(result.apiKey),
    }));
  `;

  const bootstrap = await execFileAsync('node', ['--input-type=module', '-e', bootstrapScript], {
    cwd: repoRoot,
    env,
    timeout: COLD_START_SCRIPT_TIMEOUT_MS,
  });

  const payload = parseLastJsonLine(bootstrap.stdout);
  assert.equal(payload.mode, 'silent');
  assert.equal(payload.hasApiKey, true);
}, COLD_START_TEST_TIMEOUT_MS);

test('managed local n8n can silently bootstrap again using stored owner credentials', async (t) => {
  if (!(await isDockerHostAvailable())) {
    t.skip('Docker host is not available for integration tests.');
    return;
  }

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-n8n-silent-reuse-'));
  const port = await allocateLocalPort();
  const env = {
    ...process.env,
    YAGR_HOME: tempHome,
  };

  t.after(async () => {
    try {
      await execFileAsync('node', ['dist/cli.js', 'n8n', 'local', 'stop'], {
        cwd: repoRoot,
        env,
        timeout: 120_000,
      });
    } catch {
      // Ignore cleanup failures for already-stopped instances.
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  const bootstrapScript = `
    import { bootstrapManagedLocalN8n } from './dist/n8n-local/bootstrap.js';
    import { installManagedDockerN8n } from './dist/n8n-local/docker-manager.js';
    import { readManagedN8nState } from './dist/n8n-local/state.js';

    await installManagedDockerN8n({ port: ${port} });
    const state = readManagedN8nState();
    if (!state) throw new Error('Managed n8n state is missing after install.');

    const first = await bootstrapManagedLocalN8n({ url: state.url });
    const second = await bootstrapManagedLocalN8n({ url: state.url });

    console.log(JSON.stringify({
      firstMode: first.mode,
      secondMode: second.mode,
      firstApiKey: Boolean(first.apiKey),
      secondApiKey: Boolean(second.apiKey),
      sameEmail: first.ownerCredentials?.email === second.ownerCredentials?.email,
    }));
  `;

  const bootstrap = await execFileAsync('node', ['--input-type=module', '-e', bootstrapScript], {
    cwd: repoRoot,
    env,
    timeout: COLD_START_SCRIPT_TIMEOUT_MS,
  });

  const payload = parseLastJsonLine(bootstrap.stdout);
  assert.equal(payload.firstMode, 'silent');
  assert.equal(payload.secondMode, 'silent');
  assert.equal(payload.firstApiKey, true);
  assert.equal(payload.secondApiKey, true);
  assert.equal(payload.sameEmail, true);
}, COLD_START_TEST_TIMEOUT_MS);

test('managed local startup recreates a connected Docker runtime when the managed state file is missing', async (t) => {
  if (!(await isDockerHostAvailable())) {
    t.skip('Docker host is not available for integration tests.');
    return;
  }

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-n8n-startup-recovery-'));
  const port = await allocateLocalPort();
  const env = {
    ...process.env,
    YAGR_HOME: tempHome,
  };

  t.after(async () => {
    try {
      await execFileAsync('node', ['dist/cli.js', 'n8n', 'local', 'stop'], {
        cwd: repoRoot,
        env,
        timeout: 120_000,
      });
    } catch {
      // Ignore cleanup failures for already-stopped instances.
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  const startupScript = `
    import fs from 'node:fs';
    import { YagrN8nConfigService } from './dist/config/n8n-config-service.js';
    import { YagrSetupApplicationService } from './dist/setup/application-services.js';
    import { YagrConfigService } from './dist/config/yagr-config-service.js';
    import { installManagedDockerN8n, stopManagedDockerN8n } from './dist/n8n-local/docker-manager.js';
    import { bootstrapManagedLocalN8n } from './dist/n8n-local/bootstrap.js';
    import { prepareConfiguredN8nForLaunch } from './dist/n8n-local/managed-runtime.js';
    import { readManagedN8nState, getManagedN8nPaths } from './dist/n8n-local/state.js';

    const n8nConfig = new YagrN8nConfigService();
    const setupService = new YagrSetupApplicationService(new YagrConfigService(), n8nConfig);

    await installManagedDockerN8n({ port: ${port} });
    const installedState = readManagedN8nState();
    if (!installedState) throw new Error('Managed n8n state is missing after install.');

    const bootstrap = await bootstrapManagedLocalN8n({ url: installedState.url });
    if (!bootstrap.apiKey) throw new Error('Silent bootstrap did not return an API key.');
    await setupService.completeManagedN8nConnection({
      host: installedState.url,
      apiKey: bootstrap.apiKey,
      instanceProfile: 'yagr-managed-docker',
    });

    await stopManagedDockerN8n();
    fs.unlinkSync(getManagedN8nPaths().stateFile);

    const preparation = await prepareConfiguredN8nForLaunch(n8nConfig);
    const recoveredState = readManagedN8nState();

    console.log(JSON.stringify({
      started: preparation.started,
      reconciled: preparation.reconciled,
      mode: preparation.mode,
      stateStrategy: preparation.state?.strategy,
      stateUrl: preparation.state?.url,
      recoveredStateExists: Boolean(recoveredState),
      recoveredBootstrapStage: recoveredState?.bootstrapStage,
      instanceProfile: n8nConfig.getLocalConfig().instanceProfile,
      projectId: n8nConfig.getLocalConfig().projectId,
      projectName: n8nConfig.getLocalConfig().projectName,
      apiKeyPresent: Boolean(n8nConfig.getApiKey(installedState.url)),
    }));
  `;

  const startup = await execFileAsync('node', ['--input-type=module', '-e', startupScript], {
    cwd: repoRoot,
    env,
    timeout: COLD_START_SCRIPT_TIMEOUT_MS,
  });

  const payload = parseLastJsonLine(startup.stdout);
  assert.equal(payload.mode, 'yagr-managed-local');
  assert.equal(typeof payload.started, 'boolean');
  assert.equal(payload.reconciled, false);
  assert.equal(payload.stateStrategy, 'docker');
  assert.equal(payload.stateUrl, `http://127.0.0.1:${port}`);
  assert.equal(payload.recoveredStateExists, true);
  assert.equal(payload.recoveredBootstrapStage, 'connected');
  assert.equal(payload.instanceProfile, 'yagr-managed-docker');
  assert.ok(payload.projectId);
  assert.ok(payload.projectName);
  assert.equal(payload.apiKeyPresent, true);
}, COLD_START_TEST_TIMEOUT_MS);
