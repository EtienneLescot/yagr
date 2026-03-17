import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { getHolonHomeDir, getHolonLaunchDir } from '../dist/config/holon-home.js';

test('getHolonLaunchDir returns the preserved launch directory', () => {
  assert.equal(getHolonLaunchDir(), process.env.HOLON_LAUNCH_CWD ?? process.cwd());
});

test('getHolonHomeDir defaults to ~/.holon when HOLON_HOME is unset', () => {
  const previousHolonHome = process.env.HOLON_HOME;
  delete process.env.HOLON_HOME;

  try {
    assert.equal(getHolonHomeDir(), path.join(os.homedir(), '.holon'));
  } finally {
    if (previousHolonHome !== undefined) {
      process.env.HOLON_HOME = previousHolonHome;
    }
  }
});

test('getHolonHomeDir resolves relative HOLON_HOME against the launch directory', () => {
  const previousHolonHome = process.env.HOLON_HOME;
  process.env.HOLON_HOME = '.holon-test-workspace';

  try {
    assert.equal(getHolonHomeDir(), path.resolve(getHolonLaunchDir(), '.holon-test-workspace'));
  } finally {
    if (previousHolonHome !== undefined) {
      process.env.HOLON_HOME = previousHolonHome;
    } else {
      delete process.env.HOLON_HOME;
    }
  }
});