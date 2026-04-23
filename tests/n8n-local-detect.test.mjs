import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLocalN8nBootstrapAssessment,
  chooseLocalN8nBootstrapStrategy,
  formatLocalN8nBootstrapAssessment,
  parseNodeMajorVersion,
} from '../dist/n8n-local/detect.js';

test('parseNodeMajorVersion handles v-prefixed and raw versions', () => {
  assert.equal(parseNodeMajorVersion('v22.11.0'), 22);
  assert.equal(parseNodeMajorVersion('20.19.3'), 20);
  assert.equal(parseNodeMajorVersion(undefined), undefined);
});

test('chooseLocalN8nBootstrapStrategy suggests docker when Docker is available', () => {
  assert.equal(
    chooseLocalN8nBootstrapStrategy({ dockerAvailable: true }),
    'docker',
  );
  assert.equal(
    chooseLocalN8nBootstrapStrategy({ dockerAvailable: false }),
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
  assert.equal(assessment.blockers.length > 0, true);
});

test('buildLocalN8nBootstrapAssessment reports blockers when Docker is installed but not started', () => {
  const assessment = buildLocalN8nBootstrapAssessment({
    platform: 'linux',
    docker: {
      available: true,
      version: 'Docker',
      reachable: false,
      statusMessage: 'Docker is not started. Please start Docker and try again.',
    },
    node: { available: true, version: 'v22.16.0' },
    preferredPort: 5678,
  });

  assert.equal(assessment.recommendedStrategy, 'manual');
  assert.match(assessment.blockers.join('\n'), /Docker is not started/i);
});

test('formatLocalN8nBootstrapAssessment renders a readable report', () => {
  const report = formatLocalN8nBootstrapAssessment({
    platform: 'darwin',
    docker: { available: true, version: 'Docker' },
    node: {
      available: true,
      version: 'v22.16.0',
      majorVersion: 22,
    },
    preferredPort: 5678,
    preferredUrl: 'http://127.0.0.1:5678',
    recommendedStrategy: 'docker',
    blockers: [],
    notes: ['Docker is available. This is the preferred local n8n strategy.'],
  });

  assert.match(report, /Suggested runtime: docker/);
  assert.match(report, /Available managed runtimes: docker/);
  assert.match(report, /Preferred URL: http:\/\/127\.0\.0\.1:5678/);
  assert.match(report, /Notes:/);
});
