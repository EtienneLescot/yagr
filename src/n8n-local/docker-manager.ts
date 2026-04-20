import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { promisify } from 'node:util';
import { DEFAULT_N8N_PORT, inspectLocalN8nBootstrap } from './detect.js';
import { getActiveTunnelState } from './n8n-tunnel.js';
import {
  buildManagedN8nState,
  ensureManagedN8nDirs,
  readManagedN8nState,
  resolveManagedN8nBootstrapStage,
  updateManagedN8nState,
  type ManagedN8nInstanceState,
} from './state.js';

const execFileAsync = promisify(execFile);
const DEFAULT_N8N_IMAGE = 'docker.n8n.io/n8nio/n8n:stable';
const CONTAINER_N8N_PORT = 5678;
const DEFAULT_DOCKER_COMPOSE_TIMEOUT_MS = parseInt(process.env.YAGR_N8N_DOCKER_COMPOSE_TIMEOUT_MS ?? '600000', 10);
const DEFAULT_HEALTH_TIMEOUT_MS = parseInt(process.env.YAGR_N8N_HEALTH_TIMEOUT_MS ?? '300000', 10);
const DEFAULT_EDITOR_TIMEOUT_MS = 90_000;

export interface InstallManagedDockerN8nOptions {
  image?: string;
  port?: number;
}

export interface ManagedDockerN8nStatus {
  installed: boolean;
  running: boolean;
  healthy: boolean;
  url?: string;
  state?: ManagedN8nInstanceState;
}

export async function installManagedDockerN8n(options: InstallManagedDockerN8nOptions = {}): Promise<ManagedN8nInstanceState> {
  const assessment = await inspectLocalN8nBootstrap();
  if (!assessment.docker.available) {
    throw new Error('Docker is not running. Choose the local managed n8n option without Docker, or install/run Docker.');
  }
  if (assessment.docker.reachable === false) {
    throw new Error('Docker is not running. Choose the local managed n8n option without Docker, or install/run Docker.');
  }

  const paths = ensureManagedN8nDirs();
  const existingState = readManagedN8nState();
  const port = options.port ?? existingState?.port ?? assessment.preferredPort ?? DEFAULT_N8N_PORT;
  const image = options.image ?? existingState?.image ?? DEFAULT_N8N_IMAGE;
  const bootstrapStage = resolveManagedN8nBootstrapStage(`http://127.0.0.1:${port}`);

  writeDockerComposeFiles({ image, port });
  updateManagedN8nState(() => buildManagedN8nState({
    image,
    port,
    status: 'starting',
    bootstrapStage,
  }));

  await runDockerCompose(['up', '-d', '--pull', 'missing']);
  await waitForManagedN8nHealth(`http://127.0.0.1:${port}`);
  await waitForManagedN8nEditorReadyBestEffort(`http://127.0.0.1:${port}`);

  return updateManagedN8nState((current) => ({
    ...(current ?? buildManagedN8nState({ image, port })),
    status: 'ready',
    bootstrapStage: current?.bootstrapStage ?? bootstrapStage,
    lastError: undefined,
  }));

  function writeDockerComposeFiles(input: { image: string; port: number }): void {
    const tunnelState = getActiveTunnelState();
    fs.writeFileSync(paths.envFile, buildEnvFile({ ...input, webhookUrl: tunnelState?.publicUrl }));
    fs.writeFileSync(paths.composeFile, buildComposeFile());
  }
}

export async function startManagedDockerN8n(): Promise<ManagedN8nInstanceState> {
  const state = readManagedN8nState();
  if (!state) {
    throw new Error('No Yagr-managed local n8n instance is installed yet. Run `yagr n8n local install` first.');
  }

  // Rewrite .env so N8N_WEBHOOK_URL reflects the currently active tunnel (if any).
  const paths = ensureManagedN8nDirs();
  const tunnelState = getActiveTunnelState();
  fs.writeFileSync(paths.envFile, buildEnvFile({
    image: state.image ?? 'docker.n8n.io/n8nio/n8n:stable',
    port: state.port,
    webhookUrl: tunnelState?.publicUrl,
  }));

  updateManagedN8nState((current) => ({
    ...(current ?? state),
    status: 'starting',
    lastError: undefined,
  }));

  await runDockerCompose(['up', '-d']);
  await waitForManagedN8nHealth(state.url);
  await waitForManagedN8nEditorReadyBestEffort(state.url);

  return updateManagedN8nState((current) => ({
    ...(current ?? state),
    status: 'ready',
    lastError: undefined,
  }));
}

export async function getManagedDockerN8nStatus(): Promise<ManagedDockerN8nStatus> {
  const state = readManagedN8nState();
  if (!state) {
    return { installed: false, running: false, healthy: false };
  }

  const running = await isComposeServiceRunning();
  const healthy = running ? await isManagedN8nHealthy(state.url) : false;

  return {
    installed: true,
    running,
    healthy,
    url: state.url,
    state,
  };
}

export async function stopManagedDockerN8n(): Promise<ManagedN8nInstanceState> {
  const state = readManagedN8nState();
  if (!state) {
    throw new Error('No Yagr-managed local n8n instance is installed yet.');
  }

  await runDockerCompose(['down']);

  return updateManagedN8nState((current) => ({
    ...(current ?? state),
    status: 'stopped',
    lastError: undefined,
  }));
}

export async function getManagedDockerN8nLogs(tail = 100): Promise<string> {
  const state = readManagedN8nState();
  if (!state) {
    throw new Error('No Yagr-managed local n8n instance is installed yet.');
  }

  const { stdout, stderr } = await runDockerCompose(['logs', '--tail', String(tail)]);
  return [stdout, stderr].filter(Boolean).join('\n').trim();
}

