import assert from 'node:assert/strict';
import test from 'node:test';

import {
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
      phase: 'sync',
      message: 'Need permission to push the workflow.',
    }),
    {
      tone: 'info',
      title: 'Needs permission',
      detail: 'Need permission to push the workflow.',
      phase: 'sync',
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

