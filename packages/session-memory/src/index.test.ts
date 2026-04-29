import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { extractSessionMemory, FileSessionMemoryAdapter, type SessionMessage } from './index.js';

test('extractSessionMemory collects compact structured memory', () => {
  const messages: SessionMessage[] = [
    { role: 'user', content: 'Set up onboarding automation' },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'I created the onboarding automation.' },
        { type: 'tool-call', toolName: 'execute', args: { command: 'npm test' } },
      ],
    },
  ];

  const record = extractSessionMemory('sess_1', 'Onboarding', '2026-04-23T10:00:00.000Z', messages);
  assert.equal(record.sessionId, 'sess_1');
  assert.ok(record.summary.includes('Requests:'));
  assert.deepEqual(record.toolsUsed, ['execute']);
});

test('FileSessionMemoryAdapter persists and lists records', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-memory-'));
  const adapter = new FileSessionMemoryAdapter(dir);
  adapter.persist({
    sessionId: 'sess_1',
    title: 'Title',
    createdAt: '2026-04-23T10:00:00.000Z',
    updatedAt: '2026-04-23T10:01:00.000Z',
    summary: 'Summary',
    toolsUsed: ['toolA'],
  });

  assert.equal(adapter.get('sess_1')?.title, 'Title');
  assert.equal(adapter.list().length, 1);
  assert.ok(adapter.buildContextBlock().includes('Title'));
});
