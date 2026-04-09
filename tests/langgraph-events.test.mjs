import assert from 'node:assert/strict';
import test from 'node:test';

import { createRunAccumulator, processStreamEvent } from '../dist/gateway/langgraph-events.js';

test('processStreamEvent keeps concurrent execute outputs attached to the correct operation', async () => {
  const accumulator = createRunAccumulator();
  const operations = [];

  await processStreamEvent({
    event: 'on_tool_start',
    name: 'execute',
    run_id: 'run-a',
    data: { input: { input: JSON.stringify({ command: 'npx --yes n8nac skills validate --help' }) } },
  }, accumulator, {
    onOperation: async (event) => {
      operations.push(event);
    },
  });

  await processStreamEvent({
    event: 'on_tool_start',
    name: 'execute',
    run_id: 'run-b',
    data: { input: { input: JSON.stringify({ command: 'npx --yes n8nac node-schema lmChatOpenAi' }) } },
  }, accumulator, {
    onOperation: async (event) => {
      operations.push(event);
    },
  });

  await processStreamEvent({
    event: 'on_tool_end',
    name: 'execute',
    run_id: 'run-b',
    data: { output: 'node-schema output\n[Command succeeded with exit code 0]' },
  }, accumulator, {
    onOperation: async (event) => {
      operations.push(event);
    },
  });

  await processStreamEvent({
    event: 'on_tool_end',
    name: 'execute',
    run_id: 'run-a',
    data: { output: 'validate help output\n[Command succeeded with exit code 0]' },
  }, accumulator, {
    onOperation: async (event) => {
      operations.push(event);
    },
  });

  const completed = operations.filter((event) => event.status === 'done');
  assert.equal(completed.length, 2);

  const validateOp = completed.find((event) => event.label === 'Shell: npx --yes n8nac skills validate --help');
  const schemaOp = completed.find((event) => event.label === 'Shell: npx --yes n8nac node-schema lmChatOpenAi');

  assert.equal(validateOp?.body, 'validate help output');
  assert.equal(schemaOp?.body, 'node-schema output');
});