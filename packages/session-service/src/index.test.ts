import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SessionService } from './index.js';

test('session service rotates scoped sessions and persists memory through adapter', () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-session-service-'));
  const service = new SessionService({
    sessionsDir: path.join(baseDir, 'deepagent-sessions'),
    webUiSessionsDir: path.join(baseDir, 'ui-sessions'),
    memoriesDir: path.join(baseDir, 'memories'),
  });

  const scope = { kind: 'webui' as const, key: 'project-1' };
  const first = service.getOrCreateForScope(scope, { title: 'First' });
  const second = service.rotateForScope(scope, { title: 'Second' });

  assert.notEqual(first.id, second.id);
  assert.equal(service.getActiveForScope(scope)?.id, second.id);

  service.persistMemory(second.id, second.title, second.createdAt, [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: [{ type: 'text', text: 'World' }] },
  ]);

  const memoryFile = path.join(baseDir, 'memories', `${second.id}.json`);
  assert.ok(fs.existsSync(memoryFile));
});
