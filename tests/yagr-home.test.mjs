import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  getYagrHomeDir,
  getYagrLaunchDir,
  getYagrN8nWorkspaceDir,
  getYagrPaths,
  resolveLegacyConfStorePath,
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
    assert.equal(paths.n8nWorkspaceDir, path.join(paths.homeDir, 'n8n-workspace'));
    assert.equal(paths.managedN8nDir, path.join(paths.homeDir, 'n8n'));
    assert.equal(paths.workspaceInstructionsPath, path.join(paths.n8nWorkspaceDir, 'AGENTS.md'));
    assert.equal(paths.yagrConfigPath, path.join(paths.homeDir, 'yagr-config.json'));
    assert.equal(paths.yagrCredentialsPath, path.join(paths.homeDir, 'credentials.json'));
    assert.equal(paths.n8nConfigPath, path.join(paths.n8nWorkspaceDir, 'n8nac-config.json'));
    assert.equal(paths.n8nCredentialsPath, path.join(paths.homeDir, 'n8n-credentials.json'));
  } finally {
    if (previousYagrHome !== undefined) {
      process.env.YAGR_HOME = previousYagrHome;
    } else {
      delete process.env.YAGR_HOME;
    }
  }
});

test('explicit n8n workspace helper resolves under YAGR_HOME', () => {
  const previousYagrHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = '.yagr-test-workspace';

  try {
    const homeDir = path.resolve(getYagrLaunchDir(), '.yagr-test-workspace');
    assert.equal(getYagrN8nWorkspaceDir(), path.join(homeDir, 'n8n-workspace'));
  } finally {
    if (previousYagrHome !== undefined) {
      process.env.YAGR_HOME = previousYagrHome;
    } else {
      delete process.env.YAGR_HOME;
    }
  }
});

test('resolveLegacyConfStorePath follows the Linux XDG config convention', () => {
  const legacyPath = resolveLegacyConfStorePath(
    'yagr',
    'credentials',
    { XDG_CONFIG_HOME: '/tmp/xdg-config' },
    'linux',
    '/tmp/home',
  );

  assert.equal(legacyPath, path.join('/tmp/xdg-config', 'yagr-nodejs', 'credentials.json'));
});

test('resolveLegacyConfStorePath uses platform separators on Windows', () => {
  const legacyPath = resolveLegacyConfStorePath(
    'yagr',
    'credentials',
    { APPDATA: path.join('C:', 'Users', 'etienne', 'AppData', 'Roaming') },
    'win32',
    path.join('C:', 'Users', 'etienne'),
  );

  assert.equal(legacyPath, path.join('C:', 'Users', 'etienne', 'AppData', 'Roaming', 'yagr-nodejs', 'credentials.json'));
});
