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

test('processStreamEvent emits a workflow embed from runScript stdout JSON', async () => {
  const accumulator = createRunAccumulator();
  const embeds = [];

  await processStreamEvent({
    event: 'on_tool_start',
    name: 'runScript',
    run_id: 'run-present',
    data: { input: { input: JSON.stringify({ command: 'yagr presentWorkflowResult --workflow-id wf-123' }) } },
  }, accumulator);

  await processStreamEvent({
    event: 'on_tool_end',
    name: 'runScript',
    run_id: 'run-present',
    data: {
      output: JSON.stringify({
        ok: true,
        command: 'yagr presentWorkflowResult --workflow-id wf-123',
        exitCode: 0,
        timedOut: false,
        stdout: `{
  "__type": "workflow-embed",
  "kind": "workflow",
  "workflowId": "wf-123",
  "url": "data:text/html,stub",
  "targetUrl": "https://example.com/workflow/wf-123",
  "via": "self-contained-auth",
  "diagram": "<workflow-map>stub</workflow-map>"
}`,
        stderr: 'langsmith/experimental/sandbox is in alpha.',
      }),
    },
  }, accumulator, {
    onWorkflowEmbed: async (embed) => {
      embeds.push(embed);
    },
  });

  assert.equal(embeds.length, 1);
  assert.equal(embeds[0].workflowId, 'wf-123');
  assert.match(`${embeds[0].targetUrl ?? ''}\n${embeds[0].url}`, /workflow\/wf-123|data:text\/html/);
  assert.equal(accumulator.workflowEmbeds.length, 1);
});

test('processStreamEvent emits a workflow embed from execute object output', async () => {
  const accumulator = createRunAccumulator();
  const embeds = [];

  await processStreamEvent({
    event: 'on_tool_end',
    name: 'execute',
    run_id: 'run-execute-object',
    data: {
      output: {
        output: `{
  "__type": "workflow-embed",
  "kind": "workflow",
  "workflowId": "wf-456",
  "url": "data:text/html,stub",
  "targetUrl": "https://example.com/workflow/wf-456",
  "via": "self-contained-auth"
}`,
        exitCode: 0,
        truncated: false,
      },
    },
  }, accumulator, {
    onWorkflowEmbed: async (embed) => {
      embeds.push(embed);
    },
  });

  assert.equal(embeds.length, 1);
  assert.equal(embeds[0].workflowId, 'wf-456');
  assert.equal(accumulator.workflowEmbeds.length, 1);
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