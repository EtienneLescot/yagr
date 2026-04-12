import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyN8nInstanceCandidate } from '../dist/n8n-local/instance-classification.js';

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
