import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('SafeLocalShellBackend globInfo avoids .wine-style symlink traversal', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-safe-backend-'));
  const wineDir = path.join(tempRoot, '.wine', 'dosdevices');
  fs.mkdirSync(wineDir, { recursive: true });
  fs.writeFileSync(path.join(tempRoot, 'AGENTS.md'), '# Home\n', 'utf8');

  try {
    fs.symlinkSync('/', path.join(wineDir, 'z:'), 'dir');
  } catch {
    t.skip('Symlinks are not available in this environment.');
    return;
  }

  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const { SafeLocalShellBackend } = await import('../dist/tools/safe-local-shell-backend.js');
  const backend = new SafeLocalShellBackend({ rootDir: tempRoot, inheritEnv: true });

  const results = await backend.globInfo('**/*');

  assert.ok(Array.isArray(results));
  assert.ok(results.every((entry) => !entry.path.includes('lost+found')));
});