/**
 * Yagr Manager tooling: yagrProxy
 *
 * This tool is owned by yagr-manager, not yagr-agent.
 * It is registered dynamically when the n8n engine is active.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { getYagrN8nWorkspaceDir, getYagrPaths } from '../config/yagr-home.js';
import { YagrConfigService } from '../config/yagr-config-service.js';
import { YagrN8nConfigService } from '../config/n8n-config-service.js';
import { resolvePackageManagerCommand, resolvePackageManagerSpawnOptions } from '../system/package-manager.js';
import { emitToolEvent, type ToolExecutionObserver } from '../tools/observer.js';
import {
  buildRelayInfo,
  ensureN8nRelayServer,
  getN8nRelayState,
  N8N_RELAY_CREDENTIAL_NAME,
  N8N_RELAY_FAKE_API_KEY,
} from '../llm/llm-relay-server.js';
import { parseJsonPayload } from '../tools/fs-utils.js';

type RunResult = { stdout: string; stderr: string; exitCode: number };

/**
 * Resolve which n8nac package to use based on YAGR_N8NAC_VERSION env var.
 * - Empty/unset: uses stable 'n8nac' from npm
 * - '@next': uses 'n8nac@next' preview release
 * - Other values: passed as-is (e.g., '1.5.2', '@beta')
 */
function resolveN8nacPackage(): string {
  const version = String(process.env.YAGR_N8NAC_VERSION || '').trim();
  if (!version) {
    return 'n8nac'; // stable
  }
  return version.startsWith('@') ? `n8nac${version}` : `n8nac@${version}`;
}

/**
 * Internal helper: runs n8nac as a subprocess.
 * Used only by yagrProxy for manager-side credential lifecycle operations.
 */
async function runN8nacCommand(args: string[], cwd: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const n8nacPackage = resolveN8nacPackage();
    const child = spawn(resolvePackageManagerCommand('npx'), ['--yes', n8nacPackage, ...args], {
      cwd,
      env: { ...process.env },
      stdio: 'pipe',
      ...resolvePackageManagerSpawnOptions(),
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', (err) => resolve({ stdout, stderr: err.message, exitCode: 1 }));
    child.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
  });
}

async function listYagrProxyCredentials(cwd: string): Promise<Array<{ id?: string; name?: string; type?: string }>> {
  const listResult = await runN8nacCommand(['credential', 'list', '--json'], cwd);
  const existingList = parseJsonPayload(listResult.stdout);
  return Array.isArray(existingList)
    ? existingList as Array<{ id?: string; name?: string; type?: string }>
    : [];
}

/**
 * Resolve the active n8n host from the n8nac-config.json in the workspace.
 */
function resolveN8nHost(cwd: string): string | undefined {
  const configPath = path.join(cwd, 'n8nac-config.json');
  if (!fs.existsSync(configPath)) return undefined;
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
      activeInstanceId?: string;
      instances?: Array<{ id: string; host: string }>;
    };
    const instances = config.instances ?? [];
    const active = instances.find((i) => i.id === config.activeInstanceId) ?? instances[0];
    return active?.host;
  } catch {
    return undefined;
  }
}

/**
 * Patch an existing n8n credential in-place via the REST API so that its
 * base URL is updated without changing the credential ID.
 *
 * This preserves all workflow-node references to that credential, which are
 * stored by ID in n8n — a delete+create would produce a new ID and break them.
 *
 * Returns true on success, false if the patch could not be performed (in which
 * case the caller should fall back to delete+create).
 */
