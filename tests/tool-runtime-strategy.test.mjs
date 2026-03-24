import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveToolRuntimeStrategy } from '../dist/runtime/tool-runtime-strategy.js';

test('native strategy keeps full tool surface and streaming execution', () => {
  const strategy = resolveToolRuntimeStrategy('openai', 'gpt-5');

  assert.equal(strategy.capabilityProfile.toolCalling, 'native');
  assert.equal(strategy.executionMode, 'stream');
  assert.equal(strategy.toolCallStreaming, true);
  assert.equal(strategy.tooling.toolCallMode, 'parallel');
  assert.ok(strategy.tooling.availableToolNames.includes('n8nac'));
  assert.ok(strategy.tooling.allowedToolNamesAfterWorkflowSync.includes('presentWorkflowResult'));
});

test('compatible strategy keeps tools but pushes conservative directives', () => {
  const strategy = resolveToolRuntimeStrategy('openai-proxy', 'gpt-5.1-codex-mini');

  assert.equal(strategy.capabilityProfile.toolCalling, 'compatible');
  assert.equal(strategy.executionMode, 'generate');
  assert.equal(strategy.tooling.toolCallMode, 'sequential');
  assert.ok(strategy.executeDirectives.some((line) => /one tool at a time/i.test(line)));
});

test('weak strategy keeps execution in generate mode for google-proxy', () => {
  const strategy = resolveToolRuntimeStrategy('google-proxy', 'gemini-3-flash-preview');

  assert.equal(strategy.capabilityProfile.toolCalling, 'weak');
  assert.equal(strategy.executionMode, 'generate');
  assert.equal(strategy.tooling.toolCallMode, 'sequential');
  assert.ok(strategy.tooling.availableToolNames.includes('searchWorkspace'));
  assert.ok(strategy.executeDirectives.some((line) => /single decisive tool/i.test(line)));
});

test('none strategy exposes only presentation-safe tools', () => {
  const strategy = resolveToolRuntimeStrategy('openrouter', 'text-embedding-3-small');

  assert.equal(strategy.capabilityProfile.toolCalling, 'none');
  assert.deepEqual(
    strategy.tooling.availableToolNames.sort(),
    ['presentWorkflowResult', 'reportProgress', 'requestRequiredAction'].sort(),
  );
  assert.equal(strategy.tooling.toolCallMode, 'disabled');
});
