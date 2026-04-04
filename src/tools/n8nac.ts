import { spawn } from 'node:child_process';
import { tool } from 'ai';
import { z } from 'zod';
import { YagrN8nConfigService, resolveN8nRuntimeState, resolveWorkflowDir } from '../config/n8n-config-service.js';
import { YagrConfigService } from '../config/yagr-config-service.js';
import { resolvePackageManagerCommand, resolvePackageManagerSpawnOptions } from '../system/package-manager.js';
import { emitToolEvent, quoteShellArg, type ToolExecutionObserver } from './observer.js';
import { ensureN8nRelayServer, N8N_RELAY_CREDENTIAL_NAME, N8N_RELAY_FAKE_API_KEY } from '../llm/llm-relay-server.js';
import { parseJsonPayload, relativeWorkspacePath, resolveWorkspacePath, splitShellArgv, truncateText, workspaceRoot } from './workspace-utils.js';

type RunResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
};

const N8NAC_ACTIONS = [
  'command',
  'yagr_proxy_relay_start',
] as const;

type N8nAcAction = typeof N8NAC_ACTIONS[number];

function runN8nac(
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
  onOutput?: (stream: 'stdout' | 'stderr', chunk: string) => void | Promise<void>,
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(resolvePackageManagerCommand('npx'), ['--yes', 'n8nac', ...args], {
      cwd,
      env: { ...process.env, ...getN8nacProcessEnv(env) },
      stdio: 'pipe',
      ...resolvePackageManagerSpawnOptions(),
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;

    const finish = (result: RunResult) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      if (killTimer) {
        clearTimeout(killTimer);
      }
      resolve(result);
    };

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      void onOutput?.('stdout', text);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      void onOutput?.('stderr', text);
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        child.kill('SIGKILL');
        finish({ stdout, stderr: stderr || 'Process timed out.', exitCode: 1, timedOut: true });
      }, 2_000);
    }, 120_000);

    child.on('error', (error) => {
      finish({ stdout, stderr: error.message || stderr, exitCode: 1, timedOut });
    });

    child.on('close', (exitCode) => {
      finish({ stdout, stderr, exitCode: exitCode ?? 1, timedOut });
    });
  });
}

export function getN8nacProcessEnv(env: NodeJS.ProcessEnv = {}, configService = new YagrN8nConfigService()): NodeJS.ProcessEnv {
  const nextEnv = { ...env };
  const allowEnvironmentFallback = (env.YAGR_ALLOW_N8N_ENV ?? process.env.YAGR_ALLOW_N8N_ENV) === '1';
  const resolved = resolveN8nRuntimeState(configService, { ...process.env, ...env }, { allowEnvironmentFallback });

  if (nextEnv.N8N_HOST && nextEnv.N8N_API_KEY) {
    return nextEnv;
  }

  if (!resolved.host || !resolved.apiKey) {
    return nextEnv;
  }

  if (!nextEnv.N8N_HOST) {
    nextEnv.N8N_HOST = resolved.host;
  }

  if (!nextEnv.N8N_API_KEY) {
    nextEnv.N8N_API_KEY = resolved.apiKey;
  }

  return nextEnv;
}

