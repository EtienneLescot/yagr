import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTools } from '../dist/tools/build-tools.js';

test('runtime tool surface includes core and filesystem tools', () => {
  const tools = buildTools();

  assert.ok(tools.reportProgress);
  assert.ok(tools.requestRequiredAction);
  assert.ok(tools.n8nac);
  assert.ok(tools.listDirectory);
  assert.ok(tools.readWorkspaceFile);
  assert.ok(tools.searchWorkspace);
  assert.ok(tools.writeWorkspaceFile);
  assert.ok(tools.presentWorkflowResult);
});

test('runtime tool surface can be reduced to a strategy-selected subset', () => {
  const tools = buildTools(undefined, {
    allowedToolNames: ['reportProgress', 'requestRequiredAction', 'presentWorkflowResult'],
  });

  assert.deepEqual(Object.keys(tools).sort(), ['presentWorkflowResult', 'reportProgress', 'requestRequiredAction']);
});
