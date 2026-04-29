import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MemorySaver } from '@langchain/langgraph';

import {
  CheckpointManager,
  DeepAgentSessionStore,
  buildDeepAgentSessionConfig,
  deriveSessionTitle,
} from '../packages/session-checkpoint/dist/index.js';
import { SessionService } from '../packages/session-service/dist/index.js';

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

test('CheckpointManager saves and restores the full LangGraph checkpoint tuple', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-checkpoints-'));
  const checkpointer = new MemorySaver();
  const manager = new CheckpointManager(checkpointer, tempDir);

  const checkpointConfig = await checkpointer.put(
    { configurable: { thread_id: 'session-1' } },
    {
      v: 4,
      id: 'checkpoint-1',
      ts: new Date().toISOString(),
      channel_values: { messages: ['hello', 'world'] },
      channel_versions: { messages: 1 },
      versions_seen: {},
    },
    { source: 'loop', step: 3, parents: {} },
    {},
  );
  await checkpointer.putWrites(checkpointConfig, [['messages', { id: 'write-1', value: 'pending' }]], 'task-1');

  const saved = await manager.saveCheckpoint('session-1');
  await checkpointer.deleteThread('session-1');

  await manager.restoreCheckpoint('session-1', saved.id);

  const restored = await checkpointer.getTuple({ configurable: { thread_id: 'session-1' } });
  assert.ok(restored);
  assert.deepEqual(restored.checkpoint.channel_values.messages, ['hello', 'world']);
  assert.deepEqual(restored.metadata, { source: 'loop', step: 3, parents: {} });
  assert.deepEqual(restored.pendingWrites, [['task-1', 'messages', { id: 'write-1', value: 'pending' }]]);
});

test('SessionService.delete removes persisted checkpoint directories', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-session-service-'));
  const sessionsDir = path.join(rootDir, 'sessions');
  const memoriesDir = path.join(rootDir, 'memories');
  const service = new SessionService({ sessionsDir, memoriesDir });
  const checkpointer = new MemorySaver();
  service.setCheckpointer(checkpointer);

  service.create({ id: 'session-2', title: 'Session 2' });
  await checkpointer.put(
    { configurable: { thread_id: 'session-2' } },
    {
      v: 4,
      id: 'checkpoint-2',
      ts: new Date().toISOString(),
      channel_values: { messages: ['persist me'] },
      channel_versions: { messages: 1 },
      versions_seen: {},
    },
    { source: 'loop', step: 1, parents: {} },
    {},
  );

  const saved = await service.saveCheckpoint('session-2');
  const checkpointDir = path.join(sessionsDir, 'session-2', 'checkpoints', saved.id);
  assert.equal(fs.existsSync(checkpointDir), true);

  await service.delete('session-2');

  assert.equal(fs.existsSync(checkpointDir), false);
  assert.equal(await checkpointer.getTuple({ configurable: { thread_id: 'session-2' } }), undefined);
});

test('CheckpointManager saves and restores compaction state alongside checkpoint', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-checkpoints-compaction-'));
  const checkpointer = new MemorySaver();
  const manager = new CheckpointManager(checkpointer, tempDir);

  await checkpointer.put(
    { configurable: { thread_id: 'session-compaction' } },
    {
      v: 4,
      id: 'checkpoint-compaction',
      ts: new Date().toISOString(),
      channel_values: { messages: ['hello'] },
      channel_versions: { messages: 1 },
      versions_seen: {},
    },
    { source: 'loop', step: 1, parents: {} },
    {},
  );

  const compactionState = {
    lastCompaction: { summary: 'test summary', source: 'llm', messagesCompacted: 10, preservedRecentMessages: 4 },
    compactionHistory: [],
    totalCompactions: 1,
  };

  const saved = await manager.saveCheckpoint('session-compaction', compactionState);
  await checkpointer.deleteThread('session-compaction');

  const restoredCompaction = await manager.restoreCheckpoint('session-compaction', saved.id);

  assert.equal(restoredCompaction?.totalCompactions, 1);
  assert.equal(restoredCompaction?.lastCompaction?.summary, 'test summary');
  assert.equal(restoredCompaction?.lastCompaction?.messagesCompacted, 10);
});

test('CheckpointManager restoreCheckpoint returns null when no compaction state was saved', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-checkpoints-nocompaction-'));
  const checkpointer = new MemorySaver();
  const manager = new CheckpointManager(checkpointer, tempDir);

  await checkpointer.put(
    { configurable: { thread_id: 'session-nocompaction' } },
    {
      v: 4,
      id: 'checkpoint-nocompaction',
      ts: new Date().toISOString(),
      channel_values: { messages: ['hello'] },
      channel_versions: { messages: 1 },
      versions_seen: {},
    },
    { source: 'loop', step: 1, parents: {} },
    {},
  );

  const saved = await manager.saveCheckpoint('session-nocompaction');
  await checkpointer.deleteThread('session-compaction');

  const restoredCompaction = await manager.restoreCheckpoint('session-nocompaction', saved.id);

  assert.equal(restoredCompaction, null);
});

test('SessionService.saveCheckpoint throws when no initializer and no checkpointer set', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-session-service-noaccess-'));
  const sessionsDir = path.join(rootDir, 'sessions');
  const memoriesDir = path.join(rootDir, 'memories');
  const service = new SessionService({ sessionsDir, memoriesDir });

  await assert.rejects(
    async () => service.saveCheckpoint('some-session'),
    /Checkpoint access not available/,
  );
});

test('SessionService.registerCheckpointInitializer enables lazy checkpoint access', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-session-service-init-'));
  const sessionsDir = path.join(rootDir, 'sessions');
  const memoriesDir = path.join(rootDir, 'memories');
  const service = new SessionService({ sessionsDir, memoriesDir });
  const checkpointer = new MemorySaver();

  service.registerCheckpointInitializer(async () => checkpointer);

  await service.ensureCheckpointAccess();
  assert.deepEqual(await service.listCheckpoints('session-init-test'), []);
});

test('SessionService.restoreCheckpoint returns RestoreResult with payload state', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-session-service-restore-'));
  const sessionsDir = path.join(rootDir, 'sessions');
  const memoriesDir = path.join(rootDir, 'memories');
  const service = new SessionService({ sessionsDir, memoriesDir });
  const checkpointer = new MemorySaver();
  service.setCheckpointer(checkpointer);

  service.create({ id: 'session-restore-test', title: 'Test session' });
  await checkpointer.put(
    { configurable: { thread_id: 'session-restore-test' } },
    {
      v: 4,
      id: 'checkpoint-restore-test',
      ts: new Date().toISOString(),
      channel_values: { messages: ['hello'] },
      channel_versions: { messages: 1 },
      versions_seen: {},
    },
    { source: 'loop', step: 1, parents: {} },
    {},
  );

  const compactionState = {
    lastCompaction: { summary: 'restore test', source: 'llm', messagesCompacted: 5, preservedRecentMessages: 4 },
    compactionHistory: [],
    totalCompactions: 1,
  };

  const saved = await service.saveCheckpoint('session-restore-test', { payloadState: compactionState });
  await checkpointer.deleteThread('session-restore-test');

  const result = await service.restoreCheckpoint('session-restore-test', saved.id);

  assert.equal(result.checkpointId, saved.id);
  assert.equal(result.sessionId, 'session-restore-test');
  assert.equal(result.payloadState?.totalCompactions, 1);
  assert.equal(result.payloadState?.lastCompaction?.summary, 'restore test');
  assert.ok(result.restoredAt);
});
