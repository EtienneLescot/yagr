import assert from 'node:assert/strict';
import test from 'node:test';

import { buildYagrSetupStatus } from '../dist/setup.js';

test('buildYagrSetupStatus reports all missing setup phases when nothing is ready', () => {
  const status = buildYagrSetupStatus({
    n8nConfigured: false,
    llmConfigured: false,
    enabledSurfaces: [],
    startableSurfaces: [],
  });

  assert.equal(status.ready, false);
  assert.deepEqual(status.missingSteps, ['n8n', 'llm', 'surfaces']);
});

test('buildYagrSetupStatus is ready only when n8n llm and a startable surface exist', () => {
  const status = buildYagrSetupStatus({
    n8nConfigured: true,
    llmConfigured: true,
    enabledSurfaces: ['telegram', 'webui'],
    startableSurfaces: ['telegram'],
  });

  assert.equal(status.ready, true);
  assert.deepEqual(status.missingSteps, []);
});