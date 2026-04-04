import assert from 'node:assert/strict';
import test from 'node:test';

import { createRunScriptTool } from '../dist/tools/run-script.js';

test('runScript executes an allowed command and returns stdout', async () => {
  const tool = createRunScriptTool();
  const result = await tool.execute({
    command: 'node -e "process.stdout.write(\'hello\')"',
    timeoutMs: 5000,
  });

  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, 'hello');
});

test('runScript rejects a command not in the approved list when mode is user-approved', async () => {
  const tool = createRunScriptTool(undefined, { mode: 'user-approved', approved: ['npm run', 'node -e'] });
  const result = await tool.execute({
    command: 'rm -rf /tmp/yagr-test-should-never-run',
    timeoutMs: 5000,
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /not in approved list/i);
});

test('runScript captures non-zero exit code', async () => {
  const tool = createRunScriptTool();
  const result = await tool.execute({
    command: 'node -e "process.exit(1)"',
    timeoutMs: 5000,
  });

  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
});

test('runScript captures stderr', async () => {
  const tool = createRunScriptTool();
  const result = await tool.execute({
    command: 'node -e "process.stderr.write(\'oops\')"',
    timeoutMs: 5000,
  });

  assert.equal(result.stderr, 'oops');
});
