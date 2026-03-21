import assert from 'node:assert/strict';
import test from 'node:test';

import { createN8nBootstrapPlan } from '../dist/n8n-local/plan.js';

test('existing instances stay on the guided path', () => {
  const plan = createN8nBootstrapPlan({ target: 'existing-instance' });

  assert.equal(plan.automationLevel, 'guided');
  assert.equal(plan.canProceed, true);
  assert.equal(plan.runtimeStrategy, undefined);
});

test('local managed instances prefer silent bootstrap when docker is available', () => {
  const plan = createN8nBootstrapPlan({
    target: 'local-managed',
    assessment: {
      platform: 'linux',
      docker: { available: true, version: 'Docker' },
      node: {
        available: true,
        version: 'v22.11.0',
        supportedForDirectRuntime: true,
        majorVersion: 22,
      },
      preferredPort: 5678,
      preferredUrl: 'http://127.0.0.1:5678',
      recommendedStrategy: 'docker',
      blockers: [],
      notes: [],
    },
  });

  assert.equal(plan.automationLevel, 'silent');
  assert.equal(plan.canProceed, true);
  assert.equal(plan.runtimeStrategy, 'docker');
});

test('local managed instances fall back to assisted when prerequisites are missing', () => {
  const plan = createN8nBootstrapPlan({
    target: 'local-managed',
    assessment: {
      platform: 'darwin',
      docker: { available: false },
      node: {
        available: true,
        version: 'v18.20.0',
        supportedForDirectRuntime: false,
        majorVersion: 18,
      },
      preferredPort: 5678,
      preferredUrl: 'http://127.0.0.1:5678',
      recommendedStrategy: 'manual',
      blockers: ['No supported automatic local bootstrap strategy is currently available on this machine.'],
      notes: [],
    },
  });

  assert.equal(plan.automationLevel, 'assisted');
  assert.equal(plan.canProceed, false);
  assert.equal(plan.runtimeStrategy, 'manual');
  assert.equal(plan.reasons.length > 0, true);
});
