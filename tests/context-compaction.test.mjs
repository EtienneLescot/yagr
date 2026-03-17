import assert from 'node:assert/strict';
import test from 'node:test';

import { compactConversationContext } from '../dist/runtime/context-compaction.js';

test('context compaction uses an LLM summary when the budget is exceeded', async () => {
  const messages = [
    { role: 'user', content: 'Create a workflow that watches incoming leads and enriches them.' },
    { role: 'assistant', content: 'I will inspect the workspace and examples first.' },
    { role: 'user', content: 'Use the CRM schema from the repository rules.' },
    { role: 'assistant', content: 'I found the workflow directory and started editing the file.' },
    { role: 'user', content: 'Make sure validation and push happen before completion.' },
    { role: 'assistant', content: 'Validation succeeded and I am preparing the push.' },
  ];

  const result = await compactConversationContext({
    messages,
    prompt: 'Build the lead enrichment workflow.',
    systemPrompt: 'System prompt '.repeat(80),
    journal: [
      {
        timestamp: '2026-03-16T12:00:00.000Z',
        type: 'step',
        status: 'completed',
        message: 'write completed',
        phase: 'edit',
        stepNumber: 1,
        step: {
          stepNumber: 1,
          stepType: 'tool-result',
          finishReason: 'tool-calls',
          phase: 'edit',
          text: '',
          toolCalls: [{ toolName: 'writeWorkspaceFile', args: { path: 'workflows/lead.workflow.ts' } }],
          toolResults: [{ toolName: 'writeWorkspaceFile', result: { ok: true, path: 'workflows/lead.workflow.ts' } }],
        },
      },
    ],
    budget: {
      contextWindowTokens: 300,
      reservedOutputTokens: 60,
      thresholdPercent: 70,
      preserveRecentMessages: 2,
      charsPerToken: 4,
    },
    condense: async (summaryPrompt) => {
      assert.match(summaryPrompt, /Original request: Build the lead enrichment workflow\./);
      return '## Yagr Context Checkpoint\n\nOriginal request: Build the lead enrichment workflow.\nWritten files: workflows/lead.workflow.ts\nContinue from the saved checkpoint.';
    },
  });

  assert.ok(result.event);
  assert.equal(result.messages.length, 3);
  assert.equal(result.messages[0].role, 'user');
  assert.equal(result.event.source, 'llm');
  assert.match(result.messages[0].content, /Yagr Context Checkpoint/);
  assert.match(result.messages[0].content, /Original request: Build the lead enrichment workflow\./);
  assert.match(result.messages[0].content, /Written files: workflows\/lead\.workflow\.ts/);
  assert.equal(result.event.messagesCompacted, 4);
  assert.equal(result.event.preservedRecentMessages, 2);
});

test('context compaction falls back deterministically when LLM condensation fails', async () => {
  const messages = [
    { role: 'user', content: 'Create a workflow that watches incoming leads and enriches them.' },
    { role: 'assistant', content: 'I will inspect the workspace and examples first.' },
    { role: 'user', content: 'Use the CRM schema from the repository rules.' },
    { role: 'assistant', content: 'I found the workflow directory and started editing the file.' },
    { role: 'user', content: 'Make sure validation and push happen before completion.' },
    { role: 'assistant', content: 'Validation succeeded and I am preparing the push.' },
  ];

  const result = await compactConversationContext({
    messages,
    prompt: 'Build the lead enrichment workflow.',
    systemPrompt: 'System prompt '.repeat(80),
    journal: [
      {
        timestamp: '2026-03-16T12:00:00.000Z',
        type: 'step',
        status: 'completed',
        message: 'write completed',
        phase: 'edit',
        stepNumber: 1,
        step: {
          stepNumber: 1,
          stepType: 'tool-result',
          finishReason: 'tool-calls',
          phase: 'edit',
          text: '',
          toolCalls: [{ toolName: 'writeWorkspaceFile', args: { path: 'workflows/lead.workflow.ts' } }],
          toolResults: [{ toolName: 'writeWorkspaceFile', result: { ok: true, path: 'workflows/lead.workflow.ts' } }],
        },
      },
    ],
    budget: {
      contextWindowTokens: 300,
      reservedOutputTokens: 60,
      thresholdPercent: 70,
      preserveRecentMessages: 2,
      charsPerToken: 4,
    },
    condense: async () => {
      throw new Error('synthetic condensation failure');
    },
  });

  assert.ok(result.event);
  assert.equal(result.event.source, 'fallback');
  assert.match(result.event.fallbackReason, /synthetic condensation failure/);
  assert.match(result.messages[0].content, /## Yagr Context Checkpoint/);
  assert.match(result.messages[0].content, /Written files: workflows\/lead\.workflow\.ts/);
  assert.equal(result.event.messagesCompacted, 4);
  assert.equal(result.event.preservedRecentMessages, 2);
});

test('context compaction leaves messages untouched when under budget', async () => {
  const messages = [
    { role: 'user', content: 'Short request.' },
    { role: 'assistant', content: 'Short reply.' },
  ];

  const result = await compactConversationContext({
    messages,
    prompt: 'Short request.',
    systemPrompt: 'Short system prompt.',
    journal: [],
    budget: {
      contextWindowTokens: 10_000,
      reservedOutputTokens: 500,
      thresholdPercent: 70,
      preserveRecentMessages: 2,
      charsPerToken: 4,
    },
  });

  assert.equal(result.event, undefined);
  assert.deepEqual(result.messages, messages);
});