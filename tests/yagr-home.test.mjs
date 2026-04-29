import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ensureYagrHomeDir,
  getActiveMemorySourcePaths,
  getYagrHomeDir,
  getYagrLaunchDir,
  getYagrPaths,
  getYagrWorkspaceSkillsDir,
  registerContextMemorySource,
  resolveYagrHomeDir,
} from '../dist/config/yagr-home.js';

test('getYagrLaunchDir returns the preserved launch directory', () => {
  assert.equal(getYagrLaunchDir(), process.env.YAGR_LAUNCH_CWD ?? process.cwd());
});

test('getYagrHomeDir defaults to the platform-standard Yagr home when YAGR_HOME is unset', () => {
  const previousYagrHome = process.env.YAGR_HOME;
  delete process.env.YAGR_HOME;

  try {
    const expected = process.platform === 'win32'
      ? path.join(process.env.APPDATA?.trim() || path.join(os.homedir(), 'AppData', 'Roaming'), 'yagr')
      : path.join(os.homedir(), '.yagr');
    assert.equal(getYagrHomeDir(), expected);
  } finally {
    if (previousYagrHome !== undefined) {
      process.env.YAGR_HOME = previousYagrHome;
    }
  }
});

test('getYagrHomeDir resolves relative YAGR_HOME against the launch directory', () => {
  const previousYagrHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = '.yagr-test-workspace';

  try {
    assert.equal(getYagrHomeDir(), path.resolve(getYagrLaunchDir(), '.yagr-test-workspace'));
  } finally {
    if (previousYagrHome !== undefined) {
      process.env.YAGR_HOME = previousYagrHome;
    } else {
      delete process.env.YAGR_HOME;
    }
  }
});

test('resolveYagrHomeDir uses APPDATA on Windows by default', () => {
  const homeDir = resolveYagrHomeDir(
    { APPDATA: path.join('C:', 'Users', 'etienne', 'AppData', 'Roaming') },
    'win32',
    path.join('C:', 'Users', 'etienne'),
    path.join('C:', 'work'),
  );

  assert.equal(homeDir, path.join('C:', 'Users', 'etienne', 'AppData', 'Roaming', 'yagr'));
});

test('getYagrPaths exposes the internal file layout under YAGR_HOME', () => {
  const previousYagrHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = '.yagr-test-workspace';

  try {
    const paths = getYagrPaths();
    assert.equal(paths.homeDir, path.resolve(getYagrLaunchDir(), '.yagr-test-workspace'));
    assert.equal(paths.memorySources, path.join(paths.homeDir, 'memory-sources.json'));
    assert.equal(paths.skillsDir, path.join(paths.homeDir, 'skills'));
    assert.equal(paths.yagrConfigPath, path.join(paths.homeDir, 'yagr-config.json'));
    assert.equal(paths.yagrCredentialsPath, path.join(paths.homeDir, 'credentials.json'));
  } finally {
    if (previousYagrHome !== undefined) {
      process.env.YAGR_HOME = previousYagrHome;
    } else {
      delete process.env.YAGR_HOME;
    }
  }
});

test('ensureYagrHomeDir creates all required directories', () => {
  const previousYagrHome = process.env.YAGR_HOME;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-home-seed-'));
  process.env.YAGR_HOME = tempHome;

  try {
    ensureYagrHomeDir();
    const paths = getYagrPaths();

    assert.ok(fs.existsSync(paths.homeDir), 'homeDir created');
    assert.ok(fs.existsSync(paths.proxyRuntimeDir), 'proxyRuntimeDir created');
    assert.ok(fs.existsSync(paths.accountAuthDir), 'accountAuthDir created');
    assert.ok(fs.existsSync(paths.skillsDir), 'skillsDir created');

    assert.ok(!fs.existsSync(path.join(tempHome, 'AGENTS.md')), 'no AGENTS.md written by home initialization');
  } finally {
    if (previousYagrHome !== undefined) {
      process.env.YAGR_HOME = previousYagrHome;
    } else {
      delete process.env.YAGR_HOME;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('getYagrWorkspaceSkillsDir resolves under the launch context root', () => {
  const contextRoot = path.join(os.tmpdir(), 'yagr-context-root');
  assert.equal(getYagrWorkspaceSkillsDir(contextRoot), path.join(contextRoot, '.agents', 'skills'));
});

test('registerContextMemorySource persists correctly', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-home-mem-'));
  const memFile = path.join(tempHome, 'memory-sources.json');
  const ctxPath = path.join(tempHome, 'project', 'AGENTS.md');

  try {
    registerContextMemorySource(ctxPath, memFile);
    let raw = JSON.parse(fs.readFileSync(memFile, 'utf8'));
    assert.deepEqual(raw.contexts, [ctxPath]);

    // Idempotent: registering same context twice must not duplicate it.
    registerContextMemorySource(ctxPath, memFile);
    raw = JSON.parse(fs.readFileSync(memFile, 'utf8'));
    assert.deepEqual(raw.contexts, [ctxPath]);
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('getActiveMemorySourcePaths returns only paths that exist on disk', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-home-active-'));
  const memFile = path.join(tempHome, 'memory-sources.json');
  const existingCtx = path.join(tempHome, 'AGENTS.md');
  const missingCtx = path.join(tempHome, 'missing', 'AGENTS.md');

  try {
    fs.writeFileSync(existingCtx, '# Context\n');
    registerContextMemorySource(existingCtx, memFile);
    registerContextMemorySource(missingCtx, memFile);

    const active = getActiveMemorySourcePaths(memFile);
    assert.ok(active.includes(existingCtx), 'existing context path included');
    assert.ok(!active.includes(missingCtx), 'missing context path excluded');
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});
