import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveStartLaunchAction } from '../dist/setup/start-launcher.js';

test('resolveStartLaunchAction defaults to webui', () => {
  assert.equal(resolveStartLaunchAction(''), 'webui');
  assert.equal(resolveStartLaunchAction('1'), 'webui');
  assert.equal(resolveStartLaunchAction('webui'), 'webui');
});

test('resolveStartLaunchAction supports tui aliases', () => {
  assert.equal(resolveStartLaunchAction('2'), 'tui');
  assert.equal(resolveStartLaunchAction('tui'), 'tui');
  assert.equal(resolveStartLaunchAction('terminal'), 'tui');
});

test('resolveStartLaunchAction supports onboarding and cancel aliases', () => {
  assert.equal(resolveStartLaunchAction('3'), 'onboard');
  assert.equal(resolveStartLaunchAction('setup'), 'onboard');
  assert.equal(resolveStartLaunchAction('4'), 'cancel');
  assert.equal(resolveStartLaunchAction('quit'), 'cancel');
});