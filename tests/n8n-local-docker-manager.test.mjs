import assert from 'node:assert/strict';
import test from 'node:test';

import { buildComposeFile } from '../dist/n8n-local/docker-manager.js';

test('buildComposeFile binds the managed n8n port to loopback only', () => {
  const compose = buildComposeFile();

  assert.match(compose, /"127\.0\.0\.1:\$\{YAGR_N8N_HOST_PORT\}:5678"/);
  assert.doesNotMatch(compose, /^\s+- "\$\{YAGR_N8N_HOST_PORT\}:5678"$/m);
});
