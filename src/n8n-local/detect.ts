import { execFile } from 'node:child_process';
import net from 'node:net';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const DEFAULT_N8N_PORT = 5678;
export const MAX_PORT_SCAN_ATTEMPTS = 10;

export type LocalN8nBootstrapStrategy = 'docker' | 'manual';

export interface CommandAvailability {
  available: boolean;
  version?: string;
  reachable?: boolean;
  statusMessage?: string;
}

export interface LocalN8nBootstrapAssessment {
  platform: NodeJS.Platform;
  docker: CommandAvailability;
  node: CommandAvailability & {
    majorVersion?: number;
  };
  preferredPort: number;
  preferredUrl: string;
  recommendedStrategy: LocalN8nBootstrapStrategy;
  blockers: string[];
  notes: string[];
}

interface DetectDependencies {
  platform: NodeJS.Platform;
  detectCommand(command: string, versionArgs: string[]): Promise<CommandAvailability>;
  isPortAvailable(port: number): Promise<boolean>;
}

export function normalizeCommandVersion(output: string | undefined): string | undefined {
  const value = output?.trim();
  return value ? value.split(/\s+/)[0] : undefined;
}

export function parseNodeMajorVersion(version: string | undefined): number | undefined {
  if (!version) {
    return undefined;
  }

  const match = version.match(/^v?(\d+)/);
  return match ? Number(match[1]) : undefined;
}

export function parseNodeVersion(version: string | undefined): { major: number; minor: number; patch: number } | undefined {
  if (!version) {
    return undefined;
  }

  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return undefined;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function chooseLocalN8nBootstrapStrategy(input: {
  dockerAvailable: boolean;
}): LocalN8nBootstrapStrategy {
  if (input.dockerAvailable) {
    return 'docker';
  }

  return 'manual';
}

export function buildLocalN8nBootstrapAssessment(input: {
  platform: NodeJS.Platform;
  docker: CommandAvailability;
  node: CommandAvailability;
  preferredPort: number;
}): LocalN8nBootstrapAssessment {
  const nodeMajorVersion = parseNodeMajorVersion(input.node.version);
  const recommendedStrategy = chooseLocalN8nBootstrapStrategy({
    dockerAvailable: input.docker.available && input.docker.reachable !== false,
  });

  const blockers: string[] = [];
  const notes: string[] = [];

  if (!input.docker.available) {
    notes.push('Docker is not available. Yagr-managed local n8n requires Docker Desktop or a Docker daemon.');
  } else if (input.docker.reachable === false) {
    const message = input.docker.statusMessage ?? 'Docker is installed, but the Docker engine is not running.';
    notes.push(message);
    blockers.push(message);
  }

  if (!input.node.available) {
    notes.push('Node.js is not available.');
  }

  if (recommendedStrategy === 'manual') {
    blockers.push('No supported Yagr-managed local n8n runtime is currently available. Install and start Docker Desktop, or configure a custom n8n instance.');
  } else if (recommendedStrategy === 'docker') {
    notes.push('Docker is available. This is the supported Yagr-managed local n8n strategy.');
  }

  return {
    platform: input.platform,
    docker: input.docker,
    node: {
      ...input.node,
      majorVersion: nodeMajorVersion,
    },
    preferredPort: input.preferredPort,
    preferredUrl: `http://127.0.0.1:${input.preferredPort}`,
    recommendedStrategy,
    blockers,
    notes,
  };
}

export function formatLocalN8nBootstrapAssessment(assessment: LocalN8nBootstrapAssessment): string {
  const availableManagedRuntimes = [
    assessment.docker.available && assessment.docker.reachable !== false ? 'docker' : null,
  ].filter((value): value is 'docker' => Boolean(value));

  const lines = [
    'Local n8n bootstrap assessment',
    `Platform: ${assessment.platform}`,
    `Suggested runtime: ${assessment.recommendedStrategy}`,
    `Available managed runtimes: ${availableManagedRuntimes.length > 0 ? availableManagedRuntimes.join(', ') : 'none'}`,
    `Preferred URL: ${assessment.preferredUrl}`,
    `Docker: ${assessment.docker.available
      ? `yes${assessment.docker.version ? ` (${assessment.docker.version})` : ''}${assessment.docker.reachable === false ? ' · daemon not reachable' : ''}`
      : 'no'}`,
    `Node.js: ${assessment.node.available ? `yes${assessment.node.version ? ` (${assessment.node.version})` : ''}` : 'no'}`,
  ];

  if (assessment.notes.length > 0) {
    lines.push('');
    lines.push('Notes:');
    for (const note of assessment.notes) {
      lines.push(`- ${note}`);
    }
  }

  if (assessment.blockers.length > 0) {
    lines.push('');
    lines.push('Blockers:');
    for (const blocker of assessment.blockers) {
      lines.push(`- ${blocker}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

export async function inspectLocalN8nBootstrap(
  dependencies: Partial<DetectDependencies> = {},
): Promise<LocalN8nBootstrapAssessment> {
  const deps: DetectDependencies = {
    platform: dependencies.platform ?? process.platform,
    detectCommand: dependencies.detectCommand ?? detectCommandAvailability,
    isPortAvailable: dependencies.isPortAvailable ?? checkPortAvailability,
  };

  const [docker, node, preferredPort] = await Promise.all([
    deps.detectCommand('docker', ['--version']),
    deps.detectCommand('node', ['--version']),
    findPreferredPort(DEFAULT_N8N_PORT, deps.isPortAvailable),
  ]);

  return buildLocalN8nBootstrapAssessment({
    platform: deps.platform,
    docker,
    node,
    preferredPort,
  });
}

async function detectCommandAvailability(command: string, versionArgs: string[]): Promise<CommandAvailability> {
  try {
    const { stdout, stderr } = await execFileAsync(command, versionArgs, { timeout: 5000 });
    const availability: CommandAvailability = {
      available: true,
      version: normalizeCommandVersion(stdout || stderr),
    };
    if (command === 'docker') {
      availability.reachable = await isDockerDaemonReachable();
      if (availability.reachable === false) {
        availability.statusMessage = 'Docker is installed, but Docker is not started. Please start Docker and try again.';
      }
    }
    return availability;
  } catch {
    return { available: false };
  }
}

async function isDockerDaemonReachable(): Promise<boolean> {
  try {
    await execFileAsync('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function findPreferredPort(startPort: number, isPortAvailable: (port: number) => Promise<boolean>): Promise<number> {
  for (let offset = 0; offset < MAX_PORT_SCAN_ATTEMPTS; offset += 1) {
    const port = startPort + offset;
    if (await isPortAvailable(port)) {
      return port;
    }
  }

  return startPort;
}

async function checkPortAvailability(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    const finalize = (available: boolean) => {
      server.removeAllListeners();
      resolve(available);
    };

    server.once('error', () => finalize(false));
    server.once('listening', () => {
      server.close(() => finalize(true));
    });

    server.listen(port, '127.0.0.1');
  });
}
