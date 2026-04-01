import assert from 'node:assert/strict';
import test from 'node:test';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createN8nAcTool, getN8nacProcessEnv, pickPreferredWorkspaceWorkflowCandidate } from '../dist/tools/n8nac.js';

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

test('n8nac tool schema accepts Yagr-specific helper actions', () => {
  const tool = createN8nAcTool();

  const providerOptions = tool.parameters.safeParse({
    action: 'llm_provider_options',
    nodeName: 'Agent 1',
  });
  const warningCheck = tool.parameters.safeParse({
    action: 'yagr_proxy_warning_check',
  });
  const warningAccept = tool.parameters.safeParse({
    action: 'yagr_proxy_warning_accept',
  });

  assert.equal(providerOptions.success, true);
  assert.equal(warningCheck.success, true);
  assert.equal(warningAccept.success, true);
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

test('n8nac command push preserves structured workflow metadata', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-n8nac-command-'));
  const fakeNpxPath = path.join(tempDir, 'npx');
  const previousPath = process.env.PATH;
  const previousHost = process.env.N8N_HOST;
  const previousApiKey = process.env.N8N_API_KEY;
  const previousAllow = process.env.YAGR_ALLOW_N8N_ENV;

  try {
    fs.writeFileSync(fakeNpxPath, [
      '#!/bin/sh',
      'echo "- Pushing workflow demo.workflow.ts..." 1>&2',
      'echo "✔ ✔ Pushed workflow demo.workflow.ts." 1>&2',
      'echo "- Fetching workflow wf-123 from n8n for verification..." 1>&2',
      'echo "✔ ✔ Fetched \"Demo Flow\" (2 nodes)" 1>&2',
      'echo ""',
      'echo "✅ Workflow looks clean — no issues found."',
      'exit 0',
    ].join('\n'));
    fs.chmodSync(fakeNpxPath, 0o755);

    process.env.PATH = `${tempDir}:${previousPath || ''}`;
    process.env.N8N_HOST = 'http://localhost:5678';
    process.env.N8N_API_KEY = 'test-key';
    process.env.YAGR_ALLOW_N8N_ENV = '1';

    const tool = createN8nAcTool();
    const result = await tool.execute({
      action: 'command',
      commandArgv: ['push', 'demo.workflow.ts', '--verify'],
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.pushTarget, 'demo.workflow.ts');
    assert.equal(result.workflowId, 'wf-123');
    assert.equal(result.workflowUrl, 'http://localhost:5678/workflow/wf-123');
    assert.equal(result.verified, true);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousHost === undefined) delete process.env.N8N_HOST;
    else process.env.N8N_HOST = previousHost;
    if (previousApiKey === undefined) delete process.env.N8N_API_KEY;
    else process.env.N8N_API_KEY = previousApiKey;
    if (previousAllow === undefined) delete process.env.YAGR_ALLOW_N8N_ENV;
    else process.env.YAGR_ALLOW_N8N_ENV = previousAllow;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('n8nac command push recovers workflow metadata from local sync state when CLI omits it', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-n8nac-state-'));
  const fakeNpxPath = path.join(tempDir, 'npx');
  const previousPath = process.env.PATH;
  const previousHome = process.env.YAGR_HOME;
  const previousHost = process.env.N8N_HOST;
  const previousApiKey = process.env.N8N_API_KEY;
  const previousAllow = process.env.YAGR_ALLOW_N8N_ENV;

  try {
    fs.writeFileSync(fakeNpxPath, [
      '#!/bin/sh',
      'echo "- Pushing workflow demo.workflow.ts..." 1>&2',
      'echo "✔ ✔ Pushed workflow demo.workflow.ts." 1>&2',
      'exit 0',
    ].join('\n'));
    fs.chmodSync(fakeNpxPath, 0o755);

    const workspaceDir = path.join(tempDir, 'n8n-workspace');
    const workflowDir = path.join(workspaceDir, 'workflows', 'local_5678_etienne_l', 'personal');
    fs.mkdirSync(workflowDir, { recursive: true });
    fs.writeFileSync(path.join(workspaceDir, 'n8nac-config.json'), JSON.stringify({
      host: 'http://localhost:5678',
      syncFolder: 'workflows',
      instanceIdentifier: 'local_5678_etienne_l',
      projectName: 'Personal',
    }, null, 2));
    fs.writeFileSync(path.join(workflowDir, '.n8n-state.json'), JSON.stringify({
      workflows: {
        'wf-999': {
          filename: 'demo.workflow.ts',
          lastSyncedHash: 'abc',
          lastSyncedAt: '2026-04-01T00:00:00.000Z',
        },
      },
    }, null, 2));
    fs.writeFileSync(path.join(workflowDir, 'demo.workflow.ts'), [
      "import { workflow } from '@n8n-as-code/transformer';",
      '',
      "@workflow({ name: 'Recovered Demo', active: false })",
      'export class RecoveredDemo {}',
      '',
    ].join('\n'));

    process.env.PATH = `${tempDir}:${previousPath || ''}`;
    process.env.YAGR_HOME = tempDir;
    process.env.N8N_HOST = 'http://localhost:5678';
    process.env.N8N_API_KEY = 'test-key';
    process.env.YAGR_ALLOW_N8N_ENV = '1';

    const tool = createN8nAcTool();
    const result = await tool.execute({
      action: 'command',
      commandArgv: ['push', 'demo.workflow.ts'],
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.workflowId, 'wf-999');
    assert.equal(result.workflowUrl, 'http://localhost:5678/workflow/wf-999');
    assert.equal(result.title, 'Recovered Demo');
    assert.equal(result.verified, false);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    if (previousHost === undefined) delete process.env.N8N_HOST;
    else process.env.N8N_HOST = previousHost;
    if (previousApiKey === undefined) delete process.env.N8N_API_KEY;
    else process.env.N8N_API_KEY = previousApiKey;
    if (previousAllow === undefined) delete process.env.YAGR_ALLOW_N8N_ENV;
    else process.env.YAGR_ALLOW_N8N_ENV = previousAllow;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('n8nac warning consent actions persist one-time yagr proxy acceptance', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-n8nac-warning-'));
  const previousYagrHome = process.env.YAGR_HOME;

  try {
    process.env.YAGR_HOME = tempDir;
    const tool = createN8nAcTool();

    const before = await tool.execute({ action: 'yagr_proxy_warning_check' });
    assert.equal(before.accepted, false);
    assert.equal(typeof before.warningMessage, 'string');
    assert.equal(before.warningVersion, 'yagr-proxy-v1');

    const accepted = await tool.execute({ action: 'yagr_proxy_warning_accept' });
    assert.equal(accepted.accepted, true);
    assert.equal(accepted.warningVersion, 'yagr-proxy-v1');

    const after = await tool.execute({ action: 'yagr_proxy_warning_check' });
    assert.equal(after.accepted, true);
    assert.equal(typeof after.acceptedAt, 'string');
  } finally {
    if (previousYagrHome === undefined) {
      delete process.env.YAGR_HOME;
    } else {
      process.env.YAGR_HOME = previousYagrHome;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
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

test('n8nac push candidate selection prefers the active workflow directory', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-n8nac-'));
  const previousYagrHome = process.env.YAGR_HOME;

  try {
    process.env.YAGR_HOME = tempDir;

    const workspaceDir = path.join(tempDir, 'n8n-workspace');
    const activePath = path.join(workspaceDir, 'workflows', 'local_5678_etienne_l', 'personal');
    const stalePath = path.join(workspaceDir, 'workflows', '127_0_0_1_5678_yagr_l', 'personal');
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
