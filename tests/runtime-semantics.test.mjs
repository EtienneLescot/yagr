import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { evaluateCompletionGate } from '../dist/runtime/completion-gate.js';
import { analyzeRunOutcome } from '../dist/runtime/outcome.js';
import {
  createDefaultRuntimeHooks,
  createWorkflowSyncCompletionGuardHook,
  createWorkflowPresentationGuardHook,
  wrapToolsWithRuntimeHooks,
} from '../dist/runtime/policy-hooks.js';
import { collectRequiredActions } from '../dist/runtime/required-actions.js';
import {
  buildGroundedSummary,
  INTERNAL_TAG_CLOSE,
  INTERNAL_TAG_OPEN,
  sanitizeAssistantOutput,
  sanitizeAssistantResponseMessages,
  shouldAbortForInternalPromptLeak,
  shouldAbortForRepetitiveAssistantOutput,
} from '../dist/runtime/run-engine.js';
import { createRequestRequiredActionTool as createRequestRequiredActionToolFactory } from '../dist/tools/request-required-action.js';

test('beforeTool hook can block execution with a structured required action', async () => {
  const wrappedTools = wrapToolsWithRuntimeHooks(
    {
      dangerousTool: {
        description: 'dangerous',
        parameters: undefined,
        execute: async () => ({ ok: true }),
      },
    },
    [
      {
        beforeTool: async () => ({
          allowed: false,
          message: 'Approval required before running this tool.',
          requiredAction: {
            id: 'approval-1',
            kind: 'permission',
            title: 'Approve command',
            message: 'Confirm the privileged command.',
            resumable: true,
          },
        }),
      },
    ],
    () => ({ runId: 'run-1', phase: 'edit', state: 'running' }),
  );

  const result = await wrappedTools.dangerousTool.execute({});

  assert.equal(result.ok, false);
  assert.equal(result.blocked, true);
  assert.equal(result.requiredAction.kind, 'permission');
});

test('requestRequiredAction defaults resumable to true and accepts omitted detail', async () => {
  const tool = createRequestRequiredActionToolFactory();
  const result = await tool.execute({
    kind: 'input',
    title: 'Need value',
    message: 'Provide a value.',
  });

  assert.equal(result.kind, 'input');
  assert.equal(result.detail, undefined);
  assert.equal(result.resumable, true);
});

