import assert from 'node:assert/strict';
import test from 'node:test';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createN8nAcTool, getN8nacProcessEnv } from '../dist/tools/n8nac.js';

test('n8nac tool schema accepts generic command passthrough', () => {
  const tool = createN8nAcTool();

  const withArgv = tool.parameters.safeParse({
    action: 'command',
    commandArgv: ['workflow', 'credential-required', 'wf_123', '--json'],
  });
  const withArgs = tool.parameters.safeParse({
    action: 'command',
    commandArgs: 'workflow credential-required wf_123 --json',
  });

  assert.equal(withArgv.success, true);
  assert.equal(withArgs.success, true);
});

test('n8nac tool schema accepts yagr_proxy_relay_start action', () => {
  const tool = createN8nAcTool();

  const relayStart = tool.parameters.safeParse({
    action: 'yagr_proxy_relay_start',
  });

  assert.equal(relayStart.success, true);
});

test('n8nac tool schema no longer accepts legacy specialized action names', () => {
  const tool = createN8nAcTool();

  const specialized = tool.parameters.safeParse({ action: 'credential_list' });
  const alias = tool.parameters.safeParse({ action: 'skillsArgs', skillsArgs: 'search telegram' });
  const hyphenTestPlan = tool.parameters.safeParse({ action: 'test-plan', workflowId: 'wf_123' });

  assert.equal(specialized.success, false);
  assert.equal(alias.success, false);
  assert.equal(hyphenTestPlan.success, false);
});

test('n8nac tool schema coerces common stringified scalar values from weaker models', () => {
  const tool = createN8nAcTool();

  const parsed = tool.parameters.safeParse({
    action: 'command',
    commandArgv: ['execution', 'list', '--limit', '25'],
  });

  assert.equal(parsed.success, true);
  if (!parsed.success) {
    return;
  }

  assert.deepEqual(parsed.data.commandArgv, ['execution', 'list', '--limit', '25']);
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

test('n8nac tool does not read process env n8n credentials unless explicitly allowed', () => {
  const previousHost = process.env.N8N_HOST;
  const previousApiKey = process.env.N8N_API_KEY;
  const previousAllow = process.env.YAGR_ALLOW_N8N_ENV;

  try {
    process.env.N8N_HOST = 'https://env-only.example.com';
    process.env.N8N_API_KEY = 'env-only-key';
    delete process.env.YAGR_ALLOW_N8N_ENV;

    const env = getN8nacProcessEnv({}, {
      getLocalConfig: () => ({}),
      getApiKey: () => undefined,
    });

    assert.equal(env.N8N_HOST, undefined);
    assert.equal(env.N8N_API_KEY, undefined);
  } finally {
    if (previousHost === undefined) delete process.env.N8N_HOST;
    else process.env.N8N_HOST = previousHost;
    if (previousApiKey === undefined) delete process.env.N8N_API_KEY;
    else process.env.N8N_API_KEY = previousApiKey;
    if (previousAllow === undefined) delete process.env.YAGR_ALLOW_N8N_ENV;
    else process.env.YAGR_ALLOW_N8N_ENV = previousAllow;
  }
});

test('n8nac tool can read process env n8n credentials when automated tests opt in', () => {
  const previousHost = process.env.N8N_HOST;
  const previousApiKey = process.env.N8N_API_KEY;
  const previousAllow = process.env.YAGR_ALLOW_N8N_ENV;

  try {
    process.env.N8N_HOST = 'https://env-only.example.com';
    process.env.N8N_API_KEY = 'env-only-key';
    process.env.YAGR_ALLOW_N8N_ENV = '1';

    const env = getN8nacProcessEnv({}, {
      getLocalConfig: () => ({}),
      getApiKey: () => undefined,
    });

    assert.equal(env.N8N_HOST, 'https://env-only.example.com');
    assert.equal(env.N8N_API_KEY, 'env-only-key');
  } finally {
    if (previousHost === undefined) delete process.env.N8N_HOST;
    else process.env.N8N_HOST = previousHost;
    if (previousApiKey === undefined) delete process.env.N8N_API_KEY;
    else process.env.N8N_API_KEY = previousApiKey;
    if (previousAllow === undefined) delete process.env.YAGR_ALLOW_N8N_ENV;
    else process.env.YAGR_ALLOW_N8N_ENV = previousAllow;
  }
});
