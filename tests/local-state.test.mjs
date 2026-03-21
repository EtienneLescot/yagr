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
  const previousAppData = process.env.APPDATA;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-local-state-'));
  const homeDir = path.join(tempRoot, 'home');
  const xdgDir = path.join(tempRoot, 'xdg');
  const appDataDir = path.join(tempRoot, 'appdata');
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(xdgDir, { recursive: true });
  fs.mkdirSync(appDataDir, { recursive: true });
  process.env.YAGR_HOME = homeDir;
  process.env.XDG_CONFIG_HOME = xdgDir;
  process.env.APPDATA = appDataDir;

  try {
    await run({ homeDir, xdgDir, appDataDir });
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
    if (previousAppData === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = previousAppData;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

test('config services migrate legacy credential stores into the Yagr home', async () => {
  await withTempYagrEnv(async () => {
    const paths = getYagrPaths();
    fs.mkdirSync(paths.legacyYagrCredentialsDir, { recursive: true });
    fs.mkdirSync(paths.legacyN8nCredentialsDir, { recursive: true });
    fs.writeFileSync(
      paths.legacyYagrCredentialsPath,
      JSON.stringify({ providers: { openai: 'openai-key' }, telegram: { botToken: '123:telegram' } }),
    );
    fs.writeFileSync(
      paths.legacyN8nCredentialsPath,
      JSON.stringify({ hosts: { 'https://n8n.example.com': 'n8n-key' } }),
    );

    const yagrConfigService = new YagrConfigService();
    const n8nConfigService = new YagrN8nConfigService();

    assert.equal(yagrConfigService.getApiKey('openai'), 'openai-key');
    assert.equal(yagrConfigService.getTelegramBotToken(), '123:telegram');
    assert.equal(n8nConfigService.getApiKey('https://n8n.example.com'), 'n8n-key');
    assert.equal(fs.existsSync(paths.yagrCredentialsPath), true);
    assert.equal(fs.existsSync(paths.n8nCredentialsPath), true);
  });
});

test('YagrN8nConfigService mirrors saved api keys into the n8nac compatibility store', async () => {
  await withTempYagrEnv(async () => {
    const n8nConfigService = new YagrN8nConfigService();
    const legacyCredentialsPath = getYagrPaths().legacyN8nCredentialsPath;

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
  await withTempYagrEnv(async () => {
    const paths = getYagrPaths();
    const legacyCredentialsPath = paths.legacyN8nCredentialsPath;
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
  await withTempYagrEnv(async ({ homeDir }) => {
    const paths = getYagrPaths();
    fs.mkdirSync(paths.n8nWorkspaceDir, { recursive: true });
    fs.writeFileSync(paths.yagrConfigPath, JSON.stringify({ provider: 'openai' }));
    fs.writeFileSync(paths.yagrCredentialsPath, JSON.stringify({ providers: { openai: 'key' } }));
    fs.writeFileSync(paths.n8nConfigPath, JSON.stringify({ syncFolder: 'workflows' }));
    fs.writeFileSync(paths.n8nCredentialsPath, JSON.stringify({ hosts: { 'https://n8n.example.com': 'key' } }));
    fs.mkdirSync(paths.legacyYagrCredentialsDir, { recursive: true });
    fs.writeFileSync(paths.legacyYagrCredentialsPath, JSON.stringify({ providers: { openai: 'legacy' } }));

    await resetYagrLocalState('config+creds');

    assert.equal(fs.existsSync(paths.yagrConfigPath), false);
    assert.equal(fs.existsSync(paths.yagrCredentialsPath), false);
    assert.equal(fs.existsSync(paths.n8nConfigPath), false);
    assert.equal(fs.existsSync(paths.n8nCredentialsPath), false);
    assert.equal(fs.existsSync(paths.legacyYagrCredentialsDir), false);
    assert.equal(fs.existsSync(homeDir), true);
  });
});
