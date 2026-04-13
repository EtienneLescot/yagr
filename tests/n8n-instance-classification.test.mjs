import assert from 'node:assert/strict';
import test from 'node:test';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { classifyConfiguredN8nInstance, classifyN8nInstanceCandidate } from '../dist/n8n-local/instance-classification.js';

test('classifyN8nInstanceCandidate marks Yagr-managed docker instances with YAGR_MANAGED and DOCKER tags', () => {
  const classification = classifyN8nInstanceCandidate({
    host: 'http://localhost:5678',
    instanceProfile: 'yagr-managed-docker',
    managedState: {
      strategy: 'docker',
      status: 'ready',
      url: 'http://localhost:5678',
      port: 5678,
      pid: 123,
      startedAt: new Date().toISOString(),
      bootstrapStage: 'connected',
    },
  });

  assert.equal(classification.kind, 'yagr-managed-local');
  assert.deepEqual(classification.tags, ['YAGR_MANAGED', 'DOCKER']);
  assert.equal(classification.capabilities.supportsManagedTunnel, true);
  assert.equal(classification.capabilities.requiresLlmProxyTunnel, false);
});

test('classifyN8nInstanceCandidate keeps unmanaged local instances out of managed-only features', () => {
  const classification = classifyN8nInstanceCandidate({
    host: 'http://localhost:5678',
    instanceProfile: 'custom-local-direct',
  });

  assert.equal(classification.kind, 'local');
  assert.deepEqual(classification.tags, []);
  assert.equal(classification.capabilities.supportsManagedTunnel, false);
  assert.equal(classification.capabilities.requiresLlmProxyTunnel, false);
});

test('classifyN8nInstanceCandidate upgrades legacy custom-local profiles when the managed runtime matches the host', () => {
  const classification = classifyN8nInstanceCandidate({
    host: 'http://localhost:5678',
    instanceProfile: 'custom-local-direct',
    managedState: {
      strategy: 'docker',
      status: 'ready',
      url: 'http://localhost:5678',
      port: 5678,
      pid: 123,
      startedAt: new Date().toISOString(),
      bootstrapStage: 'connected',
    },
  });

  assert.equal(classification.instanceProfile, 'yagr-managed-docker');
  assert.equal(classification.kind, 'yagr-managed-local');
  assert.deepEqual(classification.tags, ['YAGR_MANAGED', 'DOCKER']);
  assert.equal(classification.capabilities.supportsManagedTunnel, true);
});

test('classifyN8nInstanceCandidate tags custom local docker instances with DOCKER', () => {
  const classification = classifyN8nInstanceCandidate({
    host: 'http://localhost:5678',
    instanceProfile: 'custom-local-docker',
  });

  assert.equal(classification.kind, 'local');
  assert.deepEqual(classification.tags, ['DOCKER']);
});

test('classifyN8nInstanceCandidate marks cloud instances with CLOUD tag and tunnelled llm proxy capability', () => {
  const classification = classifyN8nInstanceCandidate({
    host: 'https://example.app.n8n.cloud',
    instanceProfile: 'custom-cloud',
  });

  assert.equal(classification.kind, 'cloud');
  assert.deepEqual(classification.tags, ['CLOUD']);
  assert.equal(classification.capabilities.supportsManagedTunnel, false);
  assert.equal(classification.capabilities.requiresLlmProxyTunnel, true);
});

test('classifyN8nInstanceCandidate prefers the persisted setup profile over host heuristics', () => {
  const classification = classifyN8nInstanceCandidate({
    host: 'http://localhost:5678',
    instanceProfile: 'custom-cloud',
  });

  assert.equal(classification.kind, 'cloud');
  assert.deepEqual(classification.tags, ['CLOUD']);
});

test('classifyConfiguredN8nInstance does not infer the instance type from host when instanceProfile is missing', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-classification-'));
  const previousHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = tempHome;

  try {
    const workspaceDir = path.join(tempHome, 'n8n-workspace');
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, 'n8nac-config.json'),
      JSON.stringify({ host: 'https://entered-gig-institution-tennessee.trycloudflare.com' }, null, 2),
    );

    const classification = classifyConfiguredN8nInstance();
    assert.equal(classification.kind, 'unconfigured');
    assert.equal(classification.instanceProfile, undefined);
    assert.deepEqual(classification.tags, []);
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('classifyConfiguredN8nInstance trusts the persisted instanceProfile even when the active host is already tunnelized', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-classification-'));
  const previousHome = process.env.YAGR_HOME;
  process.env.YAGR_HOME = tempHome;

  try {
    const workspaceDir = path.join(tempHome, 'n8n-workspace');
    const managedDir = path.join(tempHome, 'n8n');
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.mkdirSync(managedDir, { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, 'n8nac-config.json'),
      JSON.stringify({
        host: 'https://entered-gig-institution-tennessee.trycloudflare.com',
        instanceProfile: 'yagr-managed-docker',
      }, null, 2),
    );
    fs.writeFileSync(
      path.join(managedDir, 'instance.json'),
      JSON.stringify({
        strategy: 'docker',
        status: 'ready',
        url: 'http://127.0.0.1:5678',
        port: 5678,
        bootstrapStage: 'connected',
        dataDir: path.join(managedDir, 'data'),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, null, 2),
    );

    const classification = classifyConfiguredN8nInstance();
    assert.equal(classification.kind, 'yagr-managed-local');
    assert.equal(classification.instanceProfile, 'yagr-managed-docker');
    assert.deepEqual(classification.tags, ['YAGR_MANAGED', 'DOCKER']);
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});
