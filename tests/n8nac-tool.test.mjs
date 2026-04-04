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

test('n8nac tool schema accepts credential and execution actions', () => {
  const tool = createN8nAcTool();

  const credentialList = tool.parameters.safeParse({
    action: 'credential_list',
  });
  const credentialCreate = tool.parameters.safeParse({
    action: 'credential_create',
    credentialType: 'openAiApi',
    credentialName: 'OpenAI Primary',
    credentialData: '{"apiKey":"sk-demo"}',
    outputJson: true,
  });
  const workflowCredentialRequired = tool.parameters.safeParse({
    action: 'workflow_credential_required',
    workflowId: 'wf_123',
  });
  const workflowActivate = tool.parameters.safeParse({
    action: 'workflow_activate',
    workflowId: 'wf_123',
  });
  const workflowDeactivate = tool.parameters.safeParse({
    action: 'workflow_deactivate',
    workflowId: 'wf_123',
  });
  const executionGet = tool.parameters.safeParse({
    action: 'execution_get',
    executionId: 'exec_123',
    includeData: true,
  });
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
  const testPlanAlias = tool.parameters.safeParse({
    action: 'test-plan',
    workflowId: 'wf_123',
    outputJson: true,
  });
  const testRun = tool.parameters.safeParse({
    action: 'test',
    workflowId: 'wf_123',
    testData: '{"chatInput":"Quelle est la capitale de la France?"}',
    testProd: false,
  });

  assert.equal(credentialList.success, true);
  assert.equal(credentialCreate.success, true);
  assert.equal(workflowCredentialRequired.success, true);
  assert.equal(workflowActivate.success, true);
  assert.equal(workflowDeactivate.success, true);
  assert.equal(executionGet.success, true);
  assert.equal(providerOptions.success, true);
  assert.equal(warningCheck.success, true);
  assert.equal(warningAccept.success, true);
  assert.equal(testPlanAlias.success, true);
  assert.equal(testRun.success, true);
});

test('n8nac tool schema coerces common stringified scalar values from weaker models', () => {
  const tool = createN8nAcTool();

  const parsed = tool.parameters.safeParse({
    action: 'list',
    projectIndex: '1',
    outputJson: 'true',
    includeData: 'false',
    executionLimit: '25',
  });

  assert.equal(parsed.success, true);
  if (!parsed.success) {
    return;
  }

  assert.equal(parsed.data.projectIndex, 1);
  assert.equal(parsed.data.outputJson, true);
  assert.equal(parsed.data.includeData, false);
  assert.equal(parsed.data.executionLimit, 25);
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
