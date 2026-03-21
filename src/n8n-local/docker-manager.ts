import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { promisify } from 'node:util';
import { DEFAULT_N8N_PORT, inspectLocalN8nBootstrap } from './detect.js';
import {
  buildManagedN8nState,
  ensureManagedN8nDirs,
  readManagedN8nState,
  updateManagedN8nState,
  type ManagedN8nInstanceState,
} from './state.js';

const execFileAsync = promisify(execFile);
const DEFAULT_N8N_IMAGE = 'docker.n8n.io/n8nio/n8n:stable';
const CONTAINER_N8N_PORT = 5678;
const DEFAULT_HEALTH_TIMEOUT_MS = 180_000;
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
    throw new Error('Docker is not available on this machine. Run `yagr n8n doctor` for details.');
  }

  const paths = ensureManagedN8nDirs();
  const existingState = readManagedN8nState();
  const port = options.port ?? existingState?.port ?? assessment.preferredPort ?? DEFAULT_N8N_PORT;
  const image = options.image ?? existingState?.image ?? DEFAULT_N8N_IMAGE;

  writeDockerComposeFiles({ image, port });
  updateManagedN8nState(() => buildManagedN8nState({
    image,
    port,
    status: 'starting',
    bootstrapStage: 'owner-pending',
  }));

  await runDockerCompose(['up', '-d', '--pull', 'missing']);
  await waitForManagedN8nHealth(`http://127.0.0.1:${port}`);
  await waitForManagedN8nEditorReadyBestEffort(`http://127.0.0.1:${port}`);

  return updateManagedN8nState((current) => ({
    ...(current ?? buildManagedN8nState({ image, port })),
    status: 'ready',
    bootstrapStage: 'owner-pending',
    lastError: undefined,
  }));

  function writeDockerComposeFiles(input: { image: string; port: number }): void {
    fs.writeFileSync(paths.envFile, buildEnvFile(input));
    fs.writeFileSync(paths.composeFile, buildComposeFile());
  }
}

export async function startManagedDockerN8n(): Promise<ManagedN8nInstanceState> {
  const state = readManagedN8nState();
  if (!state) {
    throw new Error('No Yagr-managed local n8n instance is installed yet. Run `yagr n8n local install` first.');
  }

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

function buildEnvFile(input: { image: string; port: number }): string {
  return [
    `N8N_IMAGE=${input.image}`,
    `YAGR_N8N_HOST_PORT=${input.port}`,
    'GENERIC_TIMEZONE=UTC',
    'TZ=UTC',
    'N8N_HOST=127.0.0.1',
    'N8N_LISTEN_ADDRESS=0.0.0.0',
    'N8N_PROTOCOL=http',
    `N8N_EDITOR_BASE_URL=http://127.0.0.1:${input.port}`,
    'N8N_SECURE_COOKIE=false',
    'N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true',
    'QUEUE_HEALTH_CHECK_ACTIVE=true',
    '',
  ].join('\n');
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
  return execFileAsync('docker', ['compose', '-f', composeFile, ...args], {
    cwd: rootDir,
    timeout: 120_000,
    env: {
      ...process.env,
      COMPOSE_PROJECT_NAME: getComposeProjectName(rootDir),
    },
  });
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
