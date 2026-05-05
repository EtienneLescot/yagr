import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRunAccumulator,
  processStreamEvent,
} from '../dist/gateway/langgraph-events.js';

test('processStreamEvent keeps concurrent execute outputs attached to the correct operation', async () => {
  const accumulator = createRunAccumulator();
  const operations = [];

  await processStreamEvent({
    event: 'on_tool_start',
    name: 'execute',
    run_id: 'run-a',
    data: { input: { input: JSON.stringify({ command: 'npm test -- --help' }) } },
  }, accumulator, {
    onOperation: async (event) => {
      operations.push(event);
    },
  });

  await processStreamEvent({
    event: 'on_tool_start',
    name: 'execute',
    run_id: 'run-b',
    data: { input: { input: JSON.stringify({ command: 'npm run build' }) } },
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

  const validateOp = completed.find((event) => event.label === 'Shell: npm test -- --help');
  const schemaOp = completed.find((event) => event.label === 'Shell: npm run build');

  assert.equal(validateOp?.body, 'validate help output');
  assert.equal(schemaOp?.body, 'node-schema output');
});

test('processStreamEvent does not set fileModificationDetected for execute tool', async () => {
  const accumulator = createRunAccumulator();
  assert.equal(accumulator.fileModificationDetected, false);

  await processStreamEvent({
    event: 'on_tool_end',
    name: 'execute',
    run_id: 'run-execute',
    data: { output: 'some output\n[Command succeeded with exit code 0]' },
  }, accumulator);

  assert.equal(accumulator.fileModificationDetected, false);
});

test('processStreamEvent sets fileModificationDetected for writeFile tool', async () => {
  const accumulator = createRunAccumulator();
  assert.equal(accumulator.fileModificationDetected, false);

  await processStreamEvent({
    event: 'on_tool_end',
    name: 'writeFile',
    run_id: 'run-writefile',
    data: { output: '{"ok": true}' },
  }, accumulator);

  assert.equal(accumulator.fileModificationDetected, true);
});

test('processStreamEvent sets fileModificationDetected for write_file tool', async () => {
  const accumulator = createRunAccumulator();
  assert.equal(accumulator.fileModificationDetected, false);

  await processStreamEvent({
    event: 'on_tool_end',
    name: 'write_file',
    run_id: 'run-write-file',
    data: { output: '{"ok": true}' },
  }, accumulator);

  assert.equal(accumulator.fileModificationDetected, true);
});

test('processStreamEvent sets fileModificationDetected for deleteFile tool', async () => {
  const accumulator = createRunAccumulator();
  assert.equal(accumulator.fileModificationDetected, false);

  await processStreamEvent({
    event: 'on_tool_end',
    name: 'deleteFile',
    run_id: 'run-deletefile',
    data: { output: '{"ok": true}' },
  }, accumulator);

  assert.equal(accumulator.fileModificationDetected, true);
});

test('processStreamEvent sets fileModificationDetected for moveFile tool', async () => {
  const accumulator = createRunAccumulator();
  assert.equal(accumulator.fileModificationDetected, false);

  await processStreamEvent({
    event: 'on_tool_end',
    name: 'moveFile',
    run_id: 'run-movefile',
    data: { output: '{"ok": true}' },
  }, accumulator);

  assert.equal(accumulator.fileModificationDetected, true);
});

test('processStreamEvent sets fileModificationDetected for replaceInFile tool', async () => {
  const accumulator = createRunAccumulator();
  assert.equal(accumulator.fileModificationDetected, false);

  await processStreamEvent({
    event: 'on_tool_end',
    name: 'replaceInFile',
    run_id: 'run-replaceinfile',
    data: { output: '{"ok": true}' },
  }, accumulator);

  assert.equal(accumulator.fileModificationDetected, true);
});

test('processStreamEvent sets fileModificationDetected for edit_file tool', async () => {
  const accumulator = createRunAccumulator();
  assert.equal(accumulator.fileModificationDetected, false);

  await processStreamEvent({
    event: 'on_tool_end',
    name: 'edit_file',
    run_id: 'run-editfile',
    data: { output: '{"ok": true}' },
  }, accumulator);

  assert.equal(accumulator.fileModificationDetected, true);
});

test('processStreamEvent emits api context usage from stream usage metadata', async () => {
  const accumulator = createRunAccumulator();
  const usages = [];

  await processStreamEvent({
    event: 'on_chat_model_stream',
    name: 'ChatModel',
    run_id: 'run-usage-stream',
    data: {
      chunk: {
        content: '',
        usage_metadata: {
          input_tokens: 200,
          output_tokens: 50,
          total_tokens: 250,
        },
      },
    },
  }, accumulator, {
    contextWindowTokens: 1000,
    onContextUsage: async (event) => {
      usages.push(event);
    },
  });

  assert.deepEqual(usages, [{
    type: 'context-usage',
    promptTokens: 200,
    completionTokens: 50,
    contextWindowTokens: 1000,
    fillPercent: 25,
    source: 'api',
  }]);
  assert.equal(accumulator.contextUsages.length, 1);
});

test('processStreamEvent emits api context usage from model end llm output', async () => {
  const accumulator = createRunAccumulator();
  const usages = [];

  await processStreamEvent({
    event: 'on_chat_model_end',
    name: 'ChatModel',
    run_id: 'run-usage-end',
    data: {
      output: {
        llmOutput: {
          usage: {
            promptTokens: 750,
            completionTokens: 250,
          },
        },
      },
    },
  }, accumulator, {
    contextWindowTokens: 2000,
    onContextUsage: async (event) => {
      usages.push(event);
    },
  });

  assert.deepEqual(usages, [{
    type: 'context-usage',
    promptTokens: 750,
    completionTokens: 250,
    contextWindowTokens: 2000,
    fillPercent: 50,
    source: 'api',
  }]);
});

test('processStreamEvent does not emit context usage without api metadata', async () => {
  const accumulator = createRunAccumulator();
  const usages = [];

  await processStreamEvent({
    event: 'on_chat_model_stream',
    name: 'ChatModel',
    run_id: 'run-no-usage',
    data: { chunk: { content: 'hello' } },
  }, accumulator, {
    contextWindowTokens: 1000,
    onContextUsage: async (event) => {
      usages.push(event);
    },
  });

  assert.equal(usages.length, 0);
  assert.equal(accumulator.contextUsages.length, 0);
});
