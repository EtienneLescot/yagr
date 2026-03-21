import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const VALID_MODES = new Set(['docker', 'no-docker']);
const SPECIAL_COMMANDS = new Set(['help', 'env', 'clean', 'reset']);
const COMMAND_ALIASES = new Map([
  ['doctor', ['n8n', 'doctor']],
  ['install', ['n8n', 'local', 'install']],
  ['status', ['n8n', 'local', 'status']],
  ['logs', ['n8n', 'local', 'logs']],
  ['start', ['n8n', 'local', 'start']],
  ['stop', ['n8n', 'local', 'stop']],
  ['open', ['n8n', 'local', 'open']],
  ['onboard', ['onboard']],
  ['tui', ['tui']],
]);
const COMMON_PORTS = [5678, 5679, 3791];

async function main() {
  const [command = 'help', mode = 'docker', ...forwardedArgs] = process.argv.slice(2);

  if (!VALID_MODES.has(mode)) {
    throw new Error(`Unknown mode "${mode}". Use docker or no-docker.`);
  }

  const env = buildScenarioEnv(mode);

  if (command === 'help') {
    printHelp(env);
    return;
  }

  if (command === 'env') {
    process.stdout.write(`mode=${mode}\n`);
    process.stdout.write(`YAGR_HOME=${env.YAGR_HOME}\n`);
    process.stdout.write(`XDG_CONFIG_HOME=${env.XDG_CONFIG_HOME ?? ''}\n`);
    process.stdout.write(`PATH=${env.PATH}\n`);
    return;
  }

  if (command === 'reset' || command === 'clean') {
    await cleanScenario(mode, env);
    process.stdout.write(`Cleaned scenario home: ${env.YAGR_HOME}\n`);
    return;
  }

  const cliArgs = resolveCliArgs(command, forwardedArgs);
  await runCommand(process.execPath, [path.join(repoRoot, 'dist', 'cli.js'), ...cliArgs], env);
}

function buildScenarioEnv(mode) {
  const scenarioHome = path.join(os.homedir(), mode === 'docker' ? '.yagr-dev-docker' : '.yagr-dev-no-docker');
  const binDir = path.join(scenarioHome, 'bin');
  const xdgConfigHome = path.join(scenarioHome, 'xdg-config');

  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(xdgConfigHome, { recursive: true });
  ensureScenarioShim(binDir, mode);

  const inheritedPath = process.env.PATH ?? '';
  const nextPath = [binDir, inheritedPath].filter(Boolean).join(path.delimiter);
  const env = {
    ...process.env,
    YAGR_HOME: scenarioHome,
    PATH: nextPath,
  };

  if (process.platform !== 'win32') {
    env.XDG_CONFIG_HOME = xdgConfigHome;
  } else {
    env.XDG_CONFIG_HOME = xdgConfigHome;
    env.APPDATA = xdgConfigHome;
  }

  return env;
}

function ensureScenarioShim(binDir, mode) {
  removeScenarioShim(binDir, 'docker');

  if (mode === 'docker') {
    return;
  }

  if (process.platform === 'win32') {
    writeExecutable(path.join(binDir, 'docker.cmd'), '@echo off\r\necho docker: command not found 1>&2\r\nexit /b 127\r\n');
    return;
  }

  writeExecutable(path.join(binDir, 'docker'), '#!/bin/sh\necho "docker: command not found" >&2\nexit 127\n');
}

function removeScenarioShim(binDir, name) {
  for (const candidate of shimCandidates(name)) {
    try {
      fs.rmSync(path.join(binDir, candidate), { force: true });
    } catch {}
  }
}

function shimCandidates(name) {
  if (process.platform === 'win32') {
    return [`${name}.cmd`, `${name}.bat`, `${name}.exe`, name];
  }

  return [name];
}

function writeExecutable(filePath, content) {
  fs.writeFileSync(filePath, content, { mode: 0o755 });
}

function resolveCliArgs(command, forwardedArgs) {
  const alias = COMMAND_ALIASES.get(command);
  if (!alias) {
    return [command, ...forwardedArgs];
  }

  return [...alias, ...forwardedArgs];
}

async function cleanScenario(mode, env) {
  try {
    await runCommand(process.execPath, [path.join(repoRoot, 'dist', 'cli.js'), 'n8n', 'local', 'stop'], env);
  } catch {
    // Ignore if no managed runtime is present.
  }

  if (mode === 'docker') {
    try {
      execFileSync('docker', ['compose', '-f', path.join(env.YAGR_HOME, 'n8n', 'compose.yaml'), 'down'], {
        stdio: 'ignore',
        env,
      });
    } catch {
      // Ignore compose cleanup failures for non-existent stacks.
    }
  }

  await killPorts(COMMON_PORTS);
  resetScenarioHome(env.YAGR_HOME);
}

function resetScenarioHome(scenarioHome) {
  fs.rmSync(scenarioHome, { recursive: true, force: true });
}

async function killPorts(ports) {
  for (const port of ports) {
    const pids = getListeningPids(port);
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {}
    }

    if (pids.length > 0) {
      await delay(400);
    }

    const remainingPids = getListeningPids(port);
    for (const pid of remainingPids) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
  }
}

function getListeningPids(port) {
  if (process.platform === 'win32') {
    return getWindowsListeningPids(port);
  }

  return getPosixListeningPids(port);
}

function getPosixListeningPids(port) {
  try {
    const output = execFileSync('lsof', ['-ti', `tcp:${port}`], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    return parsePidLines(output);
  } catch {
    return [];
  }
}

function getWindowsListeningPids(port) {
  try {
    const output = execFileSync('netstat', ['-ano', '-p', 'tcp'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    const pids = new Set();
    const lines = output.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const match = trimmed.match(/^TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)$/i);
      if (!match) {
        continue;
      }

      if (Number(match[1]) === port) {
        pids.add(Number(match[2]));
      }
    }

    return [...pids];
  } catch {
    return [];
  }
}

function parsePidLines(output) {
  return output
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
}

async function runCommand(file, args, env) {
  await new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: repoRoot,
      env,
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command exited with code ${code ?? 1}`));
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelp(env) {
  process.stdout.write(
    [
      'Usage:',
      '  node scripts/yagr-dev-scenario.mjs <command> <mode> [-- extra args]',
      '',
      'Commands:',
      '  env      Show the derived PATH and scenario homes',
      '  clean    Stop managed runtime, free common local ports, remove the scenario YAGR_HOME',
      '  reset    Alias for clean',
      '',
      'Any other command is passed through directly to `yagr`.',
      'Examples:',
      '  npm run yagr:dev -- onboard no-docker',
      '  npm run yagr:dev -- tui no-docker',
      '  npm run yagr:dev -- webui no-docker',
      '  npm run yagr:dev -- n8n no-docker local status',
      '',
      'Modes:',
      '  docker',
      '  no-docker',
      '',
      `Current docker home: ${path.join(os.homedir(), '.yagr-dev-docker')}`,
      `Current no-docker home: ${path.join(os.homedir(), '.yagr-dev-no-docker')}`,
      `Current resolved PATH example: ${env.PATH}`,
      '',
    ].join('\n'),
  );
}

main().catch((error) => {
  process.stderr.write(`yagr-dev-scenario error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
