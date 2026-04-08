import assert from 'node:assert/strict';
import test from 'node:test';

import { presentWorkflowResultCli } from '../dist/manager-tooling/present-workflow.js';
import { extractSessionMemory } from '../dist/memory/extract-session-memory.js';

test('presentWorkflowResultCli returns a workflow embed payload', async () => {
  const payload = await presentWorkflowResultCli({
    workflowId: 'wf-123',
    workflowUrl: 'http://localhost:5678/workflow/wf-123',
    title: 'Demo workflow',
    diagram: '<workflow-map>\nStart\n  → End\n</workflow-map>',
  });

  assert.equal(payload.__type, 'workflow-embed');
  assert.equal(payload.workflowId, 'wf-123');
  assert.equal(payload.url, 'http://localhost:5678/workflow/wf-123');
});

test('session memory captures workflow references from yagr presentWorkflowResult execute commands', () => {
  const memory = extractSessionMemory('s1', 'title', new Date().toISOString(), [
    {
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolName: 'execute',
          args: {
            command: 'yagr presentWorkflowResult --workflow-id wf-123 --title "Demo workflow"',
          },
        },
      ],
    },
  ]);

  assert.deepEqual(memory.workflowRefs, [{ id: 'wf-123', title: 'wf-123' }]);
});