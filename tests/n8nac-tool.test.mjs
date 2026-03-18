import assert from 'node:assert/strict';
import test from 'node:test';

import { createN8nAcTool, getN8nacProcessEnv } from '../dist/tools/n8nac.js';

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