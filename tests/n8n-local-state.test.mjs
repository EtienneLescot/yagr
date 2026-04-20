import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildManagedN8nState,
  markManagedN8nBootstrapStage,
  readManagedN8nState,
  resolveManagedN8nBootstrapStage,
  writeManagedN8nState,
} from '../dist/n8n-local/state.js';
import { YagrN8nConfigService } from '../dist/config/n8n-config-service.js';

test('markManagedN8nBootstrapStage updates the managed instance state for the matching URL', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-state-'));
  const previousHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = tempHome;

  try {
    const state = buildManagedN8nState({
      image: 'docker.n8n.io/n8nio/n8n:stable',
      port: 5678,
      status: 'ready',
      bootstrapStage: 'owner-pending',
    });
    writeManagedN8nState(state);

    const next = markManagedN8nBootstrapStage(state.url, 'connected');
    assert.equal(next?.bootstrapStage, 'connected');
    assert.equal(readManagedN8nState()?.bootstrapStage, 'connected');
  } finally {
    if (previousHome !== undefined) {
      process.env.YAGR_HOME = previousHome;
    } else {
      delete process.env.YAGR_HOME;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('resolveManagedN8nBootstrapStage returns connected for a configured managed-local instance', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-state-'));
  const previousHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = tempHome;

  try {
    const configService = new YagrN8nConfigService();
    configService.saveApiKey('http://127.0.0.1:5678', 'test-api-key');
    configService.saveLocalConfig({
      host: 'http://127.0.0.1:5678',
      syncFolder: 'workflows',
      projectId: 'personal',
      projectName: 'Personal',
      instanceProfile: 'yagr-managed-direct',
    });

    assert.equal(resolveManagedN8nBootstrapStage('http://127.0.0.1:5678'), 'connected');
  } finally {
    if (previousHome !== undefined) {
      process.env.YAGR_HOME = previousHome;
    } else {
      delete process.env.YAGR_HOME;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('resolveManagedN8nBootstrapStage returns connected when the configured host is the public tunnel URL for a managed runtime', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-state-'));
  const previousHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = tempHome;

  try {
    fs.writeFileSync(
      path.join(tempHome, 'yagr-config.json'),
      JSON.stringify({
        n8nTunnel: {
          enabled: true,
          targetUrl: 'http://127.0.0.1:5678',
          publicUrl: 'https://entered-gig-institution-tennessee.trycloudflare.com',
        },
      }, null, 2),
    );
    writeManagedN8nState(buildManagedN8nState({
      strategy: 'docker',
      image: 'docker.n8n.io/n8nio/n8n:stable',
      port: 5678,
      status: 'ready',
      bootstrapStage: 'connected',
    }));

    const configService = new YagrN8nConfigService();
    configService.saveApiKey('https://entered-gig-institution-tennessee.trycloudflare.com', 'test-api-key');
    configService.saveLocalConfig({
      host: 'https://entered-gig-institution-tennessee.trycloudflare.com',
      syncFolder: 'workflows',
      projectId: 'personal',
      projectName: 'Personal',
      instanceProfile: 'yagr-managed-docker',
    });

    assert.equal(resolveManagedN8nBootstrapStage('http://127.0.0.1:5678'), 'connected');
  } finally {
    if (previousHome !== undefined) {
      process.env.YAGR_HOME = previousHome;
    } else {
      delete process.env.YAGR_HOME;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});
