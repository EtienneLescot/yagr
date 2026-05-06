import test from 'node:test';
import assert from 'node:assert/strict';

import { makeToolEndOperationEvent } from './index.js';

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

  assert.equal(event.summary, 'line 2');
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
