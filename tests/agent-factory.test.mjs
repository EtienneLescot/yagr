import assert from 'node:assert/strict';
import test from 'node:test';

import { getYagrAgentMemorySources } from '../dist/agent-factory.js';
import * as publicApi from '../dist/index.js';

test('agent factory memory sources are loaded from active memory sources (array)', () => {
  const sources = getYagrAgentMemorySources();
  assert.ok(Array.isArray(sources), 'memory sources should be an array');
  // In a dev environment, the bundled YAGENTS.md is registered at startup
  // via ensureYagrHomeDir; verify types only (count depends on local state).
  for (const src of sources) {
    assert.equal(typeof src, 'string', 'each source should be a string path');
  }
});

test('public api no longer exports the custom system prompt builder', () => {
  assert.equal('buildSystemPrompt' in publicApi, false);
});