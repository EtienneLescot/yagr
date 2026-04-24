import assert from 'node:assert/strict';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { GenericContainer } from 'testcontainers';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function isDockerHostAvailable() {
  try {
    await execFileAsync('docker', ['info'], { timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

test('yagr n8n doctor reports Docker as required in a Node-only Linux container', async (t) => {
  if (!(await isDockerHostAvailable())) {
    t.skip('Docker host is not available for integration tests.');
    return;
  }

  const container = await new GenericContainer('node:22-alpine')
    .withBindMounts([{
      source: repoRoot,
      target: '/workspace',
    }])
    .withWorkingDir('/workspace')
    .withCommand(['sh', '-lc', 'sleep 300'])
    .start();

  t.after(async () => {
    await container.stop();
  });

  const { output } = await container.exec(['sh', '-lc', 'node dist/cli.js n8n doctor']);
  const stdout = Array.isArray(output) ? output.join('\n') : String(output);

  assert.match(stdout, /Local n8n bootstrap assessment/);
  assert.match(stdout, /Suggested runtime: manual/);
  assert.match(stdout, /Preferred URL: http:\/\/127\.0\.0\.1:5678/);
  assert.match(stdout, /Yagr-managed local n8n requires Docker/i);
}, 30_000);
