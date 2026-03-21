import { execFile } from 'node:child_process';
import net from 'node:net';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const DEFAULT_N8N_PORT = 5678;
export const MAX_PORT_SCAN_ATTEMPTS = 10;
export const SUPPORTED_DIRECT_NODE_MAJORS = [20, 22, 24] as const;

export type LocalN8nBootstrapStrategy = 'docker' | 'direct' | 'manual';

export interface CommandAvailability {
  available: boolean;
  version?: string;
}

export interface LocalN8nBootstrapAssessment {
  platform: NodeJS.Platform;
  docker: CommandAvailability;
  node: CommandAvailability & {
    supportedForDirectRuntime: boolean;
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

export function isSupportedDirectRuntimeNodeVersion(version: string | undefined): boolean {
  const major = parseNodeMajorVersion(version);
  return major !== undefined && SUPPORTED_DIRECT_NODE_MAJORS.includes(major as typeof SUPPORTED_DIRECT_NODE_MAJORS[number]);
}

export function chooseLocalN8nBootstrapStrategy(input: {
  dockerAvailable: boolean;
  nodeVersion?: string;
}): LocalN8nBootstrapStrategy {
  if (input.dockerAvailable) {
    return 'docker';
  }

  if (isSupportedDirectRuntimeNodeVersion(input.nodeVersion)) {
    return 'direct';
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
  const supportedForDirectRuntime = isSupportedDirectRuntimeNodeVersion(input.node.version);
  const recommendedStrategy = chooseLocalN8nBootstrapStrategy({
    dockerAvailable: input.docker.available,
    nodeVersion: input.node.version,
  });

  const blockers: string[] = [];
  const notes: string[] = [];

  if (!input.docker.available) {
    notes.push('Docker is not available. Yagr will need a direct runtime or a manual prerequisite step.');
  }

  if (!input.node.available) {
    notes.push('Node.js is not available.');
  } else if (!supportedForDirectRuntime) {
    blockers.push(
      `Detected Node.js ${input.node.version ?? 'unknown'}, but direct local n8n bootstrap currently targets majors ${SUPPORTED_DIRECT_NODE_MAJORS.join(', ')}.`,
    );
  }

  if (recommendedStrategy === 'manual') {
    blockers.push('No supported automatic local bootstrap strategy is currently available on this machine.');
  } else if (recommendedStrategy === 'docker') {
    notes.push('Docker is available. This is the preferred local n8n strategy.');
  } else if (recommendedStrategy === 'direct') {
    notes.push('A compatible local Node.js runtime is available. Yagr can fall back to a direct local n8n runtime.');
  }

  return {
    platform: input.platform,
    docker: input.docker,
    node: {
      ...input.node,
      supportedForDirectRuntime,
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
  const lines = [
    'Local n8n bootstrap assessment',
    `Platform: ${assessment.platform}`,
    `Preferred strategy: ${assessment.recommendedStrategy}`,
    `Preferred URL: ${assessment.preferredUrl}`,
    `Docker: ${assessment.docker.available ? `yes${assessment.docker.version ? ` (${assessment.docker.version})` : ''}` : 'no'}`,
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
    return {
      available: true,
      version: normalizeCommandVersion(stdout || stderr),
    };
  } catch {
    return { available: false };
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
