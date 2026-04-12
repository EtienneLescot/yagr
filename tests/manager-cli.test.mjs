import assert from 'node:assert/strict';
import test from 'node:test';

import { presentWorkflowResultCli } from '../dist/manager-tooling/present-workflow.js';
import { extractSessionMemory } from '../dist/memory/extract-session-memory.js';
import { stopN8nTunnel, getActiveTunnelState } from '../dist/n8n-local/n8n-tunnel.js';
import { YagrN8nConfigService } from '../dist/config/n8n-config-service.js';

test('presentWorkflowResultCli returns a workflow embed payload', async (t) => {
  // Stop any active tunnel to ensure deterministic test results
  await stopN8nTunnel();

  const payload = await presentWorkflowResultCli({
    workflowId: 'wf-123',
    workflowUrl: 'http://localhost:5678/workflow/wf-123',
    title: 'Demo workflow',
    diagram: '<workflow-map>\nStart\n  → End\n</workflow-map>',
  });

  assert.equal(payload.__type, 'workflow-embed');
  assert.equal(payload.workflowId, 'wf-123');

  // The resolved URL depends on the configured host (which may be a tunnel URL in test environments)
  // Verify that the URL contains the correct workflow path
  assert.ok(payload.url.includes('/workflow/wf-123'), `URL should contain workflow path, got: ${payload.url}`);
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