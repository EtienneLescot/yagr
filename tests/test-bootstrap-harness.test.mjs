import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { initializeTestN8nConfig } from '../scripts/test-bootstrap/isolated-fs.mjs';
import { loadProfileFromPath } from '../scripts/test-bootstrap/load-profile.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');

test('initializeTestN8nConfig persists managed instanceProfile and canonical identifier for harness homes', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-harness-'));

  try {
    initializeTestN8nConfig(tempDir, {
      host: 'http://127.0.0.1:5678',
      projectId: 'personal',
      instanceProfile: 'yagr-managed-docker',
    });

    const config = JSON.parse(fs.readFileSync(path.join(tempDir, 'n8nac-config.json'), 'utf8'));
    assert.equal(config.instanceProfile, 'yagr-managed-docker');
    assert.equal(config.instanceIdentifier, 'yagr-managed');
    assert.equal(config.instances[0].instanceProfile, 'yagr-managed-docker');
    assert.equal(config.instances[0].instanceIdentifier, 'yagr-managed');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('provider-matrix bootstrap profile runs LLM proxy onboarding when n8n is required', () => {
  const profilePath = path.join(repoRoot, 'scripts', 'test-bootstrap', 'profiles', 'provider-matrix.yaml');
  const profile = loadProfileFromPath(profilePath);

  assert.deepEqual(profile.agentPrepPhases, [{ id: 'llm_proxy_onboarding', when: 'n8n_required' }]);
});
