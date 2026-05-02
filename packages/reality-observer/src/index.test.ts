import test from 'node:test';
import assert from 'node:assert/strict';

import { FileImpactLedger } from '@yagr/impact-ledger';
import { impactFromRuntimeOperation, recordRuntimeOperationImpact } from './index.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('impactFromRuntimeOperation ignores non-meaningful runtime operations', () => {
  assert.equal(impactFromRuntimeOperation({ sessionId: 'sess_1' }, {
    kind: 'operation',
    operationId: 'read_1',
    label: 'Read file',
    category: 'file-read',
    status: 'done',
    startedAt: 0,
  }), null);
});

test('impactFromRuntimeOperation classifies file writes', () => {
  const impact = impactFromRuntimeOperation({ sessionId: 'sess_1', turnId: 'turn_1' }, {
    kind: 'operation',
    operationId: 'write_1',
    label: 'write',
    category: 'file-write',
    status: 'done',
    summary: '.github/workflows/ci.yml',
    startedAt: Date.parse('2026-05-01T10:00:00.000Z'),
    endedAt: Date.parse('2026-05-01T10:00:01.000Z'),
  });

  assert.equal(impact?.sessionId, 'sess_1');
  assert.equal(impact?.turnId, 'turn_1');
  assert.equal(impact?.operationId, 'write_1');
  assert.equal(impact?.category, 'automation_updated');
  assert.equal(impact?.persistence, 'durable');
  assert.deepEqual(impact?.relatedFiles, ['.github/workflows/ci.yml']);
});

test('impactFromRuntimeOperation preserves file input after completion summary changes', () => {
  const impact = impactFromRuntimeOperation({ sessionId: 'sess_1' }, {
    kind: 'operation',
    operationId: 'write_1',
    label: 'Write package.json',
    category: 'file-write',
    status: 'done',
    inputSummary: 'package.json',
    summary: '20 lines written',
    startedAt: Date.parse('2026-05-01T10:00:00.000Z'),
    endedAt: Date.parse('2026-05-01T10:00:01.000Z'),
  });

  assert.equal(impact?.category, 'file_change');
  assert.equal(impact?.impact, 'medium');
  assert.deepEqual(impact?.relatedFiles, ['package.json']);
});

test('impactFromRuntimeOperation classifies dependency shell commands', () => {
  const impact = impactFromRuntimeOperation({ sessionId: 'sess_1' }, {
    kind: 'operation',
    operationId: 'shell_1',
    label: 'execute',
    category: 'shell',
    status: 'done',
    summary: 'npm install lodash',
    startedAt: Date.parse('2026-05-01T10:00:00.000Z'),
  });

  assert.equal(impact?.category, 'dependency_change');
  assert.equal(impact?.impact, 'high');
  assert.equal(impact?.persistence, 'durable');
  assert.deepEqual(impact?.relatedCommands, ['npm install lodash']);
});

test('impactFromRuntimeOperation preserves shell input after completion summary changes', () => {
  const impact = impactFromRuntimeOperation({ sessionId: 'sess_1' }, {
    kind: 'operation',
    operationId: 'shell_1',
    label: 'Shell: npm install lodash',
    category: 'shell',
    status: 'done',
    inputSummary: 'npm install lodash',
    summary: 'exit 0',
    startedAt: Date.parse('2026-05-01T10:00:00.000Z'),
  });

  assert.equal(impact?.category, 'dependency_change');
  assert.equal(impact?.impact, 'high');
  assert.deepEqual(impact?.relatedCommands, ['npm install lodash']);
});

test('recordRuntimeOperationImpact appends classified impact to a ledger', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-reality-observer-'));
  const ledger = new FileImpactLedger(path.join(dir, 'impact.jsonl'));

  const recorded = recordRuntimeOperationImpact(ledger, { sessionId: 'sess_1' }, {
    kind: 'operation',
    operationId: 'shell_1',
    label: 'execute',
    category: 'shell',
    status: 'done',
    summary: 'npm install lodash',
    startedAt: Date.parse('2026-05-01T10:00:00.000Z'),
  });

  assert.equal(recorded?.category, 'dependency_change');
  assert.equal(ledger.listBySession('sess_1').length, 1);
});
