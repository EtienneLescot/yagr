import assert from 'node:assert/strict';
import test from 'node:test';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createN8nAcTool, getN8nacProcessEnv, pickPreferredWorkspaceWorkflowCandidate } from '../dist/tools/n8nac.js';

test('n8nac tool schema accepts legacy skills action aliases', () => {
  const tool = createN8nAcTool();

  const withSkillsArgs = tool.parameters.safeParse({
    action: 'skillsArgs',
    skillsArgs: 'examples search "creative fun unusual"',
  });
  const withSkillsArgv = tool.parameters.safeParse({
    action: 'skillsArgv',
    skillsArgv: ['examples', 'search', 'creative fun unusual'],
  });

  assert.equal(withSkillsArgs.success, true);
  assert.equal(withSkillsArgv.success, true);
});

test('n8nac tool schema still accepts the canonical skills action', () => {
  const tool = createN8nAcTool();

  const parsed = tool.parameters.safeParse({
    action: 'skills',
    skillsArgs: 'search telegram',
  });

  assert.equal(parsed.success, true);
});

test('n8nac tool injects centralized host and api key into CLI environment', () => {
  const env = getN8nacProcessEnv({}, {
    getLocalConfig: () => ({ host: 'https://n8n.example.com' }),
    getApiKey: (host) => host === 'https://n8n.example.com' ? 'secret-key' : undefined,
  });

  assert.equal(env.N8N_HOST, 'https://n8n.example.com');
  assert.equal(env.N8N_API_KEY, 'secret-key');
});

test('n8nac tool preserves explicitly provided CLI environment values', () => {
  const env = getN8nacProcessEnv({ N8N_HOST: 'https://override.example.com', N8N_API_KEY: 'override-key' }, {
    getLocalConfig: () => ({ host: 'https://n8n.example.com' }),
    getApiKey: () => 'secret-key',
  });

  assert.equal(env.N8N_HOST, 'https://override.example.com');
  assert.equal(env.N8N_API_KEY, 'override-key');
});

test('n8nac push candidate selection prefers the active workflow directory', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-n8nac-'));
  const previousYagrHome = process.env.YAGR_HOME;

  try {
    process.env.YAGR_HOME = tempDir;

    const workspaceDir = path.join(tempDir, 'n8n-workspace');
    const activePath = path.join(workspaceDir, 'workflows', 'local_5678_etienne_l', 'personal');
    const stalePath = path.join(workspaceDir, 'workflows', '127_0_0_1:5678_yagr_l', 'personal');
    fs.mkdirSync(activePath, { recursive: true });
    fs.mkdirSync(stalePath, { recursive: true });

    fs.writeFileSync(path.join(activePath, 'demo.workflow.ts'), '// active');
    fs.writeFileSync(path.join(stalePath, 'demo.workflow.ts'), '// stale');

    const candidate = pickPreferredWorkspaceWorkflowCandidate('demo.workflow.ts', {
      getLocalConfig: () => ({
        syncFolder: 'workflows',
        instanceIdentifier: 'local_5678_etienne_l',
        projectName: 'Personal',
      }),
    });

    assert.equal(candidate, path.join(activePath, 'demo.workflow.ts'));
  } finally {
    if (previousYagrHome === undefined) {
      delete process.env.YAGR_HOME;
    } else {
      process.env.YAGR_HOME = previousYagrHome;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
