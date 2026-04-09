import assert from 'node:assert/strict';
import test from 'node:test';

import {
  makeToolEndOperationEvent,
  mapPhaseEventToUserVisibleUpdate,
  mapStateEventToUserVisibleUpdate,
  mapToolEventToUserVisibleUpdate,
} from '../dist/runtime/user-visible-updates.js';

test('mapPhaseEventToUserVisibleUpdate exposes started phase messages as user-visible updates', () => {
  assert.deepEqual(
    mapPhaseEventToUserVisibleUpdate({
      phase: 'inspect',
      status: 'started',
      message: 'Inspect phase started.',
    }),
    {
      tone: 'info',
      title: 'Inspect',
      detail: 'Inspect phase started.',
      phase: 'inspect',
      dedupeKey: 'phase:inspect:started:Inspect phase started.',
    },
  );
});

test('mapStateEventToUserVisibleUpdate surfaces actionable waiting states only', () => {
  assert.deepEqual(
    mapStateEventToUserVisibleUpdate({
      state: 'waiting_for_permission',
      phase: 'edit',
      message: 'Need permission to push the workflow.',
    }),
    {
      tone: 'info',
      title: 'Needs permission',
      detail: 'Need permission to push the workflow.',
      phase: 'edit',
      dedupeKey: 'state:waiting_for_permission:Need permission to push the workflow.',
    },
  );

  assert.equal(
    mapStateEventToUserVisibleUpdate({
      state: 'running',
      phase: 'inspect',
      message: 'Running.',
    }),
    undefined,
  );
});

test('mapToolEventToUserVisibleUpdate keeps only user-facing tool events', () => {
  assert.deepEqual(
    mapToolEventToUserVisibleUpdate({
      type: 'status',
      toolName: 'reportProgress',
      message: 'Inspecting the Gmail and Telegram node schemas.',
    }),
    {
      tone: 'info',
      title: 'Progress',
      detail: 'Inspecting the Gmail and Telegram node schemas.',
      dedupeKey: 'tool:reportProgress:Inspecting the Gmail and Telegram node schemas.',
    },
  );

  assert.equal(
    mapToolEventToUserVisibleUpdate({
      type: 'status',
      toolName: 'n8nac',
      message: 'Runtime cwd=. envHost=- resolvedHost=http://127.0.0.1:5678',
    }),
    undefined,
  );
});

test('makeToolEndOperationEvent preserves full execute output for shell logs', () => {
  const body = 'x'.repeat(5000);
  const event = makeToolEndOperationEvent(
    'tool:execute:test',
    'execute',
    `${body}\n[Command succeeded with exit code 0]`,
    Date.now() - 100,
  );

  assert.equal(event.status, 'done');
  assert.equal(event.body, body);
  assert.match(event.summary, /^exit 0/);
});

