/**
 * LangChain version of the yagrProxy tool.
 *
 * Ensures the Yagr LLM relay server is running and that the corresponding
 * `openAiApi` credential exists in n8n.  Same business logic as the Vercel
 * AI SDK version — only the tool wrapper format changes.
 */
import { spawn } from 'node:child_process';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { YagrConfigService } from '../../config/yagr-config-service.js';
import { resolvePackageManagerCommand, resolvePackageManagerSpawnOptions } from '../../system/package-manager.js';
import { ensureN8nRelayServer, N8N_RELAY_CREDENTIAL_NAME, N8N_RELAY_FAKE_API_KEY } from '../../llm/llm-relay-server.js';
import { parseJsonPayload, workspaceRoot } from '../../tools/workspace-utils.js';

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
  if (version.startsWith('@') || version.includes('.')) {
    return `n8nac@${version}`; // '@next', '@beta', '1.5.2', etc.
  }
  return `n8nac@${version}`;
}

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

export const yagrProxyTool = tool(
  async (): Promise<string> => {
    const cwd = workspaceRoot();
    const relay = await ensureN8nRelayServer();
    const effectiveRelayBaseUrl = relay.baseUrl;

    const listResult = await runN8nacCommand(['credential', 'list', '--json'], cwd);
    const existingList = parseJsonPayload(listResult.stdout);
    const existingCredentials = Array.isArray(existingList)
      ? existingList as Array<{ id?: string; name?: string; type?: string }>
      : [];
    const existing = existingCredentials.find(
      (c) => c.name === N8N_RELAY_CREDENTIAL_NAME && c.type === 'openAiApi',
    );

    if (existing?.id) {
      const confirmedUrl = new YagrConfigService().getLocalConfig().llmProxy?.confirmedCredentialBaseUrl;
      const urlIsStale = confirmedUrl !== effectiveRelayBaseUrl;

      if (!urlIsStale) {
        return JSON.stringify({
          port: relay.port,
          baseUrl: effectiveRelayBaseUrl,
          credentialId: existing.id,
          credentialName: N8N_RELAY_CREDENTIAL_NAME,
          credentialType: 'openAiApi',
          created: false,
          reused: true,
          next: `Relay is running. Reusing existing credential "${N8N_RELAY_CREDENTIAL_NAME}" (id: ${existing.id}). Assign it to the node.`,
        });
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
      new YagrConfigService().updateLlmProxyCredentialBaseUrl(effectiveRelayBaseUrl);
    }

    return JSON.stringify({
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
    });
  },
  {
    name: 'yagrProxy',
    description:
      'Starts the Yagr LLM relay server and creates (or reuses) the openAiApi credential in n8n. ' +
      'Call this when you need to configure an AI Agent / LangChain node with a Yagr-managed LLM credential. ' +
      'Returns the credentialId ready to assign to the node.',
    schema: z.object({}),
  },
);