async function patchN8nCredentialUrl(credentialId: string, newBaseUrl: string, cwd: string): Promise<boolean> {
  const n8nHost = resolveN8nHost(cwd);
  if (!n8nHost) return false;
  const apiKey = new YagrN8nConfigService().getApiKey(n8nHost);
  if (!apiKey) return false;
  try {
    const response = await fetch(`${n8nHost}/api/v1/credentials/${credentialId}`, {
      method: 'PATCH',
      headers: { 'X-N8N-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: N8N_RELAY_CREDENTIAL_NAME,
        type: 'openAiApi',
        data: { apiKey: N8N_RELAY_FAKE_API_KEY, url: newBaseUrl, headerName: '', headerValue: '' },
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function ensureYagrProxyCredential() {
  const cwd = getYagrN8nWorkspaceDir();
  const relay = await ensureN8nRelayServer();
  const effectiveRelayBaseUrl = relay.baseUrl;
  const existingCredentials = await listYagrProxyCredentials(cwd);
  const existing = existingCredentials.find(
    (c) => c.name === N8N_RELAY_CREDENTIAL_NAME && c.type === 'openAiApi',
  );

  if (existing?.id) {
    const confirmedUrl = (new YagrConfigService()).getLocalConfig().llmProxy?.confirmedCredentialBaseUrl;
    if (confirmedUrl === effectiveRelayBaseUrl) {
      return {
        credentialId: existing.id,
        created: false,
        reused: true,
        baseUrl: effectiveRelayBaseUrl,
        port: relay.port,
      };
    }

    // URL changed — patch in-place to preserve the credential ID so that
    // existing workflow-node references (stored by ID in n8n) remain valid.
    const patched = await patchN8nCredentialUrl(existing.id, effectiveRelayBaseUrl, cwd);
    if (patched) {
      (new YagrConfigService()).updateLlmProxyCredentialBaseUrl(effectiveRelayBaseUrl);
      return {
        credentialId: existing.id,
        created: false,
        reused: false,
        baseUrl: effectiveRelayBaseUrl,
        port: relay.port,
      };
    }

    // Patch unavailable — fall back to delete+create.
    await runN8nacCommand(['credential', 'delete', existing.id], cwd);
  }

  const credData = JSON.stringify({ apiKey: N8N_RELAY_FAKE_API_KEY, url: effectiveRelayBaseUrl });
  const createResult = await runN8nacCommand(
    ['credential', 'create', '--type', 'openAiApi', '--name', N8N_RELAY_CREDENTIAL_NAME, '--data', credData, '--json'],
    cwd,
  );
  const created = parseJsonPayload(createResult.stdout) as Record<string, unknown> | undefined;

  if (createResult.exitCode !== 0) {
    throw new Error(createResult.stderr || `Failed to create ${N8N_RELAY_CREDENTIAL_NAME} credential.`);
  }

  (new YagrConfigService()).updateLlmProxyCredentialBaseUrl(effectiveRelayBaseUrl);
  return {
    credentialId: (created?.id as string | undefined) ?? null,
    created: true,
    reused: false,
    baseUrl: effectiveRelayBaseUrl,
    port: relay.port,
  };
}

export async function getYagrProxyStatus() {
  const cwd = getYagrN8nWorkspaceDir();
  const relayState = getN8nRelayState();
  const proxyConfig = new YagrConfigService().getLocalConfig().llmProxy;
  const existingCredentials = await listYagrProxyCredentials(cwd);
  const existing = existingCredentials.find(
    (c) => c.name === N8N_RELAY_CREDENTIAL_NAME && c.type === 'openAiApi',
  );

  const expectedBaseUrl = relayState?.port && proxyConfig?.enabled
    ? buildRelayInfo(relayState.port).baseUrl
    : undefined;

  const confirmedBaseUrl = proxyConfig?.confirmedCredentialBaseUrl;
  const credentialStatus = !existing?.id
    ? 'missing'
    : expectedBaseUrl && confirmedBaseUrl && expectedBaseUrl !== confirmedBaseUrl
      ? 'stale'
      : 'ready';

  return {
    operation: 'yagrProxy',
    success: true,
    relayRunning: Boolean(relayState),
    relayPort: relayState?.port ?? null,
    configured: Boolean(proxyConfig?.enabled),
    expectedBaseUrl: expectedBaseUrl ?? null,
    confirmedBaseUrl: confirmedBaseUrl ?? null,
    credentialFound: Boolean(existing?.id),
    credentialId: existing?.id ?? null,
    credentialName: N8N_RELAY_CREDENTIAL_NAME,
    credentialType: 'openAiApi',
    credentialStatus,
    next: !proxyConfig?.enabled
      ? 'LLM proxy is not configured. Run `yagr llm proxy setup`.'
      : !relayState
        ? 'LLM proxy is configured but the relay is not running. Start Yagr or rerun setup.'
        : credentialStatus === 'missing'
          ? 'Credential is missing. Rerun `yagr llm proxy setup` to provision it.'
          : credentialStatus === 'stale'
            ? 'Credential base URL is stale. Rerun `yagr llm proxy setup` to reprovision it.'
            : `Credential "${N8N_RELAY_CREDENTIAL_NAME}" is ready to assign to the node.`,
  };
}

export async function runYagrProxyCli() {
  return getYagrProxyStatus();
}

/**
 * Syncs the n8n "Yagr LLM Proxy" credential whenever the LLM config or relay
 * state may have changed (e.g. after `yagr llm setup`, or at startup when the
 * relay restarted on a different port).
 *
 * Guards:
 *  1. llmProxy.enabled must be true (user opted in).
 *  2. The n8nac workspace must be initialised (n8nac-config.json present) so
 *     that credential CLI commands have a valid target.
 *
 * Always resolves — callers should NOT propagate errors from this function.
 */
export async function syncProxyCredentialIfEnabled(): Promise<void> {
  const configService = new YagrConfigService();
  if (!configService.getLocalConfig().llmProxy?.enabled) return;
  const { n8nConfigPath } = getYagrPaths();
  if (!fs.existsSync(n8nConfigPath)) return;
  await ensureYagrProxyCredential();
}

export function createYagrProxyTool(observer?: ToolExecutionObserver) {
  return new DynamicStructuredTool({
    name: 'yagrProxy',
    description:
      'Reads the current Yagr LLM proxy status and returns the provisioned openAiApi credential when available. '
      + 'Call this when you need to inspect which Yagr-managed LLM credential should be assigned to an n8n node.',
    schema: z.object({}),
    func: async () => {
      await emitToolEvent(observer, {
        type: 'status',
        toolName: 'yagrProxy',
        message: 'Inspecting Yagr LLM proxy status',
      });
      return JSON.stringify(await runYagrProxyCli());
    },
  });
}
