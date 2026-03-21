import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function isDockerHostAvailable() {
  try {
    await execFileAsync('docker', ['info'], { timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

test('managed local n8n can bootstrap owner and API key silently', async (t) => {
  if (!(await isDockerHostAvailable())) {
    t.skip('Docker host is not available for integration tests.');
    return;
  }

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-n8n-silent-'));
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

    await installManagedDockerN8n({ port: 5680 });
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
    timeout: 180_000,
  });

  const payload = JSON.parse(bootstrap.stdout);
  assert.equal(payload.mode, 'silent');
  assert.equal(payload.hasApiKey, true);
  assert.match(payload.ownerEmail, /@local\.yagr$/);
  assert.equal(payload.connected, true);
  assert.ok(payload.projectCount >= 1);
}, 300_000);

test('managed local n8n can silently bootstrap immediately after install', async (t) => {
  if (!(await isDockerHostAvailable())) {
    t.skip('Docker host is not available for integration tests.');
    return;
  }

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-n8n-silent-immediate-'));
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

    const installPromise = installManagedDockerN8n({ port: 5683 });
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
    timeout: 180_000,
  });

  const payload = JSON.parse(bootstrap.stdout);
  assert.equal(payload.mode, 'silent');
  assert.equal(payload.hasApiKey, true);
}, 300_000);

test('managed local n8n can silently bootstrap again using stored owner credentials', async (t) => {
  if (!(await isDockerHostAvailable())) {
    t.skip('Docker host is not available for integration tests.');
    return;
  }

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-n8n-silent-reuse-'));
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

    await installManagedDockerN8n({ port: 5682 });
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
    timeout: 180_000,
  });

  const payload = JSON.parse(bootstrap.stdout);
  assert.equal(payload.firstMode, 'silent');
  assert.equal(payload.secondMode, 'silent');
  assert.equal(payload.firstApiKey, true);
  assert.equal(payload.secondApiKey, true);
  assert.equal(payload.sameEmail, true);
}, 300_000);
