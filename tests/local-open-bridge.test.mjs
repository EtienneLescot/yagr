import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolvePreferredWorkflowOpenBridgeUrl } from '../dist/gateway/local-open-bridge.js';

function withTempHome(run) {
  const previousHome = process.env.YAGR_HOME;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-local-open-bridge-'));
  process.env.YAGR_HOME = tempHome;
  try {
    return run(tempHome);
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
}

test('resolvePreferredWorkflowOpenBridgeUrl returns local bridge URL when no tunnel is active', () => {
  withTempHome(() => {
    const result = resolvePreferredWorkflowOpenBridgeUrl('http://127.0.0.1:5678/workflow/abc');
    assert.match(result, /^http:\/\/127\.0\.0\.1:\d+\/open\/n8n-workflow\//);
  });
});

test('resolvePreferredWorkflowOpenBridgeUrl returns tunnel URL when n8n auth tunnel is active', () => {
  withTempHome((tempHome) => {
    const stateFile = path.join(tempHome, 'proxy-runtime', 'n8n-auth-tunnel.json');
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({
      publicUrl: 'https://n8n-auth.trycloudflare.com',
      targetUrl: 'http://127.0.0.1:3791',
      pid: process.pid,
      startedAt: new Date().toISOString(),
    }));
    const result = resolvePreferredWorkflowOpenBridgeUrl('http://127.0.0.1:5678/workflow/abc');
    assert.match(result, /^https:\/\/n8n-auth\.trycloudflare\.com\/open\/n8n-workflow\//);
  });
});

test('resolvePreferredWorkflowOpenBridgeUrl uses fallbackBaseUrl when no tunnel is active and fallback is provided', () => {
  withTempHome(() => {
    const result = resolvePreferredWorkflowOpenBridgeUrl(
      'http://127.0.0.1:5678/workflow/abc',
      'https://my-fallback.example.com',
    );
    assert.match(result, /^https:\/\/my-fallback\.example\.com\/open\/n8n-workflow\//);
  });
});

test('resolvePreferredWorkflowOpenBridgeUrl ignores fallbackBaseUrl when n8n auth tunnel is active', () => {
  withTempHome((tempHome) => {
    const stateFile = path.join(tempHome, 'proxy-runtime', 'n8n-auth-tunnel.json');
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({
      publicUrl: 'https://tunnel.trycloudflare.com',
      targetUrl: 'http://127.0.0.1:3791',
      pid: process.pid,
      startedAt: new Date().toISOString(),
    }));
    const result = resolvePreferredWorkflowOpenBridgeUrl(
      'http://127.0.0.1:5678/workflow/abc',
      'https://fallback.example.com',
    );
    assert.match(result, /^https:\/\/tunnel\.trycloudflare\.com\/open\/n8n-workflow\//);
    assert.ok(!result.includes('fallback.example.com'));
  });
});
