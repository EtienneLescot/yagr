import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const VALID_MODES = new Set(['docker', 'no-docker']);
const SPECIAL_COMMANDS = new Set([
  'help',
  'env',
  'clean',
  'reset',
]);
const COMMAND_ALIASES = new Set([
  'doctor',
  'install',
  'status',
  'logs',
  'start',
  'stop',
  'open',
  'onboard',
  'tui',
]);

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

  const requiredBins = ['node', 'npm', 'npx', 'sh', 'xdg-open', 'lsof'];
  for (const bin of requiredBins) {
    const resolved = resolveCommand(bin);
    if (resolved) {
      linkBinary(binDir, bin, resolved);
    }
  }

  const existingYagr = resolveCommand('yagr');
  if (existingYagr) {
    linkBinary(binDir, 'yagr', existingYagr);
  }

  if (mode === 'docker') {
    const docker = resolveCommand('docker');
    if (docker) {
      linkBinary(binDir, 'docker', docker);
    }
  } else {
    writeCommandShim(binDir, 'docker', '#!/bin/sh\necho "docker: command not found" >&2\nexit 127\n');
  }

  return {
    ...process.env,
    YAGR_HOME: scenarioHome,
    XDG_CONFIG_HOME: xdgConfigHome,
    PATH: [binDir, process.env.PATH ?? ''].filter(Boolean).join(path.delimiter),
  };
}

function linkBinary(binDir, name, target) {
  const destination = path.join(binDir, name);
  try {
    fs.rmSync(destination, { force: true });
  } catch {}
  fs.symlinkSync(target, destination);
}

function writeCommandShim(binDir, name, content) {
  const destination = path.join(binDir, name);
  try {
    fs.rmSync(destination, { force: true });
  } catch {}
  fs.writeFileSync(destination, content, { mode: 0o755 });
}

function resolveCommand(name) {
  const pathEntries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    const candidate = path.join(entry, name);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function resolveCliArgs(command, forwardedArgs) {
  if (!COMMAND_ALIASES.has(command)) {
    return [command, ...forwardedArgs];
  }

  switch (command) {
    case 'doctor':
      return ['n8n', 'doctor', ...forwardedArgs];
    case 'install':
      return ['n8n', 'local', 'install', ...forwardedArgs];
    case 'status':
      return ['n8n', 'local', 'status', ...forwardedArgs];
    case 'logs':
      return ['n8n', 'local', 'logs', ...forwardedArgs];
    case 'start':
      return ['n8n', 'local', 'start', ...forwardedArgs];
    case 'stop':
      return ['n8n', 'local', 'stop', ...forwardedArgs];
    case 'open':
      return ['n8n', 'local', 'open', ...forwardedArgs];
    case 'onboard':
      return ['onboard', ...forwardedArgs];
    case 'tui':
      return ['tui', ...forwardedArgs];
    default:
      throw new Error(`Unsupported command mapping for "${command}".`);
  }
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
      });
    } catch {
      // Ignore compose cleanup failures for non-existent stacks.
    }
  }

  killPorts([5678, 5679, 3791]);
  resetScenarioHome(env.YAGR_HOME);
}

function resetScenarioHome(scenarioHome) {
  fs.rmSync(scenarioHome, { recursive: true, force: true });
}

function killPorts(ports) {
  for (const port of ports) {
    try {
      const pids = execFileSync('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean);

      for (const pid of pids) {
        try {
          process.kill(Number(pid), 'SIGTERM');
        } catch {}
      }
    } catch {
      // Nothing listening on this port.
    }
  }
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

function printHelp(env) {
  process.stdout.write(
    [
      'Usage:',
      '  node scripts/yagr-dev-scenario.mjs <command> <mode> [-- extra args]',
      '',
      'Commands:',
      '  env      Show the derived PATH and YAGR_HOME',
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
