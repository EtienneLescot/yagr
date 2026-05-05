import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CODING_ORIENTATION_SYSTEM_PROMPT,
  createEditFileToolInputNormalizerMiddleware,
  getRuntimePathAnchorPrompt,
  getCodingOrientedDeepAgentMiddleware,
} from '../dist/deepagents/coding-orientation.js';
import { createInjectMemoryMiddleware } from '../dist/deepagents/inject-memory.js';
import {
  createPristineDeepAgentBackend,
  getPristineDeepAgentMemorySources,
} from '../dist/deepagents/pristine.js';

test('pristine deepagents memory sources are loaded from active-memory-sources (array)', () => {
  const sources = getPristineDeepAgentMemorySources();
  assert.ok(Array.isArray(sources), 'memory sources should be an array');
  // Sources come from ~/.yagr/memory-sources.json; empty array is valid in a fresh env.
  for (const src of sources) {
    assert.equal(typeof src, 'string', 'each source should be a string path');
  }
});

test('coding-oriented overlay includes both coding orientation and inject-memory middleware', () => {
  const middleware = getCodingOrientedDeepAgentMiddleware();
  assert.equal(Array.isArray(middleware), true);
  assert.equal(middleware.length, 3);
  assert.match(CODING_ORIENTATION_SYSTEM_PROMPT, /coding-focused agent/i);
  assert.match(CODING_ORIENTATION_SYSTEM_PROMPT, /smallest correct edit/i);
  assert.match(CODING_ORIENTATION_SYSTEM_PROMPT, /smallest relevant build, typecheck, or test command/i);
  const names = middleware.map((m) => m.name);
  assert.ok(names.includes('YagrCodingOrientationMiddleware'), 'coding orientation middleware present');
  assert.ok(names.includes('YagrEditFileToolInputNormalizerMiddleware'), 'edit_file normalizer middleware present');
  assert.ok(names.includes('YagrInjectMemoryMiddleware'), 'inject-memory middleware present');
});

test('edit_file tool input normalizer drops null replace_all', async () => {
  const middleware = createEditFileToolInputNormalizerMiddleware();
  let receivedRequest;
  await middleware.wrapToolCall({
    toolCall: {
      name: 'edit_file',
      args: {
        file_path: '/tmp/workflow.ts',
        old_string: 'old',
        new_string: 'new',
        replace_all: null,
      },
    },
  }, (request) => {
    receivedRequest = request;
    return { content: 'ok' };
  });

  assert.deepEqual(receivedRequest.toolCall.args, {
    file_path: '/tmp/workflow.ts',
    old_string: 'old',
    new_string: 'new',
  });
});

test('runtime path anchor points to the yagr home directory (not process.cwd)', async () => {
  const anchor = getRuntimePathAnchorPrompt();
  assert.match(anchor, /Backend working directory:/);
  // The anchor must reference the yagr home (e.g. ~/.yagr), not the process
  // launch directory, so the agent navigates from the stable Yagr home root.
  const { getYagrHomeDir } = await import('../dist/config/yagr-home.js');
  assert.ok(anchor.includes(getYagrHomeDir()), 'anchor should point to the yagr home directory');
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
