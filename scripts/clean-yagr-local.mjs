#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const yes = args.has('--yes');

const homeDir = os.homedir();
const repoRoot = process.cwd();
const knownHomes = [
  path.join(homeDir, '.yagr'),
  path.join(homeDir, '.yagr-dev-docker'),
  path.join(homeDir, '.yagr-dev-no-docker'),
  path.join(repoRoot, '.yagr-test-workspace'),
];
const knownPorts = [5678, 5679, 5680, 3789, 3790, 3791];
const processPatterns = [
  'dist/cli.js',
  'scripts/yagr-dev-scenario.mjs',
  '.yagr/n8n',
  'n8n editor-ui',
  'n8n start',
  'n8n worker',
  'n8n webhook',
];

if (!yes && !dryRun) {
  process.stderr.write('Refusing destructive cleanup without --yes. Use --dry-run to preview.\n');
  process.exit(1);
}

main();

function main() {
  const summary = {
    dryRun,
    homes: existingPaths(knownHomes),
    composeFiles: collectComposeFiles(knownHomes),
    ports: knownPorts,
    globalPackageInstalled: isGlobalPackageInstalled('@yagr/agent'),
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (dryRun) {
    return;
  }

  stopKnownDockerStacks(summary.composeFiles);
  killMatchingProcesses(processPatterns);
  killKnownPorts(knownPorts);
  removeKnownHomes(knownHomes);
  uninstallGlobalPackage('@yagr/agent');
}

function existingPaths(values) {
  return values.filter((value) => fs.existsSync(value));
}

function collectComposeFiles(homes) {
  return homes
    .map((home) => path.join(home, 'n8n', 'compose.yaml'))
    .filter((filePath) => fs.existsSync(filePath));
}

function stopKnownDockerStacks(composeFiles) {
  if (composeFiles.length === 0 || !isCommandAvailable('docker')) {
    return;
  }

  for (const composeFile of composeFiles) {
    try {
      execFileSync('docker', ['compose', '-f', composeFile, 'down', '--remove-orphans', '-v'], {
        stdio: 'ignore',
      });
      process.stdout.write(`docker compose down: ${composeFile}\n`);
    } catch {}
  }
}

function killKnownPorts(ports) {
  for (const port of ports) {
    const pids = getListeningPids(port);
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {}
    }

    if (pids.length > 0) {
      sleep(400);
    }

    for (const pid of getListeningPids(port)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }

    const killed = Array.from(new Set(pids.concat(getListeningPids(port))));
    if (killed.length > 0) {
      process.stdout.write(`killed port ${port}: ${killed.join(', ')}\n`);
    }
  }
}

function killMatchingProcesses(patterns) {
  if (!isCommandAvailable('pgrep')) {
    return;
  }

  const killed = new Set();
  for (const pattern of patterns) {
    const pids = getMatchingPids(pattern);
    for (const pid of pids) {
      if (pid === process.pid || killed.has(pid)) {
        continue;
      }
      try {
        process.kill(pid, 'SIGTERM');
        killed.add(pid);
      } catch {}
    }
  }

  if (killed.size > 0) {
    sleep(500);
  }

  for (const pattern of patterns) {
    for (const pid of getMatchingPids(pattern)) {
      if (pid === process.pid) {
        continue;
      }
      try {
        process.kill(pid, 'SIGKILL');
        killed.add(pid);
      } catch {}
    }
  }

  if (killed.size > 0) {
    process.stdout.write(`killed matching processes: ${[...killed].join(', ')}\n`);
  }
}

function removeKnownHomes(homes) {
  for (const target of homes) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      process.stdout.write(`removed: ${target}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`failed to remove ${target}: ${message}\n`);
    }
  }
}

function uninstallGlobalPackage(packageName) {
  if (!isGlobalPackageInstalled(packageName) || !isCommandAvailable('npm')) {
    return;
  }

  try {
    execFileSync('npm', ['uninstall', '-g', packageName], { stdio: 'ignore' });
    process.stdout.write(`npm uninstall -g ${packageName}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`failed global uninstall for ${packageName}: ${message}\n`);
  }
}

function isGlobalPackageInstalled(packageName) {
  if (!isCommandAvailable('npm')) {
    return false;
  }

  const result = spawnSync('npm', ['ls', '-g', packageName, '--depth=0', '--json'], {
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

function getListeningPids(port) {
  if (!isCommandAvailable('lsof')) {
    return [];
  }

  const result = spawnSync('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf8' });
  if (result.status !== 0 && !result.stdout) {
    return [];
  }

  return String(result.stdout || '')
    .split(/\s+/)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function getMatchingPids(pattern) {
  const result = spawnSync('pgrep', ['-f', pattern], { encoding: 'utf8' });
  if (result.status !== 0 && !result.stdout) {
    return [];
  }

  return String(result.stdout || '')
    .split(/\s+/)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function isCommandAvailable(command) {
  const probe = spawnSync('bash', ['-lc', `command -v ${shellQuote(command)} >/dev/null 2>&1`], {
    stdio: 'ignore',
  });
  return probe.status === 0;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
