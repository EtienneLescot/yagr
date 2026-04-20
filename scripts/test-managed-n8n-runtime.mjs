import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { N8nApiClient } from 'n8nac';

const TEST_MANAGED_HOME = resolveManagedTestHome();

function resolveManagedTestHome() {
  const configured = String(process.env.YAGR_IT_MANAGED_HOME || '').trim();
  if (configured) {
    return configured;
  }
  const uid = typeof process.getuid === 'function' ? String(process.getuid()) : 'user';
  return path.join(os.tmpdir(), `yagr-it-managed-n8n-${uid}`);
}

function withManagedTestHome(fn) {
  const previous = process.env.YAGR_HOME;
  process.env.YAGR_HOME = TEST_MANAGED_HOME;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previous === undefined) {
        delete process.env.YAGR_HOME;
      } else {
        process.env.YAGR_HOME = previous;
      }
    });
}

/**
 * Detect and remove a root-owned `data/` directory inside the managed test home.
 * This happens when Docker previously created the volume mount as root (uid=0).
 * We use `docker run --rm` to delete it without requiring sudo on the host.
 */
async function repairManagedDockerHome() {
  const dataDir = path.join(TEST_MANAGED_HOME, 'n8n', 'data');
  if (!fs.existsSync(dataDir)) {
    return;
  }

  let stat;
  try {
    stat = fs.statSync(dataDir);
  } catch {
    return;
  }

  // uid 0 = root — Docker created this; we can't rm it as the current user
  if (stat.uid !== 0) {
    return;
  }

  // Use a throw-away alpine container to delete the root-owned directory
  try {
    execFileSync(
      'docker',
      ['run', '--rm', '-v', `${dataDir}:/target`, 'alpine', 'sh', '-c', 'rm -rf /target/*'],
      { stdio: 'pipe' },
    );
    fs.rmdirSync(dataDir);
  } catch {
    // best effort; ensureManagedDockerTestRuntime will fail with a clear error if still broken
  }
}

export async function ensureManagedDockerTestRuntime() {
  await repairManagedDockerHome();
  return await withManagedTestHome(async () => {
    const { getManagedDockerN8nStatus, installManagedDockerN8n, startManagedDockerN8n } = await import('../dist/n8n-local/docker-manager.js');
    const { bootstrapManagedLocalN8n } = await import('../dist/n8n-local/bootstrap.js');
    const { YagrSetupApplicationService } = await import('../dist/setup/application-services.js');
    const { YagrConfigService } = await import('../dist/config/yagr-config-service.js');
    const { YagrN8nConfigService } = await import('../dist/config/n8n-config-service.js');

    const status = await getManagedDockerN8nStatus();
    let state;
    if (!status.installed) {
      state = await installManagedDockerN8n();
    } else if (!status.running || !status.healthy) {
      state = await startManagedDockerN8n();
    } else {
      state = status.state;
    }

    if (!state?.url) {
      throw new Error('Managed Docker n8n test runtime did not provide a URL.');
    }

    await assertManagedDockerRuntimeReady(state.url);

    const configService = new YagrN8nConfigService();
    const setupService = new YagrSetupApplicationService(new YagrConfigService(), configService);
    const existingApiKey = configService.getApiKey(state.url);
    if (existingApiKey && await isApiKeyValid(state.url, existingApiKey)) {
      await setupService.completeManagedN8nConnection({
        host: state.url,
        apiKey: existingApiKey,
        syncFolder: 'workflows',
        instanceProfile: 'yagr-managed-docker',
      });
      return {
        host: state.url,
        apiKey: existingApiKey,
        projectId: 'personal',
        configured: true,
        instanceProfile: 'yagr-managed-docker',
        instanceIdentifier: 'yagr-managed',
        managedHome: TEST_MANAGED_HOME,
      };
    }

    const bootstrap = await bootstrapManagedLocalN8n({ url: state.url });
    if (!bootstrap.apiKey) {
      throw new Error(`Managed Docker n8n bootstrap failed: ${bootstrap.reason || 'API key was not generated.'}`);
    }

    await setupService.completeManagedN8nConnection({
      host: state.url,
      apiKey: bootstrap.apiKey,
      syncFolder: 'workflows',
      instanceProfile: 'yagr-managed-docker',
    });

    return {
      host: state.url,
      apiKey: bootstrap.apiKey,
      projectId: 'personal',
      configured: true,
      instanceProfile: 'yagr-managed-docker',
      instanceIdentifier: 'yagr-managed',
      managedHome: TEST_MANAGED_HOME,
    };
  });
}

async function assertManagedDockerRuntimeReady(host) {
  const baseUrl = String(host || '').replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('Managed Docker n8n runtime did not provide a host.');
  }

  const startedAt = Date.now();
  const timeoutMs = 30_000;

  // Phase 1: wait for healthz (process alive)
  while ((Date.now() - startedAt) < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) {
        break;
      }
    } catch {
      // keep polling
    }
    if ((Date.now() - startedAt) >= timeoutMs) {
      throw new Error(`Managed Docker n8n runtime is not healthy at ${baseUrl}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Phase 2: wait for REST API to accept connections (any HTTP response = API ready)
  while ((Date.now() - startedAt) < timeoutMs) {
    try {
      await fetch(`${baseUrl}/api/v1/`);
      // Any HTTP response (including 401 Unauthorized) means the API is up
      return;
    } catch {
      // connection refused / socket hang up = not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Managed Docker n8n REST API did not become ready at ${baseUrl}.`);
}

async function isApiKeyValid(host, apiKey) {
  const baseUrl = String(host || '').replace(/\/+$/, '');
  if (!baseUrl || !apiKey) {
    return false;
  }

  try {
    const response = await fetch(`${baseUrl}/api/v1/workflows?limit=1`, {
      headers: { 'X-N8N-API-KEY': apiKey },
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function stopManagedDockerTestRuntime() {
  await withManagedTestHome(async () => {
    const { getManagedDockerN8nStatus, stopManagedDockerN8n } = await import('../dist/n8n-local/docker-manager.js');
    const status = await getManagedDockerN8nStatus();
    if (status.installed && status.running) {
      await stopManagedDockerN8n();
    }
  });
}

export async function cleanManagedDockerTestRuntimeWorkflows(runtime) {
  const host = String(runtime?.host || '').trim();
  const apiKey = String(runtime?.apiKey || '').trim();
  if (!host || !apiKey) {
    return { deleted: 0 };
  }

  const client = new N8nApiClient({ host, apiKey });
  const workflows = await fetchAllWorkflows(host, apiKey);
  for (const workflow of workflows) {
    await client.deleteWorkflow(String(workflow.id)).catch(async () => {
      await fetch(`${host.replace(/\/+$/, '')}/api/v1/workflows/${workflow.id}/deactivate`, {
        method: 'POST',
        headers: { 'X-N8N-API-KEY': apiKey, 'Content-Type': 'application/json' },
      }).catch(() => undefined);
      await client.deleteWorkflow(String(workflow.id));
    });
  }

  return { deleted: workflows.length };
}

async function fetchAllWorkflows(host, apiKey) {
  const baseUrl = host.replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/api/v1/workflows?limit=250`, {
    headers: { 'X-N8N-API-KEY': apiKey },
  });
  if (!response.ok) {
    throw new Error(`Failed to list workflows from managed test n8n: HTTP ${response.status}`);
  }
  const payload = await response.json();
  return Array.isArray(payload?.data) ? payload.data : [];
}
