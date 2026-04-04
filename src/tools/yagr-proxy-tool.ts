import { spawn } from 'node:child_process';
import { tool } from 'ai';
import { z } from 'zod';
import { YagrConfigService } from '../config/yagr-config-service.js';
import { resolvePackageManagerCommand, resolvePackageManagerSpawnOptions } from '../system/package-manager.js';
import { emitToolEvent, type ToolExecutionObserver } from './observer.js';
import { ensureN8nRelayServer, N8N_RELAY_CREDENTIAL_NAME, N8N_RELAY_FAKE_API_KEY } from '../llm/llm-relay-server.js';
import { parseJsonPayload, workspaceRoot } from './workspace-utils.js';

type RunResult = { stdout: string; stderr: string; exitCode: number };

/**
 * Internal helper: runs n8nac as a subprocess.
 * Used only by yagrProxy for manager-side credential lifecycle operations.
 */
async function runN8nacCommand(args: string[], cwd: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(resolvePackageManagerCommand('npx'), ['--yes', 'n8nac', ...args], {
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

export function createYagrProxyTool(observer?: ToolExecutionObserver) {
  return tool({
    description:
      'Starts the Yagr LLM relay server and creates (or reuses) the openAiApi credential in n8n. '
      + 'Call this when you need to configure an AI Agent / LangChain node with a Yagr-managed LLM credential. '
      + 'Returns the credentialId ready to assign to the node.',
    parameters: z.object({}),
    execute: async () => {
      const cwd = workspaceRoot();
      const relay = await ensureN8nRelayServer();
      const effectiveRelayBaseUrl = relay.baseUrl;

      await emitToolEvent(observer, {
        type: 'status',
        toolName: 'yagrProxy',
        message: `Relay running at ${effectiveRelayBaseUrl}`,
      });

      // Check whether the Yagr relay credential already exists.
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

        // Stale URL — delete old credential so it will be recreated below.
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
    },
  });
}
