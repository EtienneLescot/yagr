import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createListDirectoryTool } from '../dist/tools/list-directory.js';
import { createReadWorkspaceFileTool } from '../dist/tools/read-workspace-file.js';
import { createSearchWorkspaceTool } from '../dist/tools/search-workspace.js';

function withTempWorkspace(run) {
  const previousHome = process.env.YAGR_HOME;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-workspace-tools-'));
  process.env.YAGR_HOME = tempDir;

  try {
    return run(tempDir);
  } finally {
    if (previousHome === undefined) {
      delete process.env.YAGR_HOME;
    } else {
      process.env.YAGR_HOME = previousHome;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test('listDirectory returns a structured error for missing directories', async () => {
  await withTempWorkspace(async () => {
    const tool = createListDirectoryTool();
    const result = await tool.execute({ path: 'workflows/Personal', recursive: false, maxDepth: 2 });

    assert.equal(result.ok, false);
    assert.equal(result.path, 'workflows/Personal');
    assert.match(result.error, /ENOENT|no such file or directory/i);
  });
});

test('readWorkspaceFile returns a structured error for missing files', async () => {
  await withTempWorkspace(async () => {
    const tool = createReadWorkspaceFileTool();
    const result = await tool.execute({ path: 'workflows/missing.workflow.ts' });

    assert.equal(result.ok, false);
    assert.equal(result.path, 'workflows/missing.workflow.ts');
    assert.match(result.error, /ENOENT|no such file or directory/i);
  });
});

test('searchWorkspace returns a structured error for missing roots', async () => {
  await withTempWorkspace(async () => {
    const tool = createSearchWorkspaceTool();
    const result = await tool.execute({ query: 'hello', path: 'missing-root', isRegexp: false, maxResults: 10 });

    assert.equal(result.ok, false);
    assert.equal(result.path, 'missing-root');
    assert.deepEqual(result.matches, []);
    assert.match(result.error, /ENOENT|no such file or directory/i);
  });
});