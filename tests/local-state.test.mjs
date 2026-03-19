import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resetYagrLocalState, buildYagrCleanupPlan } from '../dist/config/local-state.js';
import { YagrN8nConfigService } from '../dist/config/n8n-config-service.js';
import { YagrConfigService } from '../dist/config/yagr-config-service.js';
import { getYagrPaths } from '../dist/config/yagr-home.js';

async function withTempYagrEnv(run) {
  const previousHome = process.env.YAGR_HOME;
  const previousXdg = process.env.XDG_CONFIG_HOME;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-local-state-'));
  const homeDir = path.join(tempRoot, 'home');
  const xdgDir = path.join(tempRoot, 'xdg');
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(xdgDir, { recursive: true });
  process.env.YAGR_HOME = homeDir;
  process.env.XDG_CONFIG_HOME = xdgDir;

  try {
    await run({ homeDir, xdgDir });
  } finally {
    if (previousHome === undefined) {
      delete process.env.YAGR_HOME;
    } else {
      process.env.YAGR_HOME = previousHome;
    }
    if (previousXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = previousXdg;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

test('config services migrate legacy credential stores into the Yagr home', async () => {
  await withTempYagrEnv(async ({ xdgDir }) => {
    const legacyYagrDir = path.join(xdgDir, 'yagr-nodejs');
    const legacyN8nDir = path.join(xdgDir, 'n8nac-nodejs');
    fs.mkdirSync(legacyYagrDir, { recursive: true });
    fs.mkdirSync(legacyN8nDir, { recursive: true });
    fs.writeFileSync(
      path.join(legacyYagrDir, 'credentials.json'),
      JSON.stringify({ providers: { openai: 'openai-key' }, telegram: { botToken: '123:telegram' } }),
    );
    fs.writeFileSync(
      path.join(legacyN8nDir, 'credentials.json'),
      JSON.stringify({ hosts: { 'https://n8n.example.com': 'n8n-key' } }),
    );

    const yagrConfigService = new YagrConfigService();
    const n8nConfigService = new YagrN8nConfigService();
    const paths = getYagrPaths();

    assert.equal(yagrConfigService.getApiKey('openai'), 'openai-key');
    assert.equal(yagrConfigService.getTelegramBotToken(), '123:telegram');
    assert.equal(n8nConfigService.getApiKey('https://n8n.example.com'), 'n8n-key');
    assert.equal(fs.existsSync(paths.yagrCredentialsPath), true);
    assert.equal(fs.existsSync(paths.n8nCredentialsPath), true);
  });
});

test('YagrN8nConfigService mirrors saved api keys into the n8nac compatibility store', async () => {
  await withTempYagrEnv(async ({ xdgDir }) => {
    const n8nConfigService = new YagrN8nConfigService();
    const legacyCredentialsPath = path.join(xdgDir, 'n8nac-nodejs', 'credentials.json');

    n8nConfigService.saveApiKey('https://n8n.example.com', 'n8n-key');

    assert.equal(n8nConfigService.getApiKey('https://n8n.example.com'), 'n8n-key');
    assert.equal(fs.existsSync(legacyCredentialsPath), true);
    assert.equal(
      JSON.parse(fs.readFileSync(legacyCredentialsPath, 'utf-8')).hosts['https://n8n.example.com'],
      'n8n-key',
    );
  });
});

test('YagrN8nConfigService backfills the n8nac compatibility store from centralized credentials', async () => {
  await withTempYagrEnv(async ({ xdgDir }) => {
    const paths = getYagrPaths();
    const legacyCredentialsPath = path.join(xdgDir, 'n8nac-nodejs', 'credentials.json');
    fs.writeFileSync(paths.n8nCredentialsPath, JSON.stringify({ hosts: { 'https://n8n.example.com': 'n8n-key' } }));

    const n8nConfigService = new YagrN8nConfigService();

    assert.equal(n8nConfigService.getApiKey('https://n8n.example.com'), 'n8n-key');
    assert.equal(fs.existsSync(legacyCredentialsPath), true);
    assert.equal(
      JSON.parse(fs.readFileSync(legacyCredentialsPath, 'utf-8')).hosts['https://n8n.example.com'],
      'n8n-key',
    );
  });
});

test('buildYagrCleanupPlan preserves external workflow directories on full reset', async () => {
  await withTempYagrEnv(async () => {
    const externalWorkspace = path.join(os.tmpdir(), `yagr-external-${Date.now()}`);
    const n8nConfigService = new YagrN8nConfigService();
    n8nConfigService.saveLocalConfig({
      host: 'https://n8n.example.com',
      syncFolder: externalWorkspace,
      projectId: 'proj_1',
      projectName: 'Test',
    });

    const plan = buildYagrCleanupPlan('full');

    assert.deepEqual(plan.workspacePaths, []);
    assert.deepEqual(plan.preservedWorkspacePaths, [externalWorkspace]);
    assert.equal(plan.deletePaths.includes(externalWorkspace), false);
  });
});

test('resetYagrLocalState removes active and legacy config stores for config+creds scope', async () => {
  await withTempYagrEnv(async ({ xdgDir, homeDir }) => {
    const paths = getYagrPaths();
    fs.mkdirSync(paths.n8nWorkspaceDir, { recursive: true });
    fs.writeFileSync(paths.yagrConfigPath, JSON.stringify({ provider: 'openai' }));
    fs.writeFileSync(paths.yagrCredentialsPath, JSON.stringify({ providers: { openai: 'key' } }));
    fs.writeFileSync(paths.n8nConfigPath, JSON.stringify({ syncFolder: 'workflows' }));
    fs.writeFileSync(paths.n8nCredentialsPath, JSON.stringify({ hosts: { 'https://n8n.example.com': 'key' } }));
    fs.mkdirSync(path.join(xdgDir, 'yagr-nodejs'), { recursive: true });
    fs.writeFileSync(path.join(xdgDir, 'yagr-nodejs', 'credentials.json'), JSON.stringify({ providers: { openai: 'legacy' } }));

    await resetYagrLocalState('config+creds');

    assert.equal(fs.existsSync(paths.yagrConfigPath), false);
    assert.equal(fs.existsSync(paths.yagrCredentialsPath), false);
    assert.equal(fs.existsSync(paths.n8nConfigPath), false);
    assert.equal(fs.existsSync(paths.n8nCredentialsPath), false);
    assert.equal(fs.existsSync(path.join(xdgDir, 'yagr-nodejs')), false);
    assert.equal(fs.existsSync(homeDir), true);
  });
});