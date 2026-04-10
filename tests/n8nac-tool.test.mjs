import assert from 'node:assert/strict';
import test from 'node:test';

import { createYagrProxyTool } from '../dist/manager-tooling/yagr-proxy.js';

test('yagrProxy tool has no required parameters', () => {
  const tool = createYagrProxyTool();

  const parsed = tool.schema.safeParse({});
  assert.equal(parsed.success, true);
});

test('yagrProxy tool rejects unexpected extra fields gracefully', () => {
  const tool = createYagrProxyTool();

  // Zod strips unknown keys by default; extra fields should not cause hard failure.
  const parsed = tool.schema.safeParse({ unexpected: 'field' });
  assert.equal(parsed.success, true);
});