function sanitizeEnvValue(value: string | undefined): string {
  return String(value || '').trim().replace(/^['"]|['"]$/g, '');
}

function summarizeN8nacRuntime(cwd: string, env: NodeJS.ProcessEnv = {}, configService = new YagrN8nConfigService()): string {
  const localConfig = configService.getLocalConfig();
  const allowEnvironmentFallback = (env.YAGR_ALLOW_N8N_ENV ?? process.env.YAGR_ALLOW_N8N_ENV) === '1';
  const resolved = resolveN8nRuntimeState(configService, { ...process.env, ...env }, { allowEnvironmentFallback });
  const envHost = sanitizeEnvValue(env.N8N_HOST ?? process.env.N8N_HOST);
  const envApiKey = sanitizeEnvValue(env.N8N_API_KEY ?? process.env.N8N_API_KEY);
  const configHost = sanitizeEnvValue(localConfig.host);
  const workflowDir = resolveWorkflowDir(localConfig);

  return [
    `cwd=${relativeWorkspacePath(cwd)}`,
    `envHost=${envHost || '-'}`,
    `envApiKey=${envApiKey ? 'present' : 'missing'}`,
    `configHost=${configHost || '-'}`,
    `configProject=${localConfig.projectName || localConfig.projectId || '-'}`,
    `configInstance=${localConfig.instanceIdentifier || '-'}`,
    `workflowDir=${workflowDir ? relativeWorkspacePath(workflowDir) : '-'}`,
    `resolvedHost=${resolved.host || '-'}`,
    `resolvedApiKey=${resolved.apiKey ? 'present' : 'missing'}`,
    `credentialsAvailable=${resolved.credentialsAvailable ? 'yes' : 'no'}`,
    `projectConfigured=${resolved.projectConfigured ? 'yes' : 'no'}`,
  ].join(' ');
}

async function runObservedN8nac(
  observer: ToolExecutionObserver | undefined,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
): Promise<RunResult> {
  const command = [resolvePackageManagerCommand('npx'), '--yes', 'n8nac', ...args].map(quoteShellArg).join(' ');
  const runtimeSummary = summarizeN8nacRuntime(cwd, env);

  await emitToolEvent(observer, {
    type: 'status',
    toolName: 'n8nac',
    message: `Runtime ${runtimeSummary}`,
  });

  await emitToolEvent(observer, {
    type: 'command-start',
    toolName: 'n8nac',
    command,
    cwd: relativeWorkspacePath(cwd),
  });

  const result = await runN8nac(args, cwd, env, async (stream, chunk) => {
    await emitToolEvent(observer, {
      type: 'command-output',
      toolName: 'n8nac',
      stream,
      chunk,
    });
  });

  await emitToolEvent(observer, {
    type: 'command-end',
    toolName: 'n8nac',
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    message: result.exitCode === 0 ? 'Command completed.' : 'Correcting commands...',
  });

  return result;
}

export function createN8nAcTool(observer?: ToolExecutionObserver) {
  const strictCompatibleParameters = z.preprocess((input) => {
    if (!input || typeof input !== 'object') {
      return input;
    }

    const obj = input as Record<string, unknown>;
    // Some weaker models pass the string "null" instead of JSON null for
    // optional fields. Normalise before Zod validates typed constraints.
    const nullify = (v: unknown) => (v === 'null' || v === undefined ? null : v);
    return {
      ...obj,
      nodeName: nullify(obj.nodeName),
      commandArgs: nullify(obj.commandArgs),
      commandArgv: nullify(obj.commandArgv),
    };
  }, z.object({
    action: z.enum(N8NAC_ACTIONS).describe('Use action="command" for normal n8nac usage. action="yagr_proxy_relay_start" starts the local Yagr relay AND automatically creates the openAiApi credential in n8n (idempotent) — returns credentialId ready to assign.'),
    nodeName: z.string().nullable().describe('Optional workflow node name used for contextual provider-choice prompts.'),
    commandArgs: z.string().nullable().describe('Generic raw n8nac argument string for action="command", for example "workflow credential-required wf_123 --json".'),
    commandArgv: z.array(z.string()).nullable().describe('Generic raw n8nac argv for action="command", preferred over commandArgs when arguments contain spaces.'),
  }));

  return tool({
    description: 'Run n8n-as-code operations from the active workspace. Use action="command" for normal n8nac usage; action="yagr_proxy_relay_start" starts the Yagr relay and creates the openAiApi credential (idempotent).',
    parameters: strictCompatibleParameters,
    execute: async ({
      action: rawAction,
      nodeName,
      commandArgs,
      commandArgv,
    }) => {
        const action = rawAction;
      const cwd = workspaceRoot();

      if (action === 'command') {
        const argv = Array.isArray(commandArgv) && commandArgv.length > 0
          ? commandArgv
          : commandArgs
            ? splitShellArgv(commandArgs)
            : null;

        if (!argv || argv.length === 0) {
          throw new Error('command requires commandArgv or commandArgs');
        }

        const result = await runObservedN8nac(observer, argv, cwd);
        const response: Record<string, unknown> = {
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdout: result.stdout,
          stderr: result.stderr,
          argv,
        };

        // Signal async webhook trigger so the agent knows to poll execution list/get itself.
        if (argv[0] === 'test' && /workflow was started/i.test(result.stdout)) {
          response.asyncTrigger = true;
          response.workflowId = argv[1] ?? null;
          response.note = 'Workflow accepted asynchronously. Use "execution list --workflow-id <id>" then "execution get <id> --include-data --json" to retrieve the result.';
        }

        return response;
      }

      if (action === 'yagr_proxy_relay_start') {
        const relay = await ensureN8nRelayServer();

        // `relay.baseUrl` is the correct URL for the current yagr-config (set at onboard time):
        //   mode=tunnel  → Cloudflare tunnel URL  (for cloud/external n8n)
        //   mode=docker  → http://host.docker.internal:port/v1
        //   mode=local   → http://127.0.0.1:port/v1
        // We trust this value; stale credentials are detected by comparing against the last
        // persisted `credentialBaseUrl` and auto-recreated when they differ.
        const effectiveRelayBaseUrl = relay.baseUrl;

        // Check whether the Yagr relay credential already exists.
        const listResult = await runObservedN8nac(observer, ['credential', 'list', '--json'], cwd);
        const existingList = parseJsonPayload(listResult.stdout);
        const existingCredentials = Array.isArray(existingList)
          ? existingList as Array<{ id?: string; name?: string; type?: string }>
          : [];
        const existing = existingCredentials.find(
          (c) => c.name === N8N_RELAY_CREDENTIAL_NAME && c.type === 'openAiApi',
        );

        if (existing?.id) {
          // Compare the URL we last confirmed in the n8n credential against the current relay URL.
          // `confirmedCredentialBaseUrl` is only written by yagr_proxy_relay_start after a
          // successful credential create — never by onboard — so it reliably tracks what's
          // actually stored in n8n. Any mismatch (mode change, port change, tunnel rotation)
          // means the credential is stale and must be recreated.
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
          await runObservedN8nac(observer, ['credential', 'delete', existing.id], cwd);
        }

        // Create the openAiApi credential with the correct field name ("url", not "baseUrl").
        const credData = JSON.stringify({ apiKey: N8N_RELAY_FAKE_API_KEY, url: effectiveRelayBaseUrl });
        const createResult = await runObservedN8nac(
          observer,
          ['credential', 'create', '--type', 'openAiApi', '--name', N8N_RELAY_CREDENTIAL_NAME, '--data', credData, '--json'],
          cwd,
        );
        const created = parseJsonPayload(createResult.stdout) as Record<string, unknown> | undefined;

        // Persist the effective URL so future calls can detect port/URL rotation.
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
      }

      throw new Error(`Unsupported n8nac action: ${action}`);
    },
  });
}
