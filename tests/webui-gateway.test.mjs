import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getWebUiGatewayStatus,
  mapPhaseEventToWebUiStreamEvent,
  mapStateEventToWebUiStreamEvent,
  mapToolEventToWebUiStreamEvent,
} from '../dist/gateway/webui.js';

test('getWebUiGatewayStatus is a pure read and does not persist defaults', () => {
  let updateCalls = 0;
  const configService = {
    getLocalConfig() {
      return {};
    },
    updateLocalConfig() {
      updateCalls += 1;
      throw new Error('updateLocalConfig should not be called when reading Web UI status');
    },
  };

  const status = getWebUiGatewayStatus(configService);

  assert.deepEqual(status, {
    configured: true,
    host: '127.0.0.1',
    port: 3789,
    url: 'http://127.0.0.1:3789',
  });
  assert.equal(updateCalls, 0);
});

test('mapToolEventToWebUiStreamEvent hides internal n8nac status noise but keeps user-facing progress', () => {
  assert.equal(
    mapToolEventToWebUiStreamEvent({
      type: 'status',
      toolName: 'n8nac',
      message: 'Runtime cwd=. envHost=- resolvedHost=http://127.0.0.1:5678',
    }),
    undefined,
  );

  assert.deepEqual(
    mapToolEventToWebUiStreamEvent({
      type: 'status',
      toolName: 'reportProgress',
      message: 'Inspecting the Gmail and Telegram node schemas.',
    }),
    {
      type: 'progress',
      tone: 'info',
      title: 'Progress',
      detail: 'Inspecting the Gmail and Telegram node schemas.',
    },
  );

  assert.deepEqual(
    mapToolEventToWebUiStreamEvent({
      type: 'status',
      toolName: 'requestRequiredAction',
      message: 'Need attention: reconnect the Gmail credential in n8n.',
    }),
    {
      type: 'progress',
      tone: 'info',
      title: 'Needs attention',
      detail: 'Need attention: reconnect the Gmail credential in n8n.',
    },
  );
});

test('mapPhaseEventToWebUiStreamEvent uses the shared user-visible update mapping', () => {
  assert.deepEqual(
    mapPhaseEventToWebUiStreamEvent({
      phase: 'validate',
      status: 'started',
      message: 'Validate phase started.',
    }),
    {
      type: 'progress',
      tone: 'info',
      title: 'Validate',
      detail: 'Validate phase started.',
      phase: 'validate',
    },
  );
});

test('mapStateEventToWebUiStreamEvent uses the shared user-visible update mapping', () => {
  assert.deepEqual(
    mapStateEventToWebUiStreamEvent({
      state: 'waiting_for_input',
      phase: 'edit',
      message: 'Need a missing credential reference.',
    }),
    {
      type: 'progress',
      tone: 'info',
      title: 'Needs input',
      detail: 'Need a missing credential reference.',
      phase: 'edit',
    },
  );
});
