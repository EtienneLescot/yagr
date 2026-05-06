import test from 'node:test';
import assert from 'node:assert/strict';

import { CompactionService } from '@yagr/session-service';

import { buildPristineDeepAgentConfig, createCompactionEventHandler } from './index.js';

test('deepagent bootstrap builds pristine config from explicit public inputs', () => {
  const config = buildPristineDeepAgentConfig({
    model: {} as any,
    checkpointer: {} as any,
    rootDir: '/tmp/project',
    memory: ['AGENTS.md'],
    skills: ['skills'],
  });

  assert.deepEqual(config.memory, ['AGENTS.md']);
  assert.deepEqual(config.skills, ['skills']);
  assert.ok(config.backend);
});

test('deepagent bootstrap compaction handler updates public compaction service state', async () => {
  const service = new CompactionService();
  const handler = createCompactionEventHandler({ sessionId: 's1', compactionService: service });

  await handler({
    event: 'on_llm_new_token',
    name: 'context_compaction',
    data: {
      chunk: {
        type: 'compaction',
        summary: 'Compacted by middleware',
        source: 'llm',
        estimatedTokens: 900,
        thresholdTokens: 800,
        messagesCompacted: 5,
        preservedRecentMessages: 4,
      },
    },
  } as any);

  assert.equal(service.getState('s1').lastCompaction?.summary, 'Compacted by middleware');
});
