import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SessionService } from './index.js';
import { CompactionService } from './index.js';

test('session service rotates scoped sessions and persists memory through adapter', () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-session-service-'));
  const service = new SessionService({
    sessionsDir: path.join(baseDir, 'deepagent-sessions'),
    webUiSessionsDir: path.join(baseDir, 'ui-sessions'),
    memoriesDir: path.join(baseDir, 'memories'),
  });

  const scope = { kind: 'webui' as const, key: 'project-1' };
  const first = service.getOrCreateForScope(scope, { title: 'First' });
  const second = service.rotateForScope(scope, { title: 'Second' });

  assert.notEqual(first.id, second.id);
  assert.equal(service.getActiveForScope(scope)?.id, second.id);

  service.persistMemory(second.id, second.title, second.createdAt, [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: [{ type: 'text', text: 'World' }] },
  ]);

  const memoryFile = path.join(baseDir, 'memories', `${second.id}.json`);
  assert.ok(fs.existsSync(memoryFile));
});

test('checkpoint API saves payloads, emits events, restores metadata, and applies retention', async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-session-service-'));
  const service = new SessionService({
    sessionsDir: path.join(baseDir, 'deepagent-sessions'),
    webUiSessionsDir: path.join(baseDir, 'ui-sessions'),
    checkpointPolicy: { maxCheckpointsPerSession: 1 },
  });
  const checkpointer = new FakeCheckpointer();
  service.setCheckpointer(checkpointer as never);
  const events: string[] = [];
  service.onCheckpoint((event) => {
    events.push(event.type);
  });
  service.onCheckpoint(async () => {
    throw new Error('listener failure should not affect checkpoint lifecycle');
  });

  const session = service.create({ title: 'Original', scope: { kind: 'test', key: 'a' } });
  service.setTitle(session.id, 'Original');

  const first = await service.saveCheckpoint(session.id, {
    label: 'First',
    reason: 'manual',
    payloads: { surface: { displayThread: [{ role: 'user', text: 'hi' }] } },
  });
  const second = await service.saveCheckpoint(session.id, {
    label: 'Second',
    reason: 'after-tool',
    payloads: { compaction: { totalCompactions: 1, compactionHistory: [] } },
  });

  assert.equal(service.listCheckpointsSync(session.id).length, 1);
  assert.equal(service.listCheckpointsSync(session.id)[0]?.id, second.id);
  assert.ok(!fs.existsSync(path.join(baseDir, 'deepagent-sessions', session.id, 'checkpoints', first.id)));

  service.touch(session.id, { title: 'Changed' });
  const restored = await service.restoreCheckpoint(session.id, second.id);

  assert.equal(restored.langGraphRestored, true);
  assert.equal(restored.pendingWritesRestored, true);
  assert.deepEqual(restored.payloadsRestored, ['compaction']);
  assert.equal(service.get(session.id)?.title, 'Original');
  assert.deepEqual(events, ['saved', 'saved', 'restored']);
  assert.equal(checkpointer.putWritesCalls.length, 1);
});

test('maybeSaveCheckpoint obeys checkpoint policy', async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-session-service-'));
  const service = new SessionService({
    sessionsDir: path.join(baseDir, 'deepagent-sessions'),
    checkpointPolicy: { enabled: true, afterFileModifications: false },
  });
  service.setCheckpointer(new FakeCheckpointer() as never);
  const session = service.create({ title: 'Policy' });

  assert.equal(await service.maybeSaveCheckpoint(session.id, 'after-tool'), undefined);
  service.setCheckpointPolicy({ afterFileModifications: true });
  assert.ok(await service.maybeSaveCheckpoint(session.id, 'after-tool'));
});

test('compaction service stores history and context block in public session-service package', async () => {
  const service = new CompactionService({ historyLimit: 2 });

  await service.notifyCompaction('session-1', {
    summary: 'Summarized early messages',
    source: 'llm',
    estimatedTokens: 1200,
    thresholdTokens: 1000,
    messagesCompacted: 8,
    preservedRecentMessages: 4,
  });

  await service.notifyCompaction('session-1', {
    summary: 'Summarized another chunk',
    source: 'fallback',
    estimatedTokens: 1800,
    thresholdTokens: 1000,
    messagesCompacted: 6,
    preservedRecentMessages: 5,
    fallbackReason: 'safety',
  });

  const state = service.getState('session-1');

  assert.equal(state.totalCompactions, 2);
  assert.equal(state.compactionHistory.length, 2);
  assert.equal(state.lastCompaction?.summary, 'Summarized another chunk');
  assert.match(service.getContextBlock('session-1'), /Recent context compactions/);
  assert.match(service.getContextBlock('session-1'), /fallback/);
});

test('compaction service delegates manual compaction through public session-service package', async () => {
  const service = new CompactionService({}, async () => ({
    status: 'completed',
    event: {
      summary: 'Compacted now',
      source: 'llm',
      estimatedTokens: 500,
      thresholdTokens: 400,
      messagesCompacted: 3,
      preservedRecentMessages: 2,
    },
  }));

  const result = await service.compactSession('session-2');

  assert.equal(result.status, 'completed');
  assert.equal(service.getState('session-2').totalCompactions, 1);
});

class FakeCheckpointer {
  putWritesCalls: unknown[] = [];

  async getTuple(config: unknown) {
    return {
      config,
      checkpoint: {
        channel_values: {
          messages: [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi' },
          ],
        },
      },
      metadata: { source: 'loop', step: 1, parents: {} },
      pendingWrites: [['task-1', 'messages', { role: 'tool', content: 'ok' }]],
    };
  }

  async put(config: unknown) {
    return config;
  }

  async putWrites(config: unknown, writes: unknown, taskId: string) {
    this.putWritesCalls.push({ config, writes, taskId });
  }

  async deleteThread() {}
}
