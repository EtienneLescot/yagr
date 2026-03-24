#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DEFAULT_KNOWN_PORTS = [5678, 5679, 5680, 3789, 3790, 3791];
const DEFAULT_PROCESS_PATTERNS = [
  'dist/cli.js',
  'scripts/yagr-dev-scenario.mjs',
  '.yagr/n8n',
  'n8n editor-ui',
  'n8n start',
  'n8n worker',
  'n8n webhook',
];
const YAGR_HOME_MARKERS = [
  'yagr-config.json',
  'credentials.json',
  'n8n',
  'n8n-workspace',
  'n8n-credentials.json',
  'proxy-runtime',
  'oauth',
];
const DOCKER_COMPOSE_WORKING_DIR_LABEL = 'com.docker.compose.project.working_dir';
const DOCKER_COMPOSE_CONFIG_FILES_LABEL = 'com.docker.compose.project.config_files';
const DOCKER_COMPOSE_PROJECT_LABEL = 'com.docker.compose.project';
const N8N_IMAGE_TITLE_LABEL = 'org.opencontainers.image.title';

if (isExecutedDirectly()) {
  const options = parseCliArgs(process.argv.slice(2));
  if (!options.yes && !options.dryRun) {
    process.stderr.write('Refusing destructive cleanup without --yes. Use --dry-run to preview.\n');
    process.exit(1);
  }

  runCleanup({ dryRun: options.dryRun });
}

export function parseCliArgs(argv = process.argv.slice(2)) {
  const args = new Set(argv);
  return {
    dryRun: args.has('--dry-run'),
    yes: args.has('--yes'),
  };
}

export function runCleanup(options = {}, deps = {}) {
  const summary = buildCleanupSummary(options, deps);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  if (summary.dryRun) {
    return summary;
  }

  stopManagedRuntimes(summary.managedRuntimes, deps);
  stopGenericN8nDockerContainers(summary.genericN8nDockerContainers, deps);
  killMatchingProcesses(DEFAULT_PROCESS_PATTERNS, deps);
  killKnownPorts(summary.ports, deps);
  removeKnownHomes(summary.homes, deps);
  uninstallGlobalPackage('@yagr/agent', deps);
  return summary;
}

export function buildCleanupSummary(options = {}, deps = {}) {
  const dryRun = options.dryRun ?? false;
  const repoRoot = options.repoRoot ?? process.cwd();
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? os.homedir();
  const homes = discoverYagrHomes({ repoRoot, env, platform, homeDir }, deps);
  const managedRuntimes = collectManagedRuntimes(homes, deps);
  const managedPorts = managedRuntimes
    .map((runtime) => runtime.port)
    .filter((value) => Number.isInteger(value) && value > 0);
  const genericN8nDockerContainers = listGenericN8nDockerContainerIds(deps)
    .filter((containerId) => !managedRuntimes.some((runtime) => runtime.dockerContainerIds.includes(containerId)));

  return {
    dryRun,
    homes,
    composeFiles: managedRuntimes
      .map((runtime) => runtime.composeFile)
      .filter((value) => typeof value === 'string' && value.length > 0),
    managedRuntimes,
    genericN8nDockerContainers,
    ports: uniqueNumbers(DEFAULT_KNOWN_PORTS.concat(managedPorts)),
    globalPackageInstalled: isGlobalPackageInstalled('@yagr/agent', deps),
  };
}

export function discoverYagrHomes(options = {}, deps = {}) {
  const repoRoot = options.repoRoot ?? process.cwd();
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? os.homedir();
  const explicitCandidates = uniquePaths([
    resolveYagrHomeDir({ repoRoot, env, platform, homeDir }),
    resolveExplicitYagrHomeDir(env.YAGR_HOME, repoRoot),
  ]);
  const discoveredCandidates = uniquePaths([
    ...scanForYagrHomes(homeDir, deps),
    ...scanForYagrHomes(repoRoot, deps),
  ]);

  return uniquePaths(explicitCandidates.concat(discoveredCandidates))
    .filter((candidate) => {
      if (!candidate || !pathExists(candidate, deps)) {
        return false;
      }
      return explicitCandidates.includes(candidate) || looksLikeYagrHome(candidate, deps);
    });
}

