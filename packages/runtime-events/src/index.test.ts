import test from 'node:test';
import assert from 'node:assert/strict';

import { makeGenericToolStartOperationEvent, makeToolEndOperationEvent, mapToolStartToUserVisibleUpdate } from './index.js';

test('makeToolEndOperationEvent unwraps serialized LangChain ToolMessage output', () => {
  const event = makeToolEndOperationEvent('op-1', 'read_file', {
    lc: 1,
    type: 'constructor',
    id: ['langchain_core', 'messages', 'ToolMessage'],
    kwargs: {
      status: 'success',
      content: [
        { type: 'text', text: 'line 1\nline 2' },
      ],
    },
  }, 1);

  assert.equal(event.summary, '2 lines');
  assert.equal(event.body, 'line 1\nline 2');
});

test('makeToolEndOperationEvent hides LangGraph Command update internals', () => {
  const event = makeToolEndOperationEvent('op-1', 'write_todos', {
    lg_name: 'Command',
    update: {
      todos: [{ content: 'Load instructions', status: 'in_progress' }],
    },
  }, 1);

  assert.equal(event.summary, 'Updated todos');
  assert.equal(event.body, undefined);
});

test('makeToolEndOperationEvent extracts shell exit status and body', () => {
  const event = makeToolEndOperationEvent('op-1', 'execute', 'first\nlast\n[Command succeeded with exit code 0]', 1);

  assert.equal(event.status, 'done');
  assert.equal(event.summary, 'exit 0  last');
  assert.equal(event.body, 'first\nlast');
});

test('makeGenericToolStartOperationEvent uses user-facing labels and categories', () => {
  const shell = makeGenericToolStartOperationEvent('execute', { command: 'npm test' });
  const todos = makeGenericToolStartOperationEvent('write_todos', { todos: [] });

  assert.equal(shell.label, 'Shell: npm test');
  assert.equal(shell.category, 'shell');
  assert.equal(todos.operationId, 'tool:write_todos');
  assert.equal(todos.label, 'Planning');
  assert.equal(todos.category, 'phase');
  assert.equal(todos.phase, 'plan');
});

test('mapToolStartToUserVisibleUpdate exposes legacy progress updates from public package', () => {
  assert.deepEqual(mapToolStartToUserVisibleUpdate('write_todos', { todos: [] }), {
    tone: 'info',
    title: 'Plan',
    phase: 'plan',
    dedupeKey: 'tool:write_todos',
  });
});
