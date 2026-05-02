import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FileImpactLedger, buildImpactSummary, createFileImpactLedger, defaultImpactLedgerPath } from './index.js';

test('FileImpactLedger appends and queries events', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-impact-ledger-'));
  const ledger = new FileImpactLedger(path.join(dir, 'impact.jsonl'));

  const first = ledger.append({
    id: 'impact_1',
    sessionId: 'sess_1',
    operationId: 'operation_1',
    timestamp: '2026-05-01T10:00:00.000Z',
    actor: 'tool',
    category: 'file_change',
    impact: 'medium',
    persistence: 'durable',
    reversible: 'unknown',
    summary: 'Updated package manifest',
    evidence: { path: 'package.json' },
    relatedFiles: ['package.json'],
  });

  ledger.append({
    id: 'impact_2',
    sessionId: 'sess_2',
    timestamp: '2026-05-01T11:00:00.000Z',
    actor: 'runtime',
    category: 'checkpoint',
    impact: 'low',
    persistence: 'durable',
    reversible: true,
    summary: 'Checkpoint saved',
    evidence: { checkpointId: 'cp_1' },
  });

  assert.equal(first.id, 'impact_1');
  assert.equal(ledger.list().length, 2);
  assert.equal(ledger.list()[0]?.id, 'impact_2');
  assert.deepEqual(ledger.listBySession('sess_1').map((event) => event.id), ['impact_1']);
  assert.deepEqual(ledger.listByCategory('checkpoint').map((event) => event.id), ['impact_2']);
  assert.deepEqual(ledger.list({ since: '2026-05-01T10:30:00.000Z' }).map((event) => event.id), ['impact_2']);
});

test('FileImpactLedger skips corrupt JSONL lines', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-impact-ledger-'));
  const ledgerPath = path.join(dir, 'impact.jsonl');
  fs.writeFileSync(ledgerPath, '{bad json}\n', 'utf-8');
  const ledger = new FileImpactLedger(ledgerPath);

  assert.deepEqual(ledger.list(), []);
});

test('createFileImpactLedger uses the canonical home-relative path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-impact-ledger-'));
  const ledger = createFileImpactLedger(dir);
  ledger.append({
    sessionId: 'sess_1',
    actor: 'runtime',
    category: 'decision',
    impact: 'low',
    persistence: 'durable',
    reversible: false,
    summary: 'Decision recorded',
    evidence: {},
  });

  assert.ok(fs.existsSync(defaultImpactLedgerPath(dir)));
});

test('buildImpactSummary formats compact ledger summaries', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-impact-ledger-'));
  const ledger = new FileImpactLedger(path.join(dir, 'impact.jsonl'));
  ledger.append({
    sessionId: 'sess_1',
    timestamp: '2026-05-01T10:00:00.000Z',
    actor: 'tool',
    category: 'file_change',
    impact: 'medium',
    persistence: 'durable',
    reversible: 'unknown',
    summary: 'Updated package manifest',
    evidence: {},
    relatedFiles: ['package.json'],
  });

  const summary = buildImpactSummary(ledger, { sessionId: 'sess_1' });
  assert.equal(summary.events.length, 1);
  assert.match(summary.message, /Impact events \(1 for this session\)/);
  assert.match(summary.message, /file_change: 1/);
  assert.match(summary.message, /package\.json/);
});
