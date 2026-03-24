import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveToolRuntimeStrategy } from '../dist/runtime/tool-runtime-strategy.js';

test('native strategy keeps full tool surface and streaming execution', () => {
  const strategy = resolveToolRuntimeStrategy('openai', 'gpt-5');

  assert.equal(strategy.capabilityProfile.toolCalling, 'native');
  assert.equal(strategy.executionMode, 'stream');
  assert.equal(strategy.toolCallStreaming, true);
  assert.equal(strategy.allowedToolNames, undefined);
});

test('compatible strategy keeps tools but pushes conservative directives', () => {
  const strategy = resolveToolRuntimeStrategy('openai-proxy', 'gpt-5.1-codex-mini');

  assert.equal(strategy.capabilityProfile.toolCalling, 'compatible');
  assert.equal(strategy.executionMode, 'generate');
  assert.ok(strategy.executeDirectives.some((line) => /one tool at a time/i.test(line)));
});

test('none strategy exposes only minimal interaction tools', () => {
  const strategy = resolveToolRuntimeStrategy('google-proxy', 'gemini-3-flash-preview');

  assert.equal(strategy.capabilityProfile.toolCalling, 'none');
  assert.equal(strategy.executionMode, 'generate');
  assert.deepEqual(strategy.allowedToolNames, ['reportProgress', 'requestRequiredAction']);
  assert.ok(strategy.executeDirectives.some((line) => /does not expose operational tool calling cleanly/i.test(line)));
});
