import assert from 'node:assert/strict';
import test from 'node:test';

import { buildHolonSetupStatus } from '../dist/setup.js';

test('buildHolonSetupStatus reports all missing setup phases when nothing is ready', () => {
  const status = buildHolonSetupStatus({
    n8nConfigured: false,
    llmConfigured: false,
    enabledSurfaces: [],
    startableSurfaces: [],
  });

  assert.equal(status.ready, false);
  assert.deepEqual(status.missingSteps, ['n8n', 'llm', 'surfaces']);
});

test('buildHolonSetupStatus is ready only when n8n llm and a startable surface exist', () => {
  const status = buildHolonSetupStatus({
    n8nConfigured: true,
    llmConfigured: true,
    enabledSurfaces: ['telegram', 'webui'],
    startableSurfaces: ['telegram'],
  });

  assert.equal(status.ready, true);
  assert.deepEqual(status.missingSteps, []);
});