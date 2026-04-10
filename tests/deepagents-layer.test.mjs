import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CODING_ORIENTATION_SYSTEM_PROMPT,
  getCodingOrientedDeepAgentMiddleware,
} from '../dist/deepagents/coding-orientation.js';
import {
  createPristineDeepAgentBackend,
  getPristineDeepAgentMemorySources,
} from '../dist/deepagents/pristine.js';

test('pristine deepagents memory sources stay limited to AGENTS files', () => {
  assert.deepEqual(getPristineDeepAgentMemorySources(), [
    'AGENTS.md',
  ]);
});

test('coding-oriented overlay is a distinct middleware layer', () => {
  const middleware = getCodingOrientedDeepAgentMiddleware();
  assert.equal(Array.isArray(middleware), true);
  assert.equal(middleware.length, 1);
  assert.match(CODING_ORIENTATION_SYSTEM_PROMPT, /coding-focused agent/i);
  assert.match(CODING_ORIENTATION_SYSTEM_PROMPT, /smallest correct edit/i);
  assert.match(CODING_ORIENTATION_SYSTEM_PROMPT, /smallest relevant build, typecheck, or test command/i);
});

test('pristine backend stays host-native and rooted at the provided directory', () => {
  const backend = createPristineDeepAgentBackend('/tmp/yagr-pristine-test');
  assert.equal(typeof backend.execute, 'function');
  assert.equal(typeof backend.read, 'function');
});