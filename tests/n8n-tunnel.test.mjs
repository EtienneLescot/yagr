import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  getActiveTunnelState,
  isLocalUrl,
  resolveN8nTunnelTargetUrl,
  startN8nTunnel,
  stopN8nTunnel,
} from '../dist/n8n-local/n8n-tunnel.js';
import { YagrN8nConfigService } from '../dist/config/n8n-config-service.js';
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

test('resolveN8nTunnelTargetUrl uses the configured local host for non-managed instances', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-tunnel-'));
  const previousHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = tempHome;

  try {
    const configService = new YagrN8nConfigService();
    configService.saveLocalConfig({ host: 'http://127.0.0.1:5679', runtimeSource: 'external' });
    const targetUrl = resolveN8nTunnelTargetUrl();
    assert.equal(targetUrl, 'http://127.0.0.1:5679');
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('resolveN8nTunnelTargetUrl throws for a remote/cloud non-managed host', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-tunnel-'));
  const previousHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = tempHome;

  try {
    const configService = new YagrN8nConfigService();
    configService.saveLocalConfig({ host: 'https://my-n8n.example.com', runtimeSource: 'external' });
    assert.throws(
      () => resolveN8nTunnelTargetUrl(),
      /remote or cloud URL/,
    );
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('resolveN8nTunnelTargetUrl throws when nothing is configured', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-tunnel-'));
  const previousHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = tempHome;

  try {
    assert.throws(
      () => resolveN8nTunnelTargetUrl(),
      /No n8n instance is configured/,
    );
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// startN8nTunnel — requires cloudflared, skip gracefully if not installed
// ---------------------------------------------------------------------------

test('startN8nTunnel rejects cleanly when cloudflared is not installed', async () => {
  let cloudflaredAvailable = false;
  try {
    await execFileAsync('cloudflared', ['--version']);
    cloudflaredAvailable = true;
  } catch {
    // Not installed — this is expected in CI.
  }

  if (cloudflaredAvailable) {
    // cloudflared is installed; can't simulate "not found" without path manipulation.
    // Skip the negative test gracefully.
    return;
  }

  await assert.rejects(
    () => startN8nTunnel('http://localhost:5678'),
    /cloudflared not found/,
  );
});
