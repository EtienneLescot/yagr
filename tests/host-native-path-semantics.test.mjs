import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { LocalShellBackend } from 'deepagents';

test('host-native backend resolves relative paths from Yagr home and keeps absolute paths host-native', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-host-native-'));
  fs.mkdirSync(path.join(tempRoot, 'n8n-workspace'), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, 'n8n-workspace', 'n8nac-config.json'), '{"ok":true}\n', 'utf8');

  try {
    const backend = new LocalShellBackend({ rootDir: tempRoot, inheritEnv: true });
    await backend.initialize();

    const relativeResult = await backend.read('n8n-workspace/n8nac-config.json', 0, 20);
    const relativeContent = typeof relativeResult === 'string' ? relativeResult : relativeResult.content;
    assert.match(relativeContent, /ok/);

    const fakeVirtualResult = await backend.read('/n8n-workspace/n8nac-config.json', 0, 20);
    const fakeVirtualError = typeof fakeVirtualResult === 'string' ? fakeVirtualResult : fakeVirtualResult.error;
    assert.match(fakeVirtualError, /not found|Error reading file/i);

    await backend.close();
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});