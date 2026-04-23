import test from 'node:test';
import assert from 'node:assert/strict';

import { n8nManagerPlugin, resolveManagerWorkflowDir } from './index.js';

test('n8n manager plugin exposes expected manifest capabilities', () => {
  assert.equal(n8nManagerPlugin.manifest.name, '@yagr/plugin-n8n-manager');
  assert.equal(n8nManagerPlugin.manifest.kind, 'manager');
  assert.ok(n8nManagerPlugin.manifest.capabilities?.workflows?.includes('n8n-manager'));
  assert.ok(n8nManagerPlugin.manifest.capabilities?.surfaces?.includes('webui'));
});

test('resolveManagerWorkflowDir builds a project workflow path', () => {
  const value = resolveManagerWorkflowDir({
    syncFolder: 'workflows',
    instanceIdentifier: '127.0.0.1:5678',
    projectName: 'My Project',
  }, '/tmp/yagr-workspace');

  assert.ok(value?.includes('127.0.0.1_5678'));
  assert.ok(value?.includes('my_project'));
});
