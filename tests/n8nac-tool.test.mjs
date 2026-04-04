import assert from 'node:assert/strict';
import test from 'node:test';

import { createYagrProxyTool } from '../dist/tools/yagr-proxy-tool.js';

test('yagrProxy tool has no required parameters', () => {
  const tool = createYagrProxyTool();

  const parsed = tool.parameters.safeParse({});
  assert.equal(parsed.success, true);
});

test('yagrProxy tool rejects unexpected extra fields gracefully', () => {
  const tool = createYagrProxyTool();

  // Zod strips unknown keys by default; extra fields should not cause hard failure.
  const parsed = tool.parameters.safeParse({ unexpected: 'field' });
  assert.equal(parsed.success, true);
});

