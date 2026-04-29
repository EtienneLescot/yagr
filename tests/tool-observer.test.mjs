import assert from 'node:assert/strict';
import test from 'node:test';

import { getUserFacingToolStatus } from '../dist/tools/observer.js';

test('getUserFacingToolStatus exposes only explicitly user-facing status events', () => {
  assert.deepEqual(
    getUserFacingToolStatus({
      type: 'status',
      toolName: 'reportProgress',
      message: 'Inspecting the Gmail and Telegram node schemas.',
    }),
    {
      title: 'Progress',
      detail: 'Inspecting the Gmail and Telegram node schemas.',
    },
  );

  assert.deepEqual(
    getUserFacingToolStatus({
      type: 'status',
      toolName: 'requestRequiredAction',
      message: 'Need attention: reconnect the external credential.',
    }),
    {
      title: 'Needs attention',
      detail: 'Need attention: reconnect the external credential.',
    },
  );

  assert.equal(
    getUserFacingToolStatus({
      type: 'status',
      toolName: 'shellTool',
      message: 'Runtime cwd=. envHost=- resolvedHost=http://127.0.0.1:5678',
    }),
    undefined,
  );
});
