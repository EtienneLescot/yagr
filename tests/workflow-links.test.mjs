import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ManagedN8nOwnerCredentialService } from '../dist/n8n-local/owner-credentials.js';
import { YagrN8nConfigService } from '../dist/config/n8n-config-service.js';
import { resolveWorkflowOpenLink } from '../dist/gateway/workflow-links.js';

test('resolveWorkflowOpenLink returns direct URL when no managed local credentials are stored', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-workflow-link-'));
  const previousHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = tempHome;

  try {
    const result = resolveWorkflowOpenLink('http://127.0.0.1:5678/workflow/abc');
    assert.deepEqual(result, {
      openUrl: 'http://127.0.0.1:5678/workflow/abc',
      targetUrl: 'http://127.0.0.1:5678/workflow/abc',
      via: 'direct',
    });
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('resolveWorkflowOpenLink uses a self-contained auth bridge for managed local n8n', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-workflow-link-'));
  const previousHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = tempHome;

  try {
    const n8nConfigService = new YagrN8nConfigService();
    n8nConfigService.saveLocalConfig({});

    const ownerCredentialService = new ManagedN8nOwnerCredentialService();
    ownerCredentialService.save({
      url: 'http://127.0.0.1:5678',
      email: 'owner@local.yagr',
      password: 'Password1A',
      firstName: 'Yagr',
      lastName: 'Local',
      createdAt: new Date().toISOString(),
    });

    const result = resolveWorkflowOpenLink('http://127.0.0.1:5678/workflow/abc', {
      n8nConfigService,
      ownerCredentialService,
    });

    assert.equal(result.via, 'self-contained-auth');
    assert.equal(result.targetUrl, 'http://127.0.0.1:5678/workflow/abc');
    assert.match(result.openUrl, /^data:text\/html;charset=utf-8,/);
    assert.match(decodeURIComponent(result.openUrl), /http:\/\/127\.0\.0\.1:5678\/workflow\/abc/);
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('resolveWorkflowOpenLink falls back to direct when the workflow origin does not match the configured n8n host', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-workflow-link-'));
  const previousHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = tempHome;

  try {
    const n8nConfigService = new YagrN8nConfigService();
    n8nConfigService.saveLocalConfig({
      host: 'http://127.0.0.1:5678',
    });

    const ownerCredentialService = new ManagedN8nOwnerCredentialService();
    ownerCredentialService.save({
      url: 'http://127.0.0.1:5678',
      email: 'owner@local.yagr',
      password: 'Password1A',
      firstName: 'Yagr',
      lastName: 'Local',
      createdAt: new Date().toISOString(),
    });

    const result = resolveWorkflowOpenLink('http://127.0.0.1:5679/workflow/abc', {
      n8nConfigService,
      ownerCredentialService,
    });

    assert.deepEqual(result, {
      openUrl: 'http://127.0.0.1:5679/workflow/abc',
      targetUrl: 'http://127.0.0.1:5679/workflow/abc',
      via: 'direct',
    });
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('resolveWorkflowOpenLink uses data: URI self-contained auth when tunnel is active with local credentials', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-workflow-link-'));
  const previousHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = tempHome;

  try {
    const n8nConfigService = new YagrN8nConfigService();
    n8nConfigService.saveLocalConfig({});

    const ownerCredentialService = new ManagedN8nOwnerCredentialService();
    ownerCredentialService.save({
      url: 'http://127.0.0.1:5678',
      email: 'owner@local.yagr',
      password: 'Password1A',
      firstName: 'Yagr',
      lastName: 'Local',
      createdAt: new Date().toISOString(),
    });

    // Simulate a workflow URL from local n8n with an active tunnel
    const result = resolveWorkflowOpenLink('http://127.0.0.1:5678/workflow/abc', {
      n8nConfigService,
      ownerCredentialService,
      n8nTunnelPublicUrl: 'https://example-tunnel.trycloudflare.com',
    });

    assert.equal(result.via, 'self-contained-auth');
    assert.equal(result.targetUrl, 'https://example-tunnel.trycloudflare.com/workflow/abc');
    assert.match(result.openUrl, /^data:text\/html;charset=utf-8,/);
    // The data URI should contain the tunnel URL and login URL
    const decoded = decodeURIComponent(result.openUrl);
    assert.match(decoded, /https:\/\/example-tunnel\.trycloudflare\.com\/workflow\/abc/);
    assert.match(decoded, /https:\/\/example-tunnel\.trycloudflare\.com\/rest\/login/);
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('resolveWorkflowOpenLink preserves via=direct when tunnel URL matches current host', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-workflow-link-'));
  const previousHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = tempHome;

  try {
    const n8nConfigService = new YagrN8nConfigService();
    n8nConfigService.saveLocalConfig({});

    const ownerCredentialService = new ManagedN8nOwnerCredentialService();
    ownerCredentialService.save({
      url: 'http://127.0.0.1:5678',
      email: 'owner@local.yagr',
      password: 'Password1A',
      firstName: 'Yagr',
      lastName: 'Local',
      createdAt: new Date().toISOString(),
    });

    // Same origin as the n8n host — no substitution needed
    const result = resolveWorkflowOpenLink('http://127.0.0.1:5678/workflow/abc', {
      n8nConfigService,
      ownerCredentialService,
      n8nTunnelPublicUrl: 'http://127.0.0.1:5678',
    });

    assert.equal(result.via, 'self-contained-auth');
    assert.equal(result.targetUrl, 'http://127.0.0.1:5678/workflow/abc');
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('resolveWorkflowOpenLink still uses self-contained auth when the workflow URL is already tunnelized', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-workflow-link-'));
  const previousHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = tempHome;

  try {
    const workspaceDir = path.join(tempHome, 'n8n-workspace');
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, 'n8nac-config.json'),
      JSON.stringify({
        version: 2,
        activeInstanceId: 'instance-1',
        instances: [
          {
            id: 'instance-1',
            host: 'https://example-tunnel.trycloudflare.com',
          },
        ],
        host: 'http://127.0.0.1:5678',
      }, null, 2),
    );

    const n8nConfigService = new YagrN8nConfigService();
    const ownerCredentialService = new ManagedN8nOwnerCredentialService();
    ownerCredentialService.save({
      url: 'http://127.0.0.1:5678',
      email: 'owner@local.yagr',
      password: 'Password1A',
      firstName: 'Yagr',
      lastName: 'Local',
      createdAt: new Date().toISOString(),
    });

    const result = resolveWorkflowOpenLink('https://example-tunnel.trycloudflare.com/workflow/abc', {
      n8nConfigService,
      ownerCredentialService,
      n8nTunnelPublicUrl: 'https://example-tunnel.trycloudflare.com',
    });

    assert.equal(result.via, 'self-contained-auth');
    assert.equal(result.targetUrl, 'https://example-tunnel.trycloudflare.com/workflow/abc');
    assert.match(result.openUrl, /^data:text\/html;charset=utf-8,/);
    const decoded = decodeURIComponent(result.openUrl);
    assert.match(decoded, /https:\/\/example-tunnel\.trycloudflare\.com\/workflow\/abc/);
    assert.match(decoded, /https:\/\/example-tunnel\.trycloudflare\.com\/rest\/login/);
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('resolveWorkflowOpenLink can recover local owner credentials from the tunnel target URL when configured host is already tunnelized', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-workflow-link-'));
  const previousHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = tempHome;

  try {
    const workspaceDir = path.join(tempHome, 'n8n-workspace');
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, 'n8nac-config.json'),
      JSON.stringify({
        host: 'https://example-tunnel.trycloudflare.com',
      }, null, 2),
    );

    const n8nConfigService = new YagrN8nConfigService();
    const ownerCredentialService = new ManagedN8nOwnerCredentialService();
    ownerCredentialService.save({
      url: 'http://127.0.0.1:5678',
      email: 'owner@local.yagr',
      password: 'Password1A',
      firstName: 'Yagr',
      lastName: 'Local',
      createdAt: new Date().toISOString(),
    });

    const result = resolveWorkflowOpenLink('https://example-tunnel.trycloudflare.com/workflow/abc', {
      n8nConfigService,
      ownerCredentialService,
      n8nTunnelPublicUrl: 'https://example-tunnel.trycloudflare.com',
      n8nTunnelTargetUrl: 'http://127.0.0.1:5678',
    });

    assert.equal(result.via, 'self-contained-auth');
    assert.equal(result.targetUrl, 'https://example-tunnel.trycloudflare.com/workflow/abc');
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});
