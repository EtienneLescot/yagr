import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('custom runtime system prompt layer has been removed', () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'src/prompt/build-system-prompt.ts')), false);
});

test('agent factory source stays free of manager-specific wording', () => {
  const content = readRepoFile('src/agent-factory.ts');

  assert.doesNotMatch(content, /n8n config change/i);
  assert.doesNotMatch(content, /yagrProxy/i);
  assert.doesNotMatch(content, /presentWorkflowResult/i);
  assert.doesNotMatch(content, /n8nac/i);
});

test('gateways do not short-circuit manager behavior before the agent runs', () => {
  for (const relativePath of [
    'src/gateway/cli.ts',
    'src/gateway/interactive-ui.tsx',
    'src/gateway/webui.ts',
    'src/gateway/telegram.ts',
  ]) {
    const content = readRepoFile(relativePath);
    assert.doesNotMatch(content, /prepareManagerPrompt/i);
    assert.doesNotMatch(content, /Manager preflight/i);
  }
});

test('root package exports do not advertise legacy workspace-scoped file tools', () => {
  const content = readRepoFile('src/index.ts');

  assert.doesNotMatch(content, /createListDirTool/);
  assert.doesNotMatch(content, /createDeleteFileTool/);
  assert.doesNotMatch(content, /createMoveFileTool/);
  assert.doesNotMatch(content, /createReadFileTool/);
  assert.doesNotMatch(content, /createReplaceInFileTool/);
  assert.doesNotMatch(content, /createGrepTool/);
  assert.doesNotMatch(content, /createWriteFileTool/);
});

test('legacy workspace-root standalone tool layer has been removed', () => {
  for (const relativePath of [
    'src/tools/http-request.ts',
    'src/tools/report-progress.ts',
    'src/tools/request-required-action.ts',
    'src/tools/langchain/http-request.ts',
    'src/tools/langchain/report-progress.ts',
    'src/tools/langchain/request-required-action.ts',
    'src/tools/langchain/move-file.ts',
    'src/tools/langchain/delete-file.ts',
    'src/tools/langchain/index.ts',
    'tests/http-request.test.mjs',
    'src/tools/workspace-utils.ts',
    'src/tools/list-directory.ts',
    'src/tools/read-workspace-file.ts',
    'src/tools/search-workspace.ts',
    'src/tools/write-workspace-file.ts',
    'src/tools/replace-in-workspace-file.ts',
    'src/tools/move-workspace-file.ts',
    'src/tools/delete-workspace-file.ts',
    'src/tools/langchain/move-workspace-file.ts',
    'src/tools/langchain/delete-workspace-file.ts',
    'tests/workspace-tools.test.mjs',
    'tests/write-workspace-file.test.mjs',
  ]) {
    assert.equal(fs.existsSync(path.join(REPO_ROOT, relativePath)), false, `${relativePath} should be removed`);
  }
});