export function collectManagedRuntimes(homes, deps = {}) {
  const runtimes = [];
  for (const homePath of homes) {
    const runtimeDir = path.join(homePath, 'n8n');
    const runtimeStateFile = path.join(runtimeDir, 'instance.json');
    const composeFile = path.join(runtimeDir, 'compose.yaml');
    const state = readJsonFile(runtimeStateFile, deps);
    const dockerContainerIds = listDockerContainerIdsForRuntime({
      runtimeDir,
      composeFile,
    }, deps);
    const hasRuntimeDir = pathExists(runtimeDir, deps);
    const hasComposeFile = pathExists(composeFile, deps);

    if (!hasRuntimeDir && !state && dockerContainerIds.length === 0) {
      continue;
    }

    runtimes.push({
      homePath,
      runtimeDir,
      runtimeStateFile,
      composeFile: hasComposeFile ? composeFile : undefined,
      strategy: resolveRuntimeStrategy(state, hasComposeFile, dockerContainerIds),
      port: typeof state?.port === 'number' ? state.port : undefined,
      pid: typeof state?.pid === 'number' ? state.pid : undefined,
      url: typeof state?.url === 'string' ? state.url : undefined,
      status: typeof state?.status === 'string' ? state.status : undefined,
      dockerContainerIds,
    });
  }

  return runtimes;
}

export function stopManagedRuntimes(runtimes, deps = {}) {
  for (const runtime of runtimes) {
    if (runtime.strategy === 'direct') {
      stopManagedDirectRuntime(runtime, deps);
      continue;
    }

    stopManagedDockerRuntime(runtime, deps);
  }
}

export function stopManagedDirectRuntime(runtime, deps = {}) {
  const killed = new Set();
  const runtimePid = Number.isInteger(runtime.pid) && runtime.pid > 0 ? runtime.pid : undefined;
  if (runtimePid) {
    killProcessTree(runtimePid, 'SIGTERM', deps);
    killed.add(runtimePid);
  }

  if (killed.size > 0) {
    sleep(500, deps);
  }

  const remainingPids = new Set();
  if (runtimePid && isPidAlive(runtimePid, deps)) {
    remainingPids.add(runtimePid);
  }
  if (Number.isInteger(runtime.port) && runtime.port > 0) {
    for (const pid of getListeningPids(runtime.port, deps)) {
      remainingPids.add(pid);
    }
  }

  for (const pid of remainingPids) {
    killProcessTree(pid, 'SIGKILL', deps);
    killed.add(pid);
  }

  if (killed.size > 0) {
    process.stdout.write(`stopped managed direct n8n: ${[...killed].join(', ')}\n`);
  }
}

export function stopManagedDockerRuntime(runtime, deps = {}) {
  if (!isCommandAvailable('docker', deps)) {
    return;
  }

  const runtimeDir = runtime.runtimeDir;
  const composeFile = runtime.composeFile ?? path.join(runtimeDir, 'compose.yaml');
  const composeProjectName = getComposeProjectName(runtimeDir);
  const env = {
    ...getProcessEnv(deps),
    COMPOSE_PROJECT_NAME: composeProjectName,
  };

  if (pathExists(composeFile, deps)) {
    try {
      getExecFileSync(deps)('docker', ['compose', '-f', composeFile, 'down', '--remove-orphans', '-v'], {
        cwd: runtimeDir,
        env,
        stdio: 'ignore',
      });
      process.stdout.write(`docker compose down: ${composeFile}\n`);
    } catch {}
  }

  const containerIds = runtime.dockerContainerIds?.length > 0
    ? runtime.dockerContainerIds
    : listDockerContainerIdsForRuntime({ runtimeDir, composeFile }, deps);
  removeDockerContainers(containerIds, deps);
}

export function listDockerContainerIdsForRuntime(runtime, deps = {}) {
  if (!isCommandAvailable('docker', deps)) {
    return [];
  }

  const runtimeDir = runtime.runtimeDir;
  const composeFile = runtime.composeFile ?? path.join(runtimeDir, 'compose.yaml');
  const projectName = getComposeProjectName(runtimeDir);

  return uniqueStrings([
    ...listDockerContainerIdsByFilter(`${DOCKER_COMPOSE_WORKING_DIR_LABEL}=${runtimeDir}`, deps),
    ...listDockerContainerIdsByFilter(`${DOCKER_COMPOSE_CONFIG_FILES_LABEL}=${composeFile}`, deps),
    ...listDockerContainerIdsByFilter(`${DOCKER_COMPOSE_PROJECT_LABEL}=${projectName}`, deps),
  ]);
}

export function listGenericN8nDockerContainerIds(deps = {}) {
  if (!isCommandAvailable('docker', deps)) {
    return [];
  }

  return uniqueStrings([
    ...listDockerContainerIdsByFilter(`${N8N_IMAGE_TITLE_LABEL}=n8n`, deps),
    ...listDockerContainerIdsByAncestor('docker.n8n.io/n8nio/n8n', deps),
    ...listDockerContainerIdsByAncestor('docker.n8n.io/n8nio/n8n:stable', deps),
    ...listDockerContainerIdsByAncestor('n8nio/n8n', deps),
    ...listDockerContainerIdsByAncestor('n8nio/n8n:stable', deps),
  ]);
}

