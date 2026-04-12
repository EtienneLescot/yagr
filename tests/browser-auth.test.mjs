import assert from 'node:assert/strict';
import test from 'node:test';

import { buildManagedN8nWorkflowOpenPage } from '../dist/n8n-local/browser-auth.js';

test('buildManagedN8nWorkflowOpenPage uses a top-level helper window instead of a hidden iframe', () => {
  const page = buildManagedN8nWorkflowOpenPage({
    targetUrl: 'https://example.trycloudflare.com/workflow/abc',
    loginUrl: 'https://example.trycloudflare.com/rest/login',
    credentials: {
      url: 'http://127.0.0.1:5678',
      email: 'owner@local.yagr',
      password: 'Password1A',
      firstName: 'Yagr',
      lastName: 'Local',
      createdAt: new Date().toISOString(),
    },
  });

  assert.match(page, /window\.open\('about:blank', 'yagr-login-window'/);
  assert.match(page, /target="yagr-login-window"/);
  assert.doesNotMatch(page, /<iframe name="login-frame"/);
});
