import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CODING_ORIENTATION_SYSTEM_PROMPT,
  getCodingOrientedDeepAgentMiddleware,
} from '../dist/deepagents/coding-orientation.js';
import { createInjectMemoryMiddleware } from '../dist/deepagents/inject-memory.js';
import {
  createPristineDeepAgentBackend,
  getPristineDeepAgentMemorySources,
} from '../dist/deepagents/pristine.js';

test('pristine deepagents memory sources stay limited to AGENTS files', () => {
  assert.deepEqual(getPristineDeepAgentMemorySources(), [
    'AGENTS.md',
  ]);
});

test('coding-oriented overlay includes both coding orientation and inject-memory middleware', () => {
  const middleware = getCodingOrientedDeepAgentMiddleware();
  assert.equal(Array.isArray(middleware), true);
  assert.equal(middleware.length, 2);
  assert.match(CODING_ORIENTATION_SYSTEM_PROMPT, /coding-focused agent/i);
  assert.match(CODING_ORIENTATION_SYSTEM_PROMPT, /smallest correct edit/i);
  assert.match(CODING_ORIENTATION_SYSTEM_PROMPT, /smallest relevant build, typecheck, or test command/i);
  const names = middleware.map((m) => m.name);
  assert.ok(names.includes('YagrCodingOrientationMiddleware'), 'coding orientation middleware present');
  assert.ok(names.includes('YagrInjectMemoryMiddleware'), 'inject-memory middleware present');
});

test('inject-memory middleware exposes inject_memory tool', () => {
  const middleware = createInjectMemoryMiddleware();
  assert.equal(middleware.name, 'YagrInjectMemoryMiddleware');
  assert.ok(Array.isArray(middleware.tools), 'middleware has tools array');
  assert.equal(middleware.tools.length, 1);
  assert.equal(middleware.tools[0].name, 'inject_memory');
  assert.equal(typeof middleware.wrapModelCall, 'function');
});

test('pristine backend stays host-native and rooted at the provided directory', () => {
  const backend = createPristineDeepAgentBackend('/tmp/yagr-pristine-test');
  assert.equal(typeof backend.execute, 'function');
  assert.equal(typeof backend.read, 'function');
});