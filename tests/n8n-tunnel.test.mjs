import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  getActiveTunnelState,
  getActiveN8nAuthTunnelState,
  isLocalUrl,
  resolveN8nTunnelTargetUrl,
  startN8nTunnel,
  stopN8nTunnel,
  stopN8nAuthTunnel,
} from '../dist/n8n-local/n8n-tunnel.js';
import { buildManagedN8nState, writeManagedN8nState } from '../dist/n8n-local/state.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// isLocalUrl
// ---------------------------------------------------------------------------

test('isLocalUrl returns true for localhost', () => {
  assert.equal(isLocalUrl('http://localhost:5678'), true);
});

test('isLocalUrl returns true for 127.x addresses', () => {
  assert.equal(isLocalUrl('http://127.0.0.1:5678'), true);
  assert.equal(isLocalUrl('http://127.1.2.3:5678'), true);
});

test('isLocalUrl returns true for RFC-1918 ranges', () => {
  assert.equal(isLocalUrl('http://10.0.0.1:5678'), true);
  assert.equal(isLocalUrl('http://192.168.1.100:5678'), true);
  assert.equal(isLocalUrl('http://172.16.0.1:5678'), true);
  assert.equal(isLocalUrl('http://172.31.255.255:5678'), true);
});

test('isLocalUrl returns true for IPv6 loopback', () => {
  assert.equal(isLocalUrl('http://[::1]:5678'), true);
});

test('isLocalUrl returns false for public domains', () => {
  assert.equal(isLocalUrl('https://my-n8n.example.com'), false);
  assert.equal(isLocalUrl('https://n8n.cloud'), false);
  assert.equal(isLocalUrl('https://xxx.trycloudflare.com'), false);
});

test('isLocalUrl returns false for 172.32+ addresses (not private)', () => {
  assert.equal(isLocalUrl('http://172.32.0.1:5678'), false);
});

test('isLocalUrl returns false for invalid URL', () => {
  assert.equal(isLocalUrl('not-a-url'), false);
});

// ---------------------------------------------------------------------------
// getActiveTunnelState — no cloudflared needed, reads file + checks PID
// ---------------------------------------------------------------------------

