import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLocalN8nBootstrapAssessment,
  chooseLocalN8nBootstrapStrategy,
  formatLocalN8nBootstrapAssessment,
  isSupportedDirectRuntimeNodeVersion,
  parseNodeMajorVersion,
} from '../dist/n8n-local/detect.js';

test('parseNodeMajorVersion handles v-prefixed and raw versions', () => {
  assert.equal(parseNodeMajorVersion('v22.11.0'), 22);
  assert.equal(parseNodeMajorVersion('20.19.3'), 20);
  assert.equal(parseNodeMajorVersion(undefined), undefined);
});

test('isSupportedDirectRuntimeNodeVersion accepts supported majors only', () => {
  assert.equal(isSupportedDirectRuntimeNodeVersion('v20.19.0'), true);
  assert.equal(isSupportedDirectRuntimeNodeVersion('v22.2.0'), true);
  assert.equal(isSupportedDirectRuntimeNodeVersion('v24.0.1'), true);
  assert.equal(isSupportedDirectRuntimeNodeVersion('v18.20.0'), false);
  assert.equal(isSupportedDirectRuntimeNodeVersion(undefined), false);
});

test('chooseLocalN8nBootstrapStrategy prefers docker over direct runtime', () => {
  assert.equal(
    chooseLocalN8nBootstrapStrategy({ dockerAvailable: true, nodeVersion: 'v18.20.0' }),
    'docker',
  );
  assert.equal(
    chooseLocalN8nBootstrapStrategy({ dockerAvailable: false, nodeVersion: 'v22.11.0' }),
    'direct',
  );
  assert.equal(
    chooseLocalN8nBootstrapStrategy({ dockerAvailable: false, nodeVersion: 'v18.20.0' }),
    'manual',
  );
});

test('buildLocalN8nBootstrapAssessment surfaces blockers and preferred URL', () => {
  const assessment = buildLocalN8nBootstrapAssessment({
    platform: 'linux',
    docker: { available: false },
    node: { available: true, version: 'v18.20.0' },
    preferredPort: 5679,
  });

  assert.equal(assessment.recommendedStrategy, 'manual');
  assert.equal(assessment.preferredUrl, 'http://127.0.0.1:5679');
  assert.equal(assessment.node.supportedForDirectRuntime, false);
  assert.equal(assessment.blockers.length > 0, true);
});

test('formatLocalN8nBootstrapAssessment renders a readable report', () => {
  const report = formatLocalN8nBootstrapAssessment({
    platform: 'darwin',
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
    notes: ['Docker is available. This is the preferred local n8n strategy.'],
  });

  assert.match(report, /Preferred strategy: docker/);
  assert.match(report, /Preferred URL: http:\/\/127\.0\.0\.1:5678/);
  assert.match(report, /Notes:/);
});
