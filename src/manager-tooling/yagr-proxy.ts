/**
 * Yagr Manager tooling: yagrProxy
 *
 * This tool is owned by yagr-manager, not yagr-agent.
 * It is registered dynamically when the n8n engine is active.
 */

import { spawn } from 'node:child_process';
import { tool } from 'ai';
import { z } from 'zod';
import { YagrN8nConfigService } from '../config/n8n-config-service.js';
import { getYagrN8nWorkspaceDir } from '../config/yagr-home.js';
import { YagrConfigService } from '../config/yagr-config-service.js';
import { resolvePackageManagerCommand, resolvePackageManagerSpawnOptions } from '../system/package-manager.js';
import { emitToolEvent, type ToolExecutionObserver } from '../tools/observer.js';
import {
  ensureN8nRelayServer,
  N8N_RELAY_CREDENTIAL_NAME,
  N8N_RELAY_FAKE_API_KEY,
  resolveDockerHostAddress,
  type N8nRelayInfo,
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

export async function resolveYagrProxyCredentialBaseUrl(relay: N8nRelayInfo): Promise<string> {
  const runtimeSource = new YagrN8nConfigService().getLocalConfig().runtimeSource;

  if (runtimeSource === 'managed-local') {
    const dockerHost = await resolveDockerHostAddress();
    if (dockerHost && dockerHost !== '127.0.0.1') {
      return `http://${dockerHost}:${relay.port}/v1`;
    }
    return relay.hostBaseUrl;
  }

  return relay.baseUrl;
}

export async function runYagrProxyCli() {
  const cwd = getYagrN8nWorkspaceDir();
  const relay = await ensureN8nRelayServer();
  const effectiveRelayBaseUrl = await resolveYagrProxyCredentialBaseUrl(relay);

  const listResult = await runN8nacCommand(['credential', 'list', '--json'], cwd);
  const existingList = parseJsonPayload(listResult.stdout);
  const existingCredentials = Array.isArray(existingList)
    ? existingList as Array<{ id?: string; name?: string; type?: string }>
    : [];
  const existing = existingCredentials.find(
    (c) => c.name === N8N_RELAY_CREDENTIAL_NAME && c.type === 'openAiApi',
  );

  if (existing?.id) {
    const confirmedUrl = (new YagrConfigService()).getLocalConfig().llmProxy?.confirmedCredentialBaseUrl;
    const urlIsStale = confirmedUrl !== effectiveRelayBaseUrl;

    if (!urlIsStale) {
      return {
        operation: 'yagrProxy',
        success: true,
        port: relay.port,
        baseUrl: effectiveRelayBaseUrl,
        credentialId: existing.id,
        credentialName: N8N_RELAY_CREDENTIAL_NAME,
        credentialType: 'openAiApi',
        created: false,
        reused: true,
        next: `Relay is running. Reusing existing credential "${N8N_RELAY_CREDENTIAL_NAME}" (id: ${existing.id}). Assign it to the node.`,
      };
    }

    await runN8nacCommand(['credential', 'delete', existing.id], cwd);
  }

  const credData = JSON.stringify({ apiKey: N8N_RELAY_FAKE_API_KEY, url: effectiveRelayBaseUrl });
  const createResult = await runN8nacCommand(
    ['credential', 'create', '--type', 'openAiApi', '--name', N8N_RELAY_CREDENTIAL_NAME, '--data', credData, '--json'],
    cwd,
  );
  const created = parseJsonPayload(createResult.stdout) as Record<string, unknown> | undefined;

  if (createResult.exitCode === 0) {
    (new YagrConfigService()).updateLlmProxyCredentialBaseUrl(effectiveRelayBaseUrl);
  }

  return {
    operation: 'yagrProxy',
    success: createResult.exitCode === 0,
    exitCode: createResult.exitCode,
    port: relay.port,
    baseUrl: effectiveRelayBaseUrl,
    credentialId: (created?.id as string | undefined) ?? null,
    credentialName: N8N_RELAY_CREDENTIAL_NAME,
    credentialType: 'openAiApi',
    created: createResult.exitCode === 0,
    reused: false,
    createExitCode: createResult.exitCode,
    createStderr: createResult.stderr || null,
    next: createResult.exitCode === 0
      ? `Relay is running and credential "${N8N_RELAY_CREDENTIAL_NAME}" created (id: ${created?.id ?? '?'}). Assign it to the node.`
      : `Relay is running but credential creation failed (exit ${createResult.exitCode}). Inspect createStderr and fix before assigning.`,
  };
}

export function createYagrProxyTool(observer?: ToolExecutionObserver) {
  return tool({
    description:
      'Starts the Yagr LLM relay server and creates (or reuses) the openAiApi credential in n8n. '
      + 'Call this when you need to configure an AI Agent / LangChain node with a Yagr-managed LLM credential. '
      + 'Returns the credentialId ready to assign to the node.',
    parameters: z.object({}),
    execute: async () => {
      const relay = await ensureN8nRelayServer();

      await emitToolEvent(observer, {
        type: 'status',
        toolName: 'yagrProxy',
        message: `Relay running at ${relay.baseUrl}`,
      });
      return runYagrProxyCli();
    },
  });
}
