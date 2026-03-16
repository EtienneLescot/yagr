import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateCompletionGate } from '../dist/runtime/completion-gate.js';
import { analyzeRunOutcome } from '../dist/runtime/outcome.js';
import { wrapToolsWithRuntimeHooks } from '../dist/runtime/policy-hooks.js';
import { collectRequiredActions } from '../dist/runtime/required-actions.js';

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