export function getComposeProjectName(rootDir) {
  const digest = crypto.createHash('sha1').update(rootDir).digest('hex').slice(0, 10);
  return `yagr-n8n-${digest}`;
}

function resolveRuntimeStrategy(state, hasComposeFile, dockerContainerIds) {
  if (state?.strategy === 'direct' || state?.strategy === 'docker') {
    return state.strategy;
  }

  if (hasComposeFile || dockerContainerIds.length > 0) {
    return 'docker';
  }

  return 'direct';
}

function resolveYagrHomeDir({ repoRoot, env, platform, homeDir }) {
  const configuredHome = env.YAGR_HOME?.trim();
  if (configuredHome) {
    return resolveExplicitYagrHomeDir(configuredHome, repoRoot);
  }

  if (platform === 'win32') {
    const appDataDir = env.APPDATA?.trim();
    if (appDataDir) {
      return path.join(appDataDir, 'yagr');
    }

    return path.join(homeDir, 'AppData', 'Roaming', 'yagr');
  }

  return path.join(homeDir, '.yagr');
}

function resolveExplicitYagrHomeDir(value, repoRoot) {
  if (!value || !String(value).trim()) {
    return '';
  }

  const trimmed = String(value).trim();
  return path.isAbsolute(trimmed)
    ? trimmed
    : path.resolve(repoRoot, trimmed);
}

function scanForYagrHomes(rootDir, deps = {}) {
  if (!rootDir || !pathExists(rootDir, deps)) {
    return [];
  }

  try {
    return getReaddirSync(deps)(rootDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('.yagr'))
      .map((entry) => path.join(rootDir, entry.name));
  } catch {
    return [];
  }
}

function looksLikeYagrHome(candidate, deps = {}) {
  return YAGR_HOME_MARKERS.some((marker) => pathExists(path.join(candidate, marker), deps));
}

function removeDockerContainers(containerIds, deps = {}) {
  const targets = uniqueStrings(containerIds);
  if (targets.length === 0 || !isCommandAvailable('docker', deps)) {
    return;
  }

  try {
    getExecFileSync(deps)('docker', ['rm', '-f', '-v', ...targets], {
      stdio: 'ignore',
    });
    process.stdout.write(`docker rm: ${targets.join(', ')}\n`);
  } catch {}
}

function stopGenericN8nDockerContainers(containerIds, deps = {}) {
  removeDockerContainers(containerIds, deps);
}

function killKnownPorts(ports, deps = {}) {
  for (const port of ports) {
    const pids = getListeningPids(port, deps);
    for (const pid of pids) {
      try {
        getKill(deps)(pid, 'SIGTERM');
      } catch {}
    }

    if (pids.length > 0) {
      sleep(400, deps);
    }

    const remaining = getListeningPids(port, deps);
    for (const pid of remaining) {
      try {
        getKill(deps)(pid, 'SIGKILL');
      } catch {}
    }

    const killed = Array.from(new Set(pids.concat(remaining)));
    if (killed.length > 0) {
      process.stdout.write(`killed port ${port}: ${killed.join(', ')}\n`);
    }
  }
}

function killMatchingProcesses(patterns, deps = {}) {
  if (!isCommandAvailable('pgrep', deps)) {
    return;
  }

  const killed = new Set();
  for (const pattern of patterns) {
    const pids = getMatchingPids(pattern, deps);
    for (const pid of pids) {
      if (pid === process.pid || killed.has(pid)) {
        continue;
      }
      try {
        getKill(deps)(pid, 'SIGTERM');
        killed.add(pid);
      } catch {}
    }
  }

  if (killed.size > 0) {
    sleep(500, deps);
  }

  for (const pattern of patterns) {
    for (const pid of getMatchingPids(pattern, deps)) {
      if (pid === process.pid) {
        continue;
      }
      try {
        getKill(deps)(pid, 'SIGKILL');
        killed.add(pid);
      } catch {}
    }
  }

  if (killed.size > 0) {
    process.stdout.write(`killed matching processes: ${[...killed].join(', ')}\n`);
  }
}

function killProcessTree(pid, signal, deps = {}) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }

  const kill = getKill(deps);
  if (getPlatform(deps) !== 'win32') {
    try {
      kill(-pid, signal);
    } catch {}
  }

  try {
    kill(pid, signal);
  } catch {}
}

