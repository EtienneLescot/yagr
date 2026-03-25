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

test('mistral uses compatible strategy with generate mode due to simulated streaming', () => {
  const strategy = resolveToolRuntimeStrategy('mistral', 'ministral-8b-latest');

  assert.equal(strategy.capabilityProfile.toolCalling, 'compatible');
  assert.equal(strategy.executionMode, 'generate');
  assert.equal(strategy.tooling.toolCallMode, 'sequential');
  assert.ok(strategy.tooling.availableToolNames.includes('searchWorkspace'));
  assert.ok(strategy.executeDirectives.some((line) => /one tool at a time/i.test(line)));
});

test('none strategy keeps a synthetic runtime tool subset while disabling model tool calls', () => {
  const strategy = resolveToolRuntimeStrategy('openrouter', 'text-embedding-3-small');

  assert.equal(strategy.capabilityProfile.toolCalling, 'none');
  assert.ok(strategy.tooling.availableToolNames.includes('writeWorkspaceFile'));
  assert.ok(strategy.tooling.availableToolNames.includes('n8nac'));
  assert.equal(strategy.tooling.toolCallMode, 'disabled');
  assert.ok(strategy.executeDirectives.some((line) => /json objects only/i.test(line)));
});
