import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { YagrN8nConfigService } from '../dist/config/n8n-config-service.js';

test('syncN8nacHostUrl updates the active instance host in n8nac-config.json', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-sync-host-'));
  const previousHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = tempHome;

  try {
    const workspaceDir = path.join(tempHome, 'n8n-workspace');
    fs.mkdirSync(workspaceDir, { recursive: true });
    const configPath = path.join(workspaceDir, 'n8nac-config.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        activeInstanceId: 'inst-1',
        host: 'http://127.0.0.1:5678',
        instances: [
          { id: 'inst-1', host: 'http://127.0.0.1:5678', name: 'Local n8n' },
          { id: 'inst-2', host: 'https://cloud.example.com', name: 'Cloud n8n' },
        ],
      }, null, 2),
    );

    const service = new YagrN8nConfigService();
    service.syncN8nacHostUrl('https://random-name.trycloudflare.com');

    const updated = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.equal(updated.host, 'https://random-name.trycloudflare.com');
    assert.equal(updated.instances[0].host, 'https://random-name.trycloudflare.com');
    // Other instances should be unchanged
    assert.equal(updated.instances[1].host, 'https://cloud.example.com');
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('syncN8nacHostUrl skips update when host is already correct', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-sync-host-'));
  const previousHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = tempHome;

  try {
    const workspaceDir = path.join(tempHome, 'n8n-workspace');
    fs.mkdirSync(workspaceDir, { recursive: true });
    const configPath = path.join(workspaceDir, 'n8nac-config.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        activeInstanceId: 'inst-1',
        host: 'https://already-correct.trycloudflare.com',
        instances: [
          { id: 'inst-1', host: 'https://already-correct.trycloudflare.com', name: 'Local n8n' },
        ],
      }, null, 2),
    );

    const service = new YagrN8nConfigService();
    const mtimeBefore = fs.statSync(configPath).mtimeMs;
    service.syncN8nacHostUrl('https://already-correct.trycloudflare.com');
    const mtimeAfter = fs.statSync(configPath).mtimeMs;

    // File should not have been touched
    assert.equal(mtimeAfter, mtimeBefore);
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('syncN8nacHostUrl handles missing n8nac-config.json gracefully', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-sync-host-'));
  const previousHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = tempHome;

  try {
    const workspaceDir = path.join(tempHome, 'n8n-workspace');
    fs.mkdirSync(workspaceDir, { recursive: true });
    // No n8nac-config.json written — should not throw
    const service = new YagrN8nConfigService();
    service.syncN8nacHostUrl('https://some-tunnel.trycloudflare.com');
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('syncN8nacHostUrl handles malformed JSON gracefully', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-sync-host-'));
  const previousHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = tempHome;

  try {
    const workspaceDir = path.join(tempHome, 'n8n-workspace');
    fs.mkdirSync(workspaceDir, { recursive: true });
    const configPath = path.join(workspaceDir, 'n8nac-config.json');
    fs.writeFileSync(configPath, 'not valid json{');

    const service = new YagrN8nConfigService();
    service.syncN8nacHostUrl('https://some-tunnel.trycloudflare.com');
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('syncN8nacHostUrl handles missing active instance gracefully', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-sync-host-'));
  const previousHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = tempHome;

  try {
    const workspaceDir = path.join(tempHome, 'n8n-workspace');
    fs.mkdirSync(workspaceDir, { recursive: true });
    const configPath = path.join(workspaceDir, 'n8nac-config.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        activeInstanceId: 'non-existent',
        instances: [
          { id: 'some-other-id', host: 'http://127.0.0.1:5678', name: 'Local n8n' },
        ],
      }, null, 2),
    );

    const service = new YagrN8nConfigService();
    service.syncN8nacHostUrl('https://some-tunnel.trycloudflare.com');

    // Original should be unchanged
    const updated = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.equal(updated.instances[0].host, 'http://127.0.0.1:5678');
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});
