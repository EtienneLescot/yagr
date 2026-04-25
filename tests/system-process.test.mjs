import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveExecutableCommand,
  resolveNativeShell,
} from '../dist/system/process.js';
import { resolvePackageManagerCommand } from '../dist/system/package-manager.js';

test('resolveExecutableCommand maps npm and npx to cmd shims on Windows', () => {
  assert.equal(resolveExecutableCommand('npm', 'win32'), 'npm.cmd');
  assert.equal(resolveExecutableCommand('npx', 'win32'), 'npx.cmd');
  assert.equal(resolveExecutableCommand('node', 'win32'), 'node');
});

test('resolveExecutableCommand leaves command names unchanged on Unix platforms', () => {
  assert.equal(resolveExecutableCommand('npm', 'linux'), 'npm');
  assert.equal(resolveExecutableCommand('npx', 'darwin'), 'npx');
});

test('resolvePackageManagerCommand delegates to the platform resolver', () => {
  assert.equal(resolvePackageManagerCommand('npm', 'win32'), 'npm.cmd');
  assert.equal(resolvePackageManagerCommand('npm', 'linux'), 'npm');
});

test('resolveNativeShell uses PowerShell on Windows and stable sh on Unix', () => {
  assert.equal(resolveNativeShell('win32').file, 'powershell.exe');
  assert.deepEqual(resolveNativeShell('win32').args.at(-1), '-Command');
  assert.equal(resolveNativeShell('linux').file, 'sh');
  assert.equal(resolveNativeShell('linux').args.at(-1), '-c');
});

test('resolveNativeShell ignores configured interactive shells on Unix', () => {
  const previousShell = process.env.SHELL;
  process.env.SHELL = '/bin/zsh';
  try {
    assert.equal(resolveNativeShell('linux').file, 'sh');
    assert.equal(resolveNativeShell('linux').args.at(-1), '-c');
  } finally {
    if (previousShell === undefined) {
      delete process.env.SHELL;
    } else {
      process.env.SHELL = previousShell;
    }
  }
});
