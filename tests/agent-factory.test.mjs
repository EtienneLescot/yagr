import assert from 'node:assert/strict';
import test from 'node:test';

import { getYagrAgentMemorySources } from '../dist/agent-factory.js';
import * as publicApi from '../dist/index.js';

test('agent factory uses deepagents native AGENTS memory sources', () => {
  assert.deepEqual(getYagrAgentMemorySources(), [
    'AGENTS.md',
  ]);
});

test('public api no longer exports the custom system prompt builder', () => {
  assert.equal('buildSystemPrompt' in publicApi, false);
});