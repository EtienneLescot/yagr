/**
 * Yagr Manager tooling: yagrProxy
 *
 * This tool is owned by yagr-manager, not yagr-agent.
 * It is registered dynamically when the n8n engine is active.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { N8nCredentialsManager, N8nRestCredentialClient, type N8nCredentialRef } from '@n8n-as-code/n8n-credentials-manager';
import { getYagrN8nWorkspaceDir, getYagrPaths } from '../config/yagr-home.js';
import { YagrConfigService } from '../config/yagr-config-service.js';
import { YagrN8nConfigService } from '../config/n8n-config-service.js';
import { emitToolEvent, type ToolExecutionObserver } from '../tools/observer.js';
import {
  buildRelayInfo,
  ensureN8nRelayServer,
  getN8nRelayState,
  N8N_RELAY_CREDENTIAL_NAME,
  N8N_RELAY_FAKE_API_KEY,
} from '../llm/llm-relay-server.js';
import { parseJsonPayload } from '../tools/fs-utils.js';

async function probeRelayHealth(url: string): Promise<{
  ok: boolean;
  status?: number;
  body?: unknown;
  error?: string;
}> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5_000),
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      body: parseJsonPayload(text) ?? text.slice(0, 500),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildYagrProxyCredentialData(baseUrl: string): Record<string, string> {
  return { apiKey: N8N_RELAY_FAKE_API_KEY, url: baseUrl };
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

function createYagrN8nCredentialsManager(): {
  manager: N8nCredentialsManager;
  client?: N8nRestCredentialClient;
} {
  const configService = new YagrN8nConfigService();
  const n8nConfig = configService.getLocalConfig();
  const host = n8nConfig.host ?? resolveN8nHost(getYagrN8nWorkspaceDir());
  const apiKey = host ? configService.getApiKey(host) : undefined;
  const client = host && apiKey
    ? new N8nRestCredentialClient({ baseUrl: host, apiKey })
    : undefined;

  return {
    manager: new N8nCredentialsManager({
      client,
      projectId: n8nConfig.projectId,
    }),
    client,
  };
}

async function listYagrProxyCredentials(): Promise<N8nCredentialRef[]> {
  const { client } = createYagrN8nCredentialsManager();
  if (!client) return [];
  return client.listCredentials();
}

export async function ensureYagrProxyCredential() {
  const relay = await ensureN8nRelayServer();
  const effectiveRelayBaseUrl = relay.baseUrl;
  const { manager } = createYagrN8nCredentialsManager();
  const existingCredentials = await listYagrProxyCredentials();
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

    const ref = await manager.ensureCredential('llm-proxy', {
      credentialName: N8N_RELAY_CREDENTIAL_NAME,
      values: buildYagrProxyCredentialData(effectiveRelayBaseUrl),
    });
    (new YagrConfigService()).updateLlmProxyCredentialBaseUrl(effectiveRelayBaseUrl);
    return {
      credentialId: ref.id || existing.id,
      created: false,
      reused: false,
      baseUrl: effectiveRelayBaseUrl,
      port: relay.port,
    };
  }

  const ref = await manager.ensureCredential('llm-proxy', {
    credentialName: N8N_RELAY_CREDENTIAL_NAME,
    values: buildYagrProxyCredentialData(effectiveRelayBaseUrl),
  });
  (new YagrConfigService()).updateLlmProxyCredentialBaseUrl(effectiveRelayBaseUrl);
  return {
    credentialId: ref.id || null,
    created: true,
    reused: false,
    baseUrl: effectiveRelayBaseUrl,
    port: relay.port,
  };
}

export async function getYagrProxyStatus() {
  const relayState = getN8nRelayState();
  const proxyConfig = new YagrConfigService().getLocalConfig().llmProxy;
  const existingCredentials = await listYagrProxyCredentials();
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
  const relayInfo = relayState?.port ? buildRelayInfo(relayState.port) : undefined;
  const relayHealthUrl = relayInfo ? `${relayInfo.hostBaseUrl}/health` : undefined;
  const relayProbe = relayHealthUrl ? await probeRelayHealth(relayHealthUrl) : null;

  return {
    operation: 'yagrProxy',
    success: true,
    relayRunning: Boolean(relayState),
    relayPort: relayState?.port ?? null,
    relayHealthUrl: relayHealthUrl ?? null,
    relayProbe,
    relayLogPath: path.join(getYagrPaths().proxyRuntimeDir, 'logs', 'llm-relay.log'),
    configured: Boolean(proxyConfig?.enabled),
    proxyMode: proxyConfig?.mode ?? null,
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
