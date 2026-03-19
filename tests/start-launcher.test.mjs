import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveStartLaunchAction } from '../dist/setup/start-launcher.js';

test('resolveStartLaunchAction defaults to tui', () => {
  assert.equal(resolveStartLaunchAction(''), 'tui');
  assert.equal(resolveStartLaunchAction('1'), 'tui');
  assert.equal(resolveStartLaunchAction('tui'), 'tui');
  assert.equal(resolveStartLaunchAction('terminal'), 'tui');
});

test('resolveStartLaunchAction supports webui aliases', () => {
  assert.equal(resolveStartLaunchAction('2'), 'webui');
  assert.equal(resolveStartLaunchAction('webui'), 'webui');
  assert.equal(resolveStartLaunchAction('web'), 'webui');
});

test('resolveStartLaunchAction supports gateway-only when background gateways present', () => {
  assert.equal(resolveStartLaunchAction('3', true), 'gateway-only');
  assert.equal(resolveStartLaunchAction('gateway-only', true), 'gateway-only');
  assert.equal(resolveStartLaunchAction('gateway', true), 'gateway-only');
  // without background gateways, falls back to tui
  assert.equal(resolveStartLaunchAction('gateway-only', false), 'tui');
});

test('resolveStartLaunchAction supports onboarding and cancel aliases', () => {
  // without background gateways: onboard is at position 3
  assert.equal(resolveStartLaunchAction('3', false), 'onboard');
  assert.equal(resolveStartLaunchAction('setup'), 'onboard');
  assert.equal(resolveStartLaunchAction('onboard'), 'onboard');
  assert.equal(resolveStartLaunchAction('quit'), 'cancel');
  assert.equal(resolveStartLaunchAction('cancel'), 'cancel');
});