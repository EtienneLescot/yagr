import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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

test('managed local n8n can be installed and queried through the CLI', async (t) => {
  if (!(await isDockerHostAvailable())) {
    t.skip('Docker host is not available for integration tests.');
    return;
  }

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-n8n-local-'));
  const env = {
    ...process.env,
    YAGR_HOME: tempHome,
  };

  t.after(async () => {
    try {
      await execFileAsync('node', ['dist/cli.js', 'n8n', 'local', 'stop'], {
        cwd: repoRoot,
        env,
        timeout: 120_000,
      });
    } catch {
      // Ignore cleanup failures for already-stopped instances.
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  const install = await execFileAsync('node', ['dist/cli.js', 'n8n', 'local', 'install'], {
    cwd: repoRoot,
    env,
    timeout: 180_000,
  });
  assert.match(install.stdout, /Managed local n8n installed and started/);

  const status = await execFileAsync('node', ['dist/cli.js', 'n8n', 'local', 'status'], {
    cwd: repoRoot,
    env,
    timeout: 30_000,
  });
  const payload = JSON.parse(status.stdout);

  assert.equal(payload.installed, true);
  assert.equal(payload.running, true);
  assert.equal(payload.healthy, true);
  assert.match(payload.url, /^http:\/\/127\.0\.0\.1:\d+$/);
}, 240_000);
