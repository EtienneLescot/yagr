import os from 'node:os';
import path from 'node:path';
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

export async function ensureManagedDockerTestRuntime() {
  return await withManagedTestHome(async () => {
    const { getManagedDockerN8nStatus, installManagedDockerN8n, startManagedDockerN8n } = await import('../dist/n8n-local/docker-manager.js');
    const { bootstrapManagedLocalN8n } = await import('../dist/n8n-local/bootstrap.js');
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

    const configService = new YagrN8nConfigService();
    const existingApiKey = configService.getApiKey(state.url);
    if (existingApiKey && await isApiKeyValid(state.url, existingApiKey)) {
      return {
        host: state.url,
        apiKey: existingApiKey,
        projectId: 'personal',
        configured: true,
        managedHome: TEST_MANAGED_HOME,
      };
    }

    const bootstrap = await bootstrapManagedLocalN8n({ url: state.url });
    if (!bootstrap.apiKey) {
      throw new Error(`Managed Docker n8n bootstrap failed: ${bootstrap.reason || 'API key was not generated.'}`);
    }

    configService.saveApiKey(state.url, bootstrap.apiKey);

    return {
      host: state.url,
      apiKey: bootstrap.apiKey,
      projectId: 'personal',
      configured: true,
      managedHome: TEST_MANAGED_HOME,
    };
  });
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