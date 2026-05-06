import test from 'node:test';
import assert from 'node:assert/strict';

import { createLangGraphStreamAccumulator, extractLastAiMessage, processLangGraphStreamEvent } from './index.js';

test('stream adapter records file modifications from public package accumulator', async () => {
  const accumulator = createLangGraphStreamAccumulator();
  const operations: unknown[] = [];

  await processLangGraphStreamEvent({
    event: 'on_tool_start',
    name: 'write_file',
    run_id: 'run-1',
    data: { input: { input: JSON.stringify({ path: 'src/file.ts' }) } },
  } as any, accumulator, { onOperation: (operation) => { operations.push(operation); } });

  await processLangGraphStreamEvent({
    event: 'on_tool_end',
    name: 'write_file',
    run_id: 'run-1',
    data: { output: 'written' },
  } as any, accumulator, { onOperation: (operation) => { operations.push(operation); } });

  assert.equal(accumulator.fileModificationDetected, true);
  assert.equal(operations.length, 2);
});

test('stream adapter emits legacy user-visible progress from public package', async () => {
  const accumulator = createLangGraphStreamAccumulator();
  const updates: unknown[] = [];

  await processLangGraphStreamEvent({
    event: 'on_tool_end',
    name: 'reportProgress',
    run_id: 'run-1',
    data: { output: JSON.stringify({ message: 'Half way' }) },
  } as any, accumulator, { onUserVisibleUpdate: (update) => { updates.push(update); } });

  assert.deepEqual(updates, [{
    tone: 'info',
    title: 'Progress',
    detail: 'Half way',
    dedupeKey: 'tool:reportProgress:Half way',
  }]);
});

test('stream adapter collects required actions from tool output', async () => {
  const accumulator = createLangGraphStreamAccumulator();

  await processLangGraphStreamEvent({
    event: 'on_tool_end',
    name: 'requestRequiredAction',
    run_id: 'run-1',
    data: { output: JSON.stringify({ id: 'act-1', title: 'Approve', message: 'Continue?' }) },
  } as any, accumulator);

  assert.deepEqual(accumulator.requiredActions, [{ id: 'act-1', kind: 'input', title: 'Approve', message: 'Continue?', resumable: true }]);
});

test('stream adapter skips operation cards for internal progress-only tools', async () => {
  const accumulator = createLangGraphStreamAccumulator();
  const operations: unknown[] = [];
  const updates: unknown[] = [];

  await processLangGraphStreamEvent({
    event: 'on_tool_start',
    name: 'reportProgress',
    run_id: 'run-1',
    data: { input: { input: JSON.stringify({ message: 'Working' }) } },
  } as any, accumulator, {
    onOperation: (operation) => { operations.push(operation); },
    onUserVisibleUpdate: (update) => { updates.push(update); },
  });

  assert.equal(operations.length, 0);
  assert.equal(updates.length, 0);
  assert.equal(accumulator.activeOperations.size, 0);
});

test('extractLastAiMessage is available from public stream adapter', () => {
  assert.equal(extractLastAiMessage({ messages: [{ role: 'assistant', content: [{ type: 'text', text: 'done' }] }] }), 'done');
});
