import assert from 'node:assert/strict';
import test from 'node:test';

import { createWriteWorkspaceFileTool } from '../dist/tools/write-workspace-file.js';

test('writeWorkspaceFile returns a recoverable error when content is missing', async () => {
  const tool = createWriteWorkspaceFileTool();
  const result = await tool.execute({
    path: 'workflows/demo.workflow.ts',
    mode: 'create',
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /requires full file content/i);
});