test('workflow presentation is blocked until the workflow exists locally', async () => {
  const previousHome = process.env.YAGR_HOME;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-policy-hook-'));
  process.env.YAGR_HOME = tempRoot;

  try {
    const wrappedTools = wrapToolsWithRuntimeHooks(
      {
        presentWorkflowResult: {
          description: 'present workflow',
          parameters: undefined,
          execute: async () => ({ presented: true }),
        },
      },
      [createWorkflowPresentationGuardHook()],
      () => ({ runId: 'run-1', phase: 'plan', state: 'running' }),
    );

    const result = await wrappedTools.presentWorkflowResult.execute({
      workflowId: 'remote-only-workflow',
      workflowUrl: 'http://localhost:5678/workflow/remote-only-workflow',
    });

    assert.equal(result.ok, false);
    assert.equal(result.blocked, true);
    assert.equal(result.requiredAction.kind, 'external');
    assert.match(result.error, /must be pulled locally/i);
  } finally {
    if (previousHome === undefined) {
      delete process.env.YAGR_HOME;
    } else {
      process.env.YAGR_HOME = previousHome;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('workflow presentation is allowed when the caller already provides a diagram', async () => {
  const previousHome = process.env.YAGR_HOME;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-policy-hook-'));
  process.env.YAGR_HOME = tempRoot;

  try {
    const wrappedTools = wrapToolsWithRuntimeHooks(
      {
        presentWorkflowResult: {
          description: 'present workflow',
          parameters: undefined,
          execute: async () => ({ presented: true }),
        },
      },
      [createWorkflowPresentationGuardHook()],
      () => ({ runId: 'run-1', phase: 'plan', state: 'running' }),
    );

    const result = await wrappedTools.presentWorkflowResult.execute({
      workflowId: 'remote-only-workflow',
      workflowUrl: 'http://localhost:5678/workflow/remote-only-workflow',
      diagram: '<workflow-map>\nROUTING MAP\nStart\n</workflow-map>',
    });

    assert.equal(result.presented, true);
  } finally {
    if (previousHome === undefined) {
      delete process.env.YAGR_HOME;
    } else {
      process.env.YAGR_HOME = previousHome;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('workflow sync guard blocks exploratory tools after a successful push', async () => {
  const wrappedTools = wrapToolsWithRuntimeHooks(
    {
      n8nac: {
        description: 'n8nac',
        parameters: undefined,
        execute: async () => ({ exitCode: 0 }),
      },
      listDirectory: {
        description: 'list directory',
        parameters: undefined,
        execute: async () => ({ ok: true }),
      },
    },
    [createWorkflowSyncCompletionGuardHook()],
    () => ({ runId: 'run-sync-1', phase: 'sync', state: 'running' }),
  );

  const pushResult = await wrappedTools.n8nac.execute({ action: 'push', filename: 'demo.workflow.ts' });
  const blockedResult = await wrappedTools.listDirectory.execute({ path: '.' });

  assert.equal(pushResult.exitCode, 0);
  assert.equal(blockedResult.ok, false);
  assert.equal(blockedResult.blocked, true);
  assert.match(blockedResult.error, /already pushed and verified/i);
});

test('workflow sync guard still allows final presentation after a successful push', async () => {
  const wrappedTools = wrapToolsWithRuntimeHooks(
    {
      n8nac: {
        description: 'n8nac',
        parameters: undefined,
        execute: async () => ({ exitCode: 0 }),
      },
      presentWorkflowResult: {
        description: 'present workflow',
        parameters: undefined,
        execute: async () => ({ presented: true }),
      },
    },
    [createWorkflowSyncCompletionGuardHook()],
    () => ({ runId: 'run-sync-2', phase: 'sync', state: 'running' }),
  );

  await wrappedTools.n8nac.execute({ action: 'push', filename: 'demo.workflow.ts' });
  const presentResult = await wrappedTools.presentWorkflowResult.execute({
    workflowId: 'wf-1',
    workflowUrl: 'http://localhost:5678/workflow/wf-1',
    diagram: '<workflow-map>\nROUTING MAP\nStart\n</workflow-map>',
  });

  assert.equal(presentResult.presented, true);
});

test('later successful retry clears an earlier unresolved n8nac failure', () => {
  const journal = [
    {
      timestamp: '2026-03-16T10:00:00.000Z',
      type: 'step',
      status: 'completed',
      message: 'validate failed',
      phase: 'validate',
      stepNumber: 1,
      step: {
        stepNumber: 1,
        stepType: 'tool-result',
        finishReason: 'tool-calls',
        phase: 'validate',
        text: '',
        toolCalls: [{ toolName: 'n8nac', args: { action: 'validate', validateFile: 'demo.workflow.ts' } }],
        toolResults: [{ toolName: 'n8nac', result: { exitCode: 1 } }],
      },
    },
    {
      timestamp: '2026-03-16T10:01:00.000Z',
      type: 'step',
      status: 'completed',
      message: 'validate succeeded',
      phase: 'validate',
      stepNumber: 2,
      step: {
        stepNumber: 2,
        stepType: 'tool-result',
        finishReason: 'tool-calls',
        phase: 'validate',
        text: '',
        toolCalls: [{ toolName: 'n8nac', args: { action: 'validate', validateFile: 'demo.workflow.ts' } }],
        toolResults: [{ toolName: 'n8nac', result: { exitCode: 0 } }],
      },
    },
  ];

  const outcome = analyzeRunOutcome(journal);

  assert.equal(outcome.unresolvedFailedActions.length, 0);
  assert.ok(outcome.successfulValidate);
});

test('setup_check is ignored in observed n8nac failures', () => {
  const journal = [
    {
      timestamp: '2026-03-18T10:00:00.000Z',
      type: 'step',
      status: 'completed',
      message: 'setup check',
      phase: 'plan',
      stepNumber: 1,
      step: {
        stepNumber: 1,
        stepType: 'tool-result',
        finishReason: 'tool-calls',
        phase: 'plan',
        text: '',
        toolCalls: [{ toolName: 'n8nac', args: { action: 'setup_check' } }],
        toolResults: [{ toolName: 'n8nac', result: { initialized: false } }],
      },
    },
  ];

  const outcome = analyzeRunOutcome(journal);

  assert.equal(outcome.failedActions.length, 0);
  assert.equal(outcome.unresolvedFailedActions.length, 0);
});

test('assistant output sanitization removes leaked internal execution scaffolding', () => {
  const leaked = [
    `${INTERNAL_TAG_OPEN}Yagr internal phase: execute.`,
    'Complete the task end-to-end using the gathered context.',
    'When appropriate, author or edit workflow files, validate them, sync them, verify them, and then summarize what changed.',
    'Ask the user only when a specific missing value blocks execution.',
    `Original request: Est-ce que tu pourrais me faire un petit workflow "Hello World"?${INTERNAL_TAG_CLOSE}`,
    'Workflow cree: hello-world.workflow.ts',
  ].join('\n');

  assert.equal(sanitizeAssistantOutput(leaked), 'Workflow cree: hello-world.workflow.ts');
});

test('repeated leaked internal prompts trigger a loop abort signal', () => {
  const singleBlock = `${INTERNAL_TAG_OPEN}Yagr internal phase: execute.\nOriginal request: hello${INTERNAL_TAG_CLOSE}`;
  const repeatedLeak = `${singleBlock}\n${singleBlock}`;

  assert.equal(shouldAbortForInternalPromptLeak(repeatedLeak), true);
  assert.equal(shouldAbortForInternalPromptLeak(repeatedLeak, 'Debut de reponse visible.'), false);
});

test('repeated output block triggers repetitive output abort signal', () => {
  const bundle = [
    'Final workflow content:',
    'import { workflow } from \'@n8n-as-code/transformer\';',
    'Final workflow status: Deployed and verified.',
    'Final workflow URL: http://localhost:5678/workflow/abc123.',
  ].join('\n');

  assert.equal(shouldAbortForRepetitiveAssistantOutput(`${bundle}${bundle}`), true);
  assert.equal(shouldAbortForRepetitiveAssistantOutput(bundle), false);
});

test('assistant response messages are sanitized before reuse across phases', () => {
  const sanitized = sanitizeAssistantResponseMessages([
    {
      role: 'assistant',
      content: [
        { type: 'text', text: `${INTERNAL_TAG_OPEN}Yagr internal phase: inspect.\nOriginal request: hello${INTERNAL_TAG_CLOSE}` },
        { type: 'text', text: 'Workflow cree: exotic.workflow.ts' },
      ],
    },
    {
      role: 'assistant',
      content: `${INTERNAL_TAG_OPEN}Yagr internal phase: execute.\nOriginal request: hello${INTERNAL_TAG_CLOSE}`,
    },
    {
      role: 'tool',
      content: [{ type: 'tool-result', toolCallId: 'call-1', toolName: 'listDirectory', result: { ok: true } }],
    },
  ]);

  assert.equal(sanitized.length, 2);
  assert.deepEqual(sanitized[0], {
    role: 'assistant',
    content: [
      { type: 'text', text: 'Workflow cree: exotic.workflow.ts' },
    ],
  });
  assert.equal(sanitized[1].role, 'tool');
});

test('sanitized inspect carry-over does not include the internal inspect control prompt', () => {
  const inspectResponseMessages = sanitizeAssistantResponseMessages([
    {
      role: 'assistant',
      content: 'Je vais inspecter les exemples disponibles.',
    },
  ]);

  const executionContext = [
    { role: 'user', content: 'Est-ce que tu peux me faire un petit workflow exotique?' },
    ...inspectResponseMessages,
  ];

  assert.equal(executionContext.some((message) => typeof message.content === 'string' && message.content.includes('Yagr internal phase: inspect.')), false);
});

test('successful push counts as validate and verify evidence for completion gating', async () => {
  const journal = [
    {
      timestamp: '2026-03-16T10:03:00.000Z',
      type: 'step',
      status: 'completed',
      message: 'push succeeded',
      phase: 'sync',
      stepNumber: 1,
      step: {
        stepNumber: 1,
        stepType: 'tool-result',
        finishReason: 'tool-calls',
        phase: 'sync',
        text: '',
        toolCalls: [
          { toolName: 'writeWorkspaceFile', args: { path: 'workflows/demo.workflow.ts' } },
          { toolName: 'n8nac', args: { action: 'push', filename: 'demo.workflow.ts' } },
        ],
        toolResults: [
          { toolName: 'writeWorkspaceFile', result: { ok: true, path: 'workflows/demo.workflow.ts' } },
          { toolName: 'n8nac', result: { exitCode: 0 } },
        ],
      },
    },
  ];

  const outcome = analyzeRunOutcome(journal);

  assert.ok(outcome.successfulPush);
  assert.ok(outcome.successfulValidate);
  assert.ok(outcome.successfulVerify);

  const decision = await evaluateCompletionGate({
    text: 'Done.',
    finishReason: 'stop',
    requiredActions: [],
    hasWorkflowWrites: outcome.hasWorkflowWrites,
    successfulValidate: Boolean(outcome.successfulValidate),
    successfulPush: Boolean(outcome.successfulPush),
    successfulVerify: Boolean(outcome.successfulVerify),
    unresolvedFailureCount: outcome.unresolvedFailedActions.length,
    context: { runId: 'run-push', phase: 'summarize', state: 'running' },
  });

  assert.equal(decision.accepted, true);
  assert.equal(decision.state, 'completed');
});

test('grounded summary prefers a user-facing workflow completion message when a workflow was pushed', () => {
  const journal = [
    {
      timestamp: '2026-03-23T12:00:00.000Z',
      type: 'step',
      status: 'completed',
      message: 'workflow pushed',
      phase: 'sync',
      stepNumber: 1,
      step: {
        stepNumber: 1,
        stepType: 'tool-result',
        finishReason: 'tool-calls',
        phase: 'sync',
        text: '',
        toolCalls: [
          { toolName: 'writeWorkspaceFile', args: { path: 'workflows/demo.workflow.ts' } },
          { toolName: 'n8nac', args: { action: 'push', filename: 'demo.workflow.ts' } },
        ],
        toolResults: [
          { toolName: 'writeWorkspaceFile', result: { ok: true, path: 'workflows/demo.workflow.ts' } },
          { toolName: 'n8nac', result: { exitCode: 0 } },
        ],
      },
    },
  ];

  const summary = buildGroundedSummary('Create a workflow.', 'tool-calls', journal, []);

  assert.match(summary, /workflow `demo` a ete cree/i);
  assert.doesNotMatch(summary, /Le run s’est termine avec la raison/);
});

test('grounded summary includes workflow URL from presentWorkflowResult when available', () => {
  const journal = [
    {
      timestamp: '2026-03-23T12:01:00.000Z',
      type: 'step',
      status: 'completed',
      message: 'workflow presented',
      phase: 'summarize',
      stepNumber: 1,
      step: {
        stepNumber: 1,
        stepType: 'tool-result',
        finishReason: 'tool-calls',
        phase: 'summarize',
        text: '',
        toolCalls: [
          { toolName: 'presentWorkflowResult', args: { workflowId: 'wf-1', workflowUrl: 'http://localhost:5678/workflow/wf-1' } },
        ],
        toolResults: [
          { toolName: 'presentWorkflowResult', result: { presented: true, workflowId: 'wf-1', workflowUrl: 'http://localhost:5678/workflow/wf-1', title: 'Demo Flow' } },
        ],
      },
    },
    {
      timestamp: '2026-03-23T12:02:00.000Z',
      type: 'step',
      status: 'completed',
      message: 'workflow pushed',
      phase: 'sync',
      stepNumber: 2,
      step: {
        stepNumber: 2,
        stepType: 'tool-result',
        finishReason: 'tool-calls',
        phase: 'sync',
        text: '',
        toolCalls: [
          { toolName: 'writeWorkspaceFile', args: { path: 'workflows/demo.workflow.ts' } },
          { toolName: 'n8nac', args: { action: 'push', filename: 'demo.workflow.ts' } },
        ],
        toolResults: [
          { toolName: 'writeWorkspaceFile', result: { ok: true, path: 'workflows/demo.workflow.ts' } },
          { toolName: 'n8nac', result: { exitCode: 0 } },
        ],
      },
    },
  ];

  const summary = buildGroundedSummary('Create a workflow.', 'tool-calls', journal, []);

  assert.match(summary, /Demo Flow/);
  assert.match(summary, /http:\/\/localhost:5678\/workflow\/wf-1/);
});

test('completion gate stays blocked when a required action is still open', async () => {
  const requiredActions = collectRequiredActions([
    {
      timestamp: '2026-03-16T10:02:00.000Z',
      type: 'step',
      status: 'completed',
      message: 'required action raised',
      phase: 'plan',
      stepNumber: 1,
      step: {
        stepNumber: 1,
        stepType: 'tool-result',
        finishReason: 'tool-calls',
        phase: 'plan',
        text: '',
        toolCalls: [{ toolName: 'requestRequiredAction', args: { kind: 'input', title: 'Need host', message: 'Provide the n8n host.', resumable: true } }],
        toolResults: [{ toolName: 'requestRequiredAction', result: { id: 'input-1', kind: 'input', title: 'Need host', message: 'Provide the n8n host.', resumable: true } }],
      },
    },
  ]);

  const decision = await evaluateCompletionGate({
    text: 'Done.',
    finishReason: 'stop',
    requiredActions,
    hasWorkflowWrites: false,
    successfulValidate: false,
    successfulPush: false,
    successfulVerify: false,
    unresolvedFailureCount: 0,
    context: { runId: 'run-2', phase: 'summarize', state: 'running' },
  });

  assert.equal(decision.accepted, false);
  assert.equal(decision.state, 'waiting_for_input');
  assert.equal(decision.requiredActions.length, 1);
});

test('beforeCompletion hook can inject a permission blocker', async () => {
  const decision = await evaluateCompletionGate({
    text: 'Done.',
    finishReason: 'stop',
    requiredActions: [],
    hasWorkflowWrites: false,
    successfulValidate: true,
    successfulPush: true,
    successfulVerify: true,
    unresolvedFailureCount: 0,
    hooks: [
      {
        beforeCompletion: async () => ({
          accepted: false,
          message: 'Manual approval is required before completion.',
          requiredAction: {
            id: 'approval-2',
            kind: 'permission',
            title: 'Review completion',
            message: 'Approve the final state.',
            resumable: true,
          },
        }),
      },
    ],
    context: { runId: 'run-3', phase: 'summarize', state: 'running' },
  });

  assert.equal(decision.accepted, false);
  assert.equal(decision.state, 'waiting_for_permission');
  assert.equal(decision.requiredActions[0].kind, 'permission');
});

test('approved required action bypasses beforeTool permission blocker', async () => {
  let executed = false;

  const wrappedTools = wrapToolsWithRuntimeHooks(
    {
      dangerousTool: {
        description: 'dangerous',
        parameters: undefined,
        execute: async () => {
          executed = true;
          return { ok: true };
        },
      },
    },
    [
      {
        beforeTool: async () => ({
          allowed: false,
          message: 'Approval required before running this tool.',
          requiredAction: {
            id: 'approval-3',
            kind: 'permission',
            title: 'Approve command',
            message: 'Confirm the privileged command.',
            resumable: true,
          },
        }),
      },
    ],
    () => ({ runId: 'run-4', phase: 'edit', state: 'running' }),
    ['approval-3'],
  );

  const result = await wrappedTools.dangerousTool.execute({});

  assert.equal(result.ok, true);
  assert.equal(executed, true);
});

test('approved required action bypasses completion blocker', async () => {
  const decision = await evaluateCompletionGate({
    text: 'Done.',
    finishReason: 'stop',
    requiredActions: [],
    satisfiedRequiredActionIds: ['approval-4'],
    hasWorkflowWrites: false,
    successfulValidate: true,
    successfulPush: true,
    successfulVerify: true,
    unresolvedFailureCount: 0,
    hooks: [
      {
        beforeCompletion: async () => ({
          accepted: false,
          message: 'Manual approval is required before completion.',
          requiredAction: {
            id: 'approval-4',
            kind: 'permission',
            title: 'Review completion',
            message: 'Approve the final state.',
            resumable: true,
          },
        }),
      },
    ],
    context: { runId: 'run-5', phase: 'summarize', state: 'running' },
  });

  assert.equal(decision.accepted, true);
  assert.equal(decision.state, 'completed');
  assert.equal(decision.requiredActions.length, 0);
});

test('completion gate does not fail terminally on exploratory n8nac failures without workflow writes', async () => {
  const decision = await evaluateCompletionGate({
    text: 'Je peux quand meme repondre sans n8n pour cette question.',
    finishReason: 'stop',
    requiredActions: [],
    hasWorkflowWrites: false,
    successfulValidate: false,
    successfulPush: false,
    successfulVerify: false,
    unresolvedFailureCount: 1,
    context: { runId: 'run-6', phase: 'summarize', state: 'running' },
  });

  assert.equal(decision.accepted, true);
  assert.equal(decision.state, 'completed');
  assert.equal(decision.requiredActions.length, 0);
});

test('completion gate still fails terminally on unresolved n8nac failures after workflow writes', async () => {
  const decision = await evaluateCompletionGate({
    text: 'Done.',
    finishReason: 'stop',
    requiredActions: [],
    hasWorkflowWrites: true,
    successfulValidate: false,
    successfulPush: false,
    successfulVerify: false,
    unresolvedFailureCount: 1,
    context: { runId: 'run-7', phase: 'summarize', state: 'running' },
  });

  assert.equal(decision.accepted, false);
  assert.equal(decision.state, 'failed_terminal');
});
