import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildCleanupSummary,
  discoverYagrHomes,
  getComposeProjectName,
  stopManagedDockerRuntime,
} from '../scripts/clean-yagr-local.mjs';

async function withTempRoot(run) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-clean-local-'));
  try {
    await run(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function createCommandStub(overrides = {}) {
  return (command, args, options = {}) => {
    if (typeof overrides[command] === 'function') {
      return overrides[command](args, options);
    }

    return { status: 1, stdout: '', stderr: '' };
  };
}

test('discoverYagrHomes picks dynamic homes and ignores unrelated dot directories', async () => {
  await withTempRoot(async (tempRoot) => {
    const homeDir = path.join(tempRoot, 'home');
    const repoRoot = path.join(tempRoot, 'repo');
    const dynamicHome = path.join(homeDir, '.yagr-nodocker-test');
    const repoWorkspace = path.join(repoRoot, '.yagr-test-workspace');
    const unrelatedDir = path.join(homeDir, '.yagr-no-docker-bin');

    fs.mkdirSync(path.join(dynamicHome, 'n8n'), { recursive: true });
    fs.mkdirSync(repoWorkspace, { recursive: true });
    fs.mkdirSync(unrelatedDir, { recursive: true });
    fs.writeFileSync(path.join(repoWorkspace, 'yagr-config.json'), '{}');
    fs.writeFileSync(path.join(unrelatedDir, 'node'), '');

    const homes = discoverYagrHomes({
      homeDir,
      repoRoot,
      env: {},
      platform: 'linux',
    });

    assert.deepEqual(homes.sort(), [dynamicHome, repoWorkspace].sort());
  });
});

test('buildCleanupSummary includes ports from managed direct runtimes discovered outside the static home list', async () => {
  await withTempRoot(async (tempRoot) => {
    const homeDir = path.join(tempRoot, 'home');
    const repoRoot = path.join(tempRoot, 'repo');
    const dynamicHome = path.join(homeDir, '.yagr-nodocker-test');
    const instanceFile = path.join(dynamicHome, 'n8n', 'instance.json');

    fs.mkdirSync(path.dirname(instanceFile), { recursive: true });
    fs.writeFileSync(instanceFile, JSON.stringify({
      strategy: 'direct',
      port: 5690,
      pid: 4242,
      url: 'http://127.0.0.1:5690',
      status: 'ready',
    }));

    const summary = buildCleanupSummary({
      dryRun: true,
      homeDir,
      repoRoot,
      env: {},
      platform: 'linux',
    }, {
      spawnSync: createCommandStub(),
    });

    assert.equal(summary.managedRuntimes.length, 1);
    assert.equal(summary.managedRuntimes[0].homePath, dynamicHome);
    assert.equal(summary.managedRuntimes[0].strategy, 'direct');
    assert.equal(summary.managedRuntimes[0].port, 5690);
    assert.equal(summary.ports.includes(5690), true);
  });
});

test('stopManagedDockerRuntime uses the same COMPOSE_PROJECT_NAME as the managed docker runtime', async () => {
  await withTempRoot(async (tempRoot) => {
    const runtimeDir = path.join(tempRoot, '.yagr', 'n8n');
    const composeFile = path.join(runtimeDir, 'compose.yaml');
    const execCalls = [];

    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(composeFile, 'services:\n  n8n:\n    image: docker.n8n.io/n8nio/n8n:stable\n');

    stopManagedDockerRuntime({
      runtimeDir,
      composeFile,
      dockerContainerIds: [],
    }, {
      env: { HOME: tempRoot },
      execFileSync: (command, args, options) => {
        execCalls.push({ command, args, options });
      },
      spawnSync: createCommandStub({
        bash: () => ({ status: 0, stdout: '', stderr: '' }),
        docker: (args) => {
          if (args[0] === 'ps') {
            return { status: 0, stdout: '', stderr: '' };
          }
          return { status: 0, stdout: '', stderr: '' };
        },
      }),
    });

    assert.equal(execCalls.length, 1);
    assert.equal(execCalls[0].command, 'docker');
    assert.deepEqual(execCalls[0].args, ['compose', '-f', composeFile, 'down', '--remove-orphans', '-v']);
    assert.equal(execCalls[0].options.env.COMPOSE_PROJECT_NAME, getComposeProjectName(runtimeDir));
  });
});

test('stopManagedDockerRuntime removes labeled docker containers even when the compose file is gone', async () => {
  await withTempRoot(async (tempRoot) => {
    const runtimeDir = path.join(tempRoot, '.yagr', 'n8n');
    const projectName = getComposeProjectName(runtimeDir);
    const execCalls = [];

    fs.mkdirSync(runtimeDir, { recursive: true });

    stopManagedDockerRuntime({
      runtimeDir,
      dockerContainerIds: [],
    }, {
      execFileSync: (command, args, options) => {
        execCalls.push({ command, args, options });
      },
      spawnSync: createCommandStub({
        bash: () => ({ status: 0, stdout: '', stderr: '' }),
        docker: (args) => {
          if (
            args[0] === 'ps'
            && args.includes('--filter')
            && args.includes(`label=com.docker.compose.project=${projectName}`)
          ) {
            return { status: 0, stdout: 'container-123\n', stderr: '' };
          }
          return { status: 0, stdout: '', stderr: '' };
        },
      }),
    });

    assert.equal(execCalls.length, 1);
    assert.equal(execCalls[0].command, 'docker');
    assert.deepEqual(execCalls[0].args, ['rm', '-f', '-v', 'container-123']);
  });
});
