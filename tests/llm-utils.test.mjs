import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCodexUpstreamTimeoutMs } from '../dist/llm/utils.js';

test('parseCodexUpstreamTimeoutMs falls back for invalid values', () => {
  assert.equal(parseCodexUpstreamTimeoutMs(undefined), 300000);
  assert.equal(parseCodexUpstreamTimeoutMs(''), 300000);
  assert.equal(parseCodexUpstreamTimeoutMs('60s'), 300000);
  assert.equal(parseCodexUpstreamTimeoutMs('NaN'), 300000);
  assert.equal(parseCodexUpstreamTimeoutMs('0'), 300000);
  assert.equal(parseCodexUpstreamTimeoutMs('-1'), 300000);
});

test('parseCodexUpstreamTimeoutMs keeps valid positive numeric values', () => {
  assert.equal(parseCodexUpstreamTimeoutMs('60000'), 60000);
  assert.equal(parseCodexUpstreamTimeoutMs(' 120000 '), 120000);
});