function buildEnvFile(input: { image: string; port: number; webhookUrl?: string }): string {
  // When a tunnel is active, set the editor base URL to the tunnel public URL
  // so n8n doesn't require the Editor-Version header for IDE auth.
  const tunnelPublicUrl = getActiveTunnelState()?.publicUrl;
  const editorBaseUrl = tunnelPublicUrl ?? `http://127.0.0.1:${input.port}`;

  const lines = [
    `N8N_IMAGE=${input.image}`,
    `YAGR_N8N_HOST_PORT=${input.port}`,
    'GENERIC_TIMEZONE=UTC',
    'TZ=UTC',
    'N8N_HOST=127.0.0.1',
    'N8N_LISTEN_ADDRESS=0.0.0.0',
    'N8N_PROTOCOL=http',
    `N8N_EDITOR_BASE_URL=${editorBaseUrl}`,
    'N8N_SECURE_COOKIE=false',
    'N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true',
    'QUEUE_HEALTH_CHECK_ACTIVE=true',
  ];
  if (input.webhookUrl) {
    lines.push(`N8N_WEBHOOK_URL=${input.webhookUrl}`);
  }
  lines.push('');
  return lines.join('\n');
}

async function dockerComposeV2Available(): Promise<boolean> {
  try {
    await execFileAsync('docker', ['compose', 'version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function buildComposeFile(): string {
  return [
    'services:',
    '  n8n:',
    '    image: ${N8N_IMAGE}',
    '    restart: unless-stopped',
    '    ports:',
    `      - "127.0.0.1:\${YAGR_N8N_HOST_PORT}:${CONTAINER_N8N_PORT}"`,
    '    env_file:',
    '      - .env',
    '    volumes:',
    '      - ./data:/home/node/.n8n',
    '',
  ].join('\n');
}

async function runDockerCompose(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const { rootDir, composeFile } = ensureManagedN8nDirs();
  const useDockerComposeV1 = !(await dockerComposeV2Available());
  const cmd = useDockerComposeV1 ? 'docker-compose' : 'docker';
  const cmdArgs = useDockerComposeV1
    ? ['-f', composeFile, ...args]
    : ['compose', '-f', composeFile, ...args];
  try {
    return await execFileAsync(cmd, cmdArgs, {
      cwd: rootDir,
      timeout: DEFAULT_DOCKER_COMPOSE_TIMEOUT_MS,
      env: {
        ...process.env,
        COMPOSE_PROJECT_NAME: getComposeProjectName(rootDir),
      },
    });
  } catch (raw) {
    const message = raw instanceof Error ? raw.message : String(raw);
    const isNotFound = /not found|not be found|ENOENT|no such file/i.test(message);
    const isDaemonDown = /cannot connect|error during connect|Is the docker daemon running|permission denied.*docker\.sock/i.test(message);

    if (isNotFound || isDaemonDown) {
      const reason = isNotFound
        ? 'Docker is not installed or not in PATH.'
        : 'Docker is installed but the daemon is not running.';
      throw new Error(
        `${reason}\n`
        + `Your n8n instance is configured to run via Docker Compose.\n`
        + `→ Start Docker (or Docker Desktop) then retry.\n`
        + `→ Or reconfigure n8n: run \`yagr setup\` and choose a different n8n mode.`,
      );
    }

    // Re-throw with the stderr detail stripped of the raw command path.
    throw new Error(`Docker Compose command failed (${args[0]}): ${message}`);
  }
}

function getComposeProjectName(rootDir: string): string {
  const digest = crypto.createHash('sha1').update(rootDir).digest('hex').slice(0, 10);
  return `yagr-n8n-${digest}`;
}

async function isComposeServiceRunning(): Promise<boolean> {
  try {
    const { stdout } = await runDockerCompose(['ps', '--status', 'running', '--services']);
    return stdout.split(/\r?\n/).map((line) => line.trim()).includes('n8n');
  } catch {
    return false;
  }
}

async function isManagedN8nHealthy(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/healthz`);
    return response.ok;
  } catch {
    return false;
  }
}

async function isManagedN8nEditorReady(url: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return false;
    }

    const body = await response.text();
    if (!body.trim()) {
      return false;
    }

    return !body.toLowerCase().includes('n8n is starting up');
  } catch {
    return false;
  }
}

async function waitForManagedN8nHealth(url: string, timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isManagedN8nHealthy(url)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  updateManagedN8nState((current) => ({
    ...(current ?? buildManagedN8nState({ image: DEFAULT_N8N_IMAGE, port: DEFAULT_N8N_PORT })),
    status: 'error',
    lastError: `Timed out waiting for ${url} to become healthy.`,
  }));
  throw new Error(`Timed out waiting for ${url} to become healthy.`);
}

async function waitForManagedN8nEditorReady(url: string, timeoutMs = DEFAULT_EDITOR_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isManagedN8nEditorReady(url)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  updateManagedN8nState((current) => ({
    ...(current ?? buildManagedN8nState({ image: DEFAULT_N8N_IMAGE, port: DEFAULT_N8N_PORT })),
    lastError: `Timed out waiting for the n8n editor at ${url} to become ready.`,
  }));
  throw new Error(`Timed out waiting for the n8n editor at ${url} to become ready.`);
}

async function waitForManagedN8nEditorReadyBestEffort(url: string): Promise<void> {
  try {
    await waitForManagedN8nEditorReady(url);
  } catch {
    // Do not fail installation on editor warmup only.
  }
}