test('getActiveTunnelState returns null when no state file exists', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-tunnel-'));
  const previousHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = tempHome;

  try {
    assert.equal(getActiveTunnelState(), null);
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('getActiveTunnelState returns null when stored PID is not alive', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-tunnel-'));
  const previousHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = tempHome;

  try {
    // Write a state file with a PID that cannot be alive (PID 1 is init, but we'll use
    // a very high number that is almost certainly unoccupied on the test machine).
    const stateFile = path.join(tempHome, 'n8n-tunnel-state.json');
    fs.writeFileSync(stateFile, JSON.stringify({
      publicUrl: 'https://test.trycloudflare.com',
      targetUrl: 'http://localhost:5678',
      pid: 9_999_999,
      startedAt: new Date().toISOString(),
    }));
    assert.equal(getActiveTunnelState(), null);
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('getActiveTunnelState returns state when PID is alive', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-tunnel-'));
  const previousHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = tempHome;

  try {
    // Use the current process PID — guaranteed to be alive.
    const stateFile = path.join(tempHome, 'n8n-tunnel-state.json');
    const expected = {
      publicUrl: 'https://alive.trycloudflare.com',
      targetUrl: 'http://localhost:5678',
      pid: process.pid,
      startedAt: new Date().toISOString(),
    };
    fs.writeFileSync(stateFile, JSON.stringify(expected));
    const result = getActiveTunnelState();
    assert.notEqual(result, null);
    assert.equal(result?.publicUrl, expected.publicUrl);
    assert.equal(result?.pid, expected.pid);
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// stopN8nTunnel — no cloudflared needed
// ---------------------------------------------------------------------------

test('stopN8nTunnel removes the state file and is idempotent when nothing is running', async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-tunnel-'));
  const previousHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = tempHome;

  try {
    // Should not throw even with no state file.
    await stopN8nTunnel();
    assert.equal(fs.existsSync(path.join(tempHome, 'n8n-tunnel-state.json')), false);
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('stopN8nTunnel removes the state file when a dead PID is stored', async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-tunnel-'));
  const previousHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = tempHome;

  try {
    const stateFile = path.join(tempHome, 'n8n-tunnel-state.json');
    fs.writeFileSync(stateFile, JSON.stringify({
      publicUrl: 'https://stale.trycloudflare.com',
      targetUrl: 'http://localhost:5678',
      pid: 9_999_999,
      startedAt: new Date().toISOString(),
    }));
    await stopN8nTunnel();
    assert.equal(fs.existsSync(stateFile), false);
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// resolveN8nTunnelTargetUrl
// ---------------------------------------------------------------------------

test('resolveN8nTunnelTargetUrl uses the managed instance port when a managed instance is ready', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-tunnel-'));
  const previousHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = tempHome;

  try {
    // classifyConfiguredN8nInstance requires instanceProfile to identify the instance as managed.
    const workspaceDir = path.join(tempHome, 'n8n-workspace');
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, 'n8nac-config.json'),
      JSON.stringify({ instanceProfile: 'yagr-managed-docker', host: 'http://127.0.0.1:5678' }, null, 2),
    );
    const state = buildManagedN8nState({ image: '', port: 5678, status: 'ready', bootstrapStage: 'connected' });
    writeManagedN8nState(state);
    const targetUrl = resolveN8nTunnelTargetUrl();
    assert.equal(targetUrl, 'http://127.0.0.1:5678');
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('resolveN8nTunnelTargetUrl accepts legacy custom-local profiles when the managed runtime matches the host', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-tunnel-'));
  const previousHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = tempHome;

  try {
    const workspaceDir = path.join(tempHome, 'n8n-workspace');
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, 'n8nac-config.json'),
      JSON.stringify({ instanceProfile: 'custom-local-direct', host: 'http://127.0.0.1:5678' }, null, 2),
    );
    const state = buildManagedN8nState({
      strategy: 'docker',
      image: '',
      port: 5678,
      status: 'ready',
      bootstrapStage: 'connected',
    });
    writeManagedN8nState(state);
    const targetUrl = resolveN8nTunnelTargetUrl();
    assert.equal(targetUrl, 'http://127.0.0.1:5678');
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('resolveN8nTunnelTargetUrl falls back to the managed runtime when the configured host is already tunnelized', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-tunnel-'));
  const previousHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = tempHome;

  try {
    const workspaceDir = path.join(tempHome, 'n8n-workspace');
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, 'n8nac-config.json'),
      JSON.stringify({
        host: 'https://entered-gig-institution-tennessee.trycloudflare.com',
        instanceProfile: 'yagr-managed-docker',
      }, null, 2),
    );
    const state = buildManagedN8nState({
      strategy: 'docker',
      image: '',
      port: 5678,
      status: 'ready',
      bootstrapStage: 'connected',
    });
    writeManagedN8nState(state);
    const targetUrl = resolveN8nTunnelTargetUrl();
    assert.equal(targetUrl, 'http://127.0.0.1:5678');
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('resolveN8nTunnelTargetUrl throws for non-managed instances', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-tunnel-'));
  const previousHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = tempHome;

  try {
    // No managed state written — only an external host configured.
    assert.throws(
      () => resolveN8nTunnelTargetUrl(),
      /Yagr-managed/,
    );
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// startN8nTunnel — skipped in unit tests (requires cloudflared binary)
//
// The "rejects cleanly when cloudflared is not installed" scenario is an
// integration concern and is tested via the integration test bootstrap
// profiles or manually.  In CI/unit contexts, cloudflared availability is
// not guaranteed and the check would depend on runner-specific PATH state.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// n8n-auth tunnel state — llm-tunnel.json and n8n-auth-tunnel.json
// ---------------------------------------------------------------------------

test('stopN8nAuthTunnel removes the n8n-auth state file and is idempotent', async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-n8nauth-tunnel-'));
  const previousHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = tempHome;

  try {
    await stopN8nAuthTunnel();
    const stateFile = path.join(tempHome, 'proxy-runtime', 'n8n-auth-tunnel.json');
    assert.equal(fs.existsSync(stateFile), false);
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('stopN8nAuthTunnel cleans up n8n-auth state file with dead PID', async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-n8nauth-tunnel-'));
  const previousHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = tempHome;

  try {
    const stateFile = path.join(tempHome, 'proxy-runtime', 'n8n-auth-tunnel.json');
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({
      publicUrl: 'https://stale.trycloudflare.com',
      targetUrl: 'http://127.0.0.1:3791',
      pid: 9_999_999,
      startedAt: new Date().toISOString(),
    }));
    await stopN8nAuthTunnel();
    assert.equal(fs.existsSync(stateFile), false);
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('n8n-auth tunnel state is stored under proxy-runtime/n8n-auth-tunnel.json', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-n8nauth-tunnel-'));
  const previousHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = tempHome;

  try {
    const stateFile = path.join(tempHome, 'proxy-runtime', 'n8n-auth-tunnel.json');
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({
      publicUrl: 'https://auth-bridge.trycloudflare.com',
      targetUrl: 'http://127.0.0.1:3791',
      pid: process.pid,
      startedAt: new Date().toISOString(),
    }));
    const result = getActiveN8nAuthTunnelState();
    assert.notEqual(result, null);
    assert.equal(result?.publicUrl, 'https://auth-bridge.trycloudflare.com');
    assert.equal(result?.targetUrl, 'http://127.0.0.1:3791');
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('getActiveN8nAuthTunnelState returns null when state file uses old tunnelUrl field', () => {
  // Ensures backward compat is NOT maintained — old files with tunnelUrl are ignored
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-n8nauth-tunnel-'));
  const previousHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = tempHome;

  try {
    const stateFile = path.join(tempHome, 'proxy-runtime', 'n8n-auth-tunnel.json');
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    // Write stale state with the old field name
    fs.writeFileSync(stateFile, JSON.stringify({
      tunnelUrl: 'https://old-field.trycloudflare.com',
      targetUrl: 'http://127.0.0.1:3791',
      pid: process.pid,
      startedAt: new Date().toISOString(),
    }));
    const result = getActiveN8nAuthTunnelState();
    assert.equal(result, null);
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});
