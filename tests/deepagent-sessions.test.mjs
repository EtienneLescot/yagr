import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  DeepAgentSessionStore,
  buildDeepAgentSessionConfig,
  deriveSessionTitle,
} from '../dist/session/deepagent-sessions.js';

test('DeepAgentSessionStore resolves one active session per scope and can rotate it', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-deepagent-sessions-'));
  const store = new DeepAgentSessionStore(tempDir);

  const first = store.getOrCreateActiveForScope(
    { kind: 'telegram', key: '42' },
    { title: 'Telegram chat 42' },
  );
  const second = store.getOrCreateActiveForScope(
    { kind: 'telegram', key: '42' },
    { title: 'Ignored' },
  );

  assert.equal(second.id, first.id);

  const rotated = store.rotateActiveForScope(
    { kind: 'telegram', key: '42' },
    { title: 'Telegram chat 42 (new)' },
  );

  assert.notEqual(rotated.id, first.id);
  assert.equal(store.getActiveForScope({ kind: 'telegram', key: '42' })?.id, rotated.id);
  assert.ok(store.get(first.id)?.closedAt, 'previous scoped session should be marked closed');
});

test('DeepAgentSessionStore clears scope mappings and deletes records', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-deepagent-sessions-'));
  const store = new DeepAgentSessionStore(tempDir);

  const session = store.create({
    title: 'Web session',
    scope: { kind: 'webui', key: 'abc' },
  });

  store.clearActiveScope({ kind: 'webui', key: 'abc' });
  assert.equal(store.getActiveForScope({ kind: 'webui', key: 'abc' }), undefined);

  store.delete(session.id);
  assert.equal(store.get(session.id), undefined);
});

test('buildDeepAgentSessionConfig emits the runnable thread config expected by LangGraph', () => {
  assert.deepEqual(buildDeepAgentSessionConfig('session-123'), {
    configurable: { thread_id: 'session-123' },
    version: 'v2',
  });
});

test('deriveSessionTitle trims and truncates prompt text', () => {
  assert.equal(deriveSessionTitle('   hello   world   '), 'hello world');
  assert.equal(
    deriveSessionTitle('a'.repeat(100)).length,
    80,
  );
});
