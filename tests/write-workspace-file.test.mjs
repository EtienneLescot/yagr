import assert from 'node:assert/strict';
import test from 'node:test';

import { createWriteFileTool } from '../dist/tools/write-workspace-file.js';

test('writeFile returns a recoverable error when content is missing', async () => {
  const tool = createWriteFileTool();
  const result = await tool.execute({
    path: 'workflows/demo.workflow.ts',
    mode: 'create',
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /requires full file content/i);
});
