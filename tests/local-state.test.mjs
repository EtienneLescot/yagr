import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resetYagrLocalState, buildYagrCleanupPlan } from '../dist/config/local-state.js';
import { YagrConfigService } from '../dist/config/yagr-config-service.js';
import { getYagrPaths } from '../dist/config/yagr-home.js';

async function withTempYagrEnv(run) {
  const previousHome = process.env.YAGR_HOME;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-local-state-'));
  const homeDir = path.join(tempRoot, 'home');
  fs.mkdirSync(homeDir, { recursive: true });
  process.env.YAGR_HOME = homeDir;

  try {
    await run({ homeDir });
  } finally {
    if (previousHome === undefined) {
      delete process.env.YAGR_HOME;
    } else {
      process.env.YAGR_HOME = previousHome;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

test('config service ignores legacy credential stores outside the Yagr home', async () => {
  await withTempYagrEnv(async () => {
    const legacyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-legacy-creds-'));
    const legacyYagrCredentialsPath = path.join(legacyRoot, 'yagr-nodejs', 'credentials.json');
    fs.mkdirSync(path.dirname(legacyYagrCredentialsPath), { recursive: true });
    fs.writeFileSync(
      legacyYagrCredentialsPath,
      JSON.stringify({ providers: { openai: 'openai-key' }, telegram: { botToken: '123:telegram' } }),
    );

    const yagrConfigService = new YagrConfigService();

    assert.equal(yagrConfigService.getApiKey('openai'), undefined);
    assert.equal(yagrConfigService.getTelegramBotToken(), undefined);
    fs.rmSync(legacyRoot, { recursive: true, force: true });
  });
});

test('buildYagrCleanupPlan has no external workspace preservation rules', async () => {
  await withTempYagrEnv(async () => {
    const plan = buildYagrCleanupPlan('full');

    assert.deepEqual(plan.workspacePaths, []);
    assert.deepEqual(plan.preservedWorkspacePaths, []);
    assert.deepEqual(plan.deletePaths, [getYagrPaths().homeDir]);
  });
});

test('resetYagrLocalState removes active config stores for config+creds scope', async () => {
  await withTempYagrEnv(async ({ homeDir }) => {
    const paths = getYagrPaths();
    fs.writeFileSync(paths.yagrConfigPath, JSON.stringify({ provider: 'openai' }));
    fs.writeFileSync(paths.yagrCredentialsPath, JSON.stringify({ providers: { openai: 'key' } }));

    await resetYagrLocalState('config+creds');

    assert.equal(fs.existsSync(paths.yagrConfigPath), false);
    assert.equal(fs.existsSync(paths.yagrCredentialsPath), false);
    assert.equal(fs.existsSync(homeDir), true);
  });
});

test('resetYagrLocalState preserves installed skills for config+creds scope', async () => {
  await withTempYagrEnv(async () => {
    const paths = getYagrPaths();
    const skillDir = path.join(paths.skillsDir, 'kept-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: kept-skill\ndescription: Kept skill.\n---\n');

    await resetYagrLocalState('config+creds');

    assert.equal(fs.existsSync(path.join(skillDir, 'SKILL.md')), true);
  });
});