function removeKnownHomes(homes, deps = {}) {
  for (const target of homes) {
    try {
      getRmSync(deps)(target, { recursive: true, force: true });
      process.stdout.write(`removed: ${target}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`failed to remove ${target}: ${message}\n`);
    }
  }
}

function uninstallGlobalPackage(packageName, deps = {}) {
  if (!isGlobalPackageInstalled(packageName, deps) || !isCommandAvailable('npm', deps)) {
    return;
  }

  try {
    getExecFileSync(deps)('npm', ['uninstall', '-g', packageName], { stdio: 'ignore' });
    process.stdout.write(`npm uninstall -g ${packageName}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`failed global uninstall for ${packageName}: ${message}\n`);
  }
}

function isGlobalPackageInstalled(packageName, deps = {}) {
  if (!isCommandAvailable('npm', deps)) {
    return false;
  }

  const result = getSpawnSync(deps)('npm', ['ls', '-g', packageName, '--depth=0', '--json'], {
    encoding: 'utf8',
  });

  if (result.status !== 0 && !result.stdout) {
    return false;
  }

  try {
    const parsed = JSON.parse(result.stdout || '{}');
    return Boolean(parsed.dependencies?.[packageName]);
  } catch {
    return false;
  }
}

function getListeningPids(port, deps = {}) {
  if (!isCommandAvailable('lsof', deps)) {
    return [];
  }

  const result = getSpawnSync(deps)('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf8' });
  if (result.status !== 0 && !result.stdout) {
    return [];
  }

  return toPidList(result.stdout);
}

function getMatchingPids(pattern, deps = {}) {
  const result = getSpawnSync(deps)('pgrep', ['-f', pattern], { encoding: 'utf8' });
  if (result.status !== 0 && !result.stdout) {
    return [];
  }

  return toPidList(result.stdout);
}

function listDockerContainerIdsByFilter(filter, deps = {}) {
  const result = getSpawnSync(deps)('docker', ['ps', '-aq', '--filter', `label=${filter}`], {
    encoding: 'utf8',
  });
  if (result.status !== 0 && !result.stdout) {
    return [];
  }

  return toStringList(result.stdout);
}

function listDockerContainerIdsByAncestor(image, deps = {}) {
  const result = getSpawnSync(deps)('docker', ['ps', '-aq', '--filter', `ancestor=${image}`], {
    encoding: 'utf8',
  });
  if (result.status !== 0 && !result.stdout) {
    return [];
  }

  return toStringList(result.stdout);
}

function isPidAlive(pid, deps = {}) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    getKill(deps)(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readJsonFile(filePath, deps = {}) {
  if (!pathExists(filePath, deps)) {
    return undefined;
  }

  try {
    return JSON.parse(getReadFileSync(deps)(filePath, 'utf8'));
  } catch {
    return undefined;
  }
}

function isCommandAvailable(command, deps = {}) {
  const probe = getSpawnSync(deps)('bash', ['-lc', `command -v ${shellQuote(command)} >/dev/null 2>&1`], {
    stdio: 'ignore',
  });
  return probe.status === 0;
}

function pathExists(target, deps = {}) {
  return getExistsSync(deps)(target);
}

function uniquePaths(values) {
  return uniqueStrings(values.filter(Boolean).map((value) => path.resolve(value)));
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter((value) => typeof value === 'string' && value.length > 0)));
}

function uniqueNumbers(values) {
  return Array.from(new Set(values.filter((value) => Number.isInteger(value) && value > 0)));
}

function toPidList(value) {
  return String(value || '')
    .split(/\s+/)
    .map((entry) => Number.parseInt(entry, 10))
    .filter((entry) => Number.isInteger(entry) && entry > 0);
}

function toStringList(value) {
  return String(value || '')
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function sleep(ms, deps = {}) {
  if (typeof deps.sleep === 'function') {
    deps.sleep(ms);
    return;
  }

  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isExecutedDirectly() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

function getExecFileSync(deps) {
  return deps.execFileSync ?? execFileSync;
}

function getSpawnSync(deps) {
  return deps.spawnSync ?? spawnSync;
}

function getExistsSync(deps) {
  return deps.existsSync ?? fs.existsSync;
}

function getReadFileSync(deps) {
  return deps.readFileSync ?? fs.readFileSync;
}

function getReaddirSync(deps) {
  return deps.readdirSync ?? fs.readdirSync;
}

function getRmSync(deps) {
  return deps.rmSync ?? fs.rmSync;
}

function getKill(deps) {
  return deps.kill ?? process.kill.bind(process);
}

function getProcessEnv(deps) {
  return deps.env ?? process.env;
}

function getPlatform(deps) {
  return deps.platform ?? process.platform;
}
