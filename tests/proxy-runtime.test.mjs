import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { prepareProviderRuntime } from '../dist/llm/proxy-runtime.js';

async function withMockedFetch(mockedFetch, run) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = mockedFetch;
  try {
    await run();
  } finally {
    globalThis.fetch = previousFetch;
  }
}

test('prepareProviderRuntime detects an already running proxy endpoint', async () => {
  await withMockedFetch(async (url) => {
    assert.equal(url, 'http://127.0.0.1:3456/v1/models');
    return new Response(JSON.stringify({
      data: [
        { id: 'gpt-5' },
        { id: 'gpt-5-mini' },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }, async () => {
    const baseUrl = 'http://127.0.0.1:3456/v1';
    const result = await prepareProviderRuntime('anthropic-proxy', { baseUrl });

    assert.equal(result.ready, true);
    assert.deepEqual(result.runtime?.models, ['gpt-5', 'gpt-5-mini']);
    assert.equal(result.runtime?.baseUrl, baseUrl);
    assert.equal(result.runtime?.autoStarted, false);
  });
});

test('prepareProviderRuntime resolves the local Codex ChatGPT session for openai-proxy', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-codex-auth-'));
  const authPath = path.join(tempDir, 'auth.json');
  fs.writeFileSync(authPath, JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: {
      access_token: 'test-access-token',
      refresh_token: 'test-refresh-token',
      account_id: 'acct_test',
    },
  }));

  const previousAuthPath = process.env.YAGR_CODEX_AUTH_PATH;
  const previousSkipValidation = process.env.YAGR_SKIP_CODEX_RUNTIME_VALIDATION;
  process.env.YAGR_CODEX_AUTH_PATH = authPath;
  process.env.YAGR_SKIP_CODEX_RUNTIME_VALIDATION = '1';

  try {
    const result = await prepareProviderRuntime('openai-proxy');

    assert.equal(result.ready, true);
    assert.equal(result.runtime?.baseUrl, 'https://chatgpt.com/backend-api');
    assert.equal(result.runtime?.apiKey, 'test-access-token');
    assert.deepEqual(result.runtime?.models, [
      'gpt-5.4',
      'gpt-5.3-codex',
      'gpt-5.3-codex-spark',
      'gpt-5.2',
      'gpt-5.2-codex',
      'gpt-5.1-codex',
      'gpt-5.1-codex-mini',
      'gpt-5.1-codex-max',
    ]);
  } finally {
    if (previousSkipValidation === undefined) {
      delete process.env.YAGR_SKIP_CODEX_RUNTIME_VALIDATION;
    } else {
      process.env.YAGR_SKIP_CODEX_RUNTIME_VALIDATION = previousSkipValidation;
    }
    if (previousAuthPath === undefined) {
      delete process.env.YAGR_CODEX_AUTH_PATH;
    } else {
      process.env.YAGR_CODEX_AUTH_PATH = previousAuthPath;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('prepareProviderRuntime resolves the local Gemini OAuth session for google-proxy', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-gemini-auth-'));
  const authPath = path.join(tempDir, 'oauth_creds.json');
  const settingsPath = path.join(tempDir, 'settings.json');
  fs.writeFileSync(authPath, JSON.stringify({
    access_token: 'gemini-access-token',
    refresh_token: 'gemini-refresh-token',
    expiry_date: Date.now() + 60_000,
    email: 'user@example.com',
  }));

  const previousAuthPath = process.env.YAGR_GEMINI_AUTH_PATH;
  const previousSettingsPath = process.env.YAGR_GEMINI_SETTINGS_PATH;
  const previousSkipValidation = process.env.YAGR_SKIP_GEMINI_RUNTIME_VALIDATION;
  process.env.YAGR_GEMINI_AUTH_PATH = authPath;
  process.env.YAGR_GEMINI_SETTINGS_PATH = settingsPath;
  process.env.YAGR_SKIP_GEMINI_RUNTIME_VALIDATION = '1';

  try {
    const result = await prepareProviderRuntime('google-proxy');

    assert.equal(result.ready, true);
    assert.deepEqual(result.runtime?.models, [
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.0-flash',
    ]);
    assert.ok(result.notes.some((note) => note.includes('Gemini CLI')));
    const writtenSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(writtenSettings.selectedAuthType, 'oauth-personal');
  } finally {
    if (previousSkipValidation === undefined) {
      delete process.env.YAGR_SKIP_GEMINI_RUNTIME_VALIDATION;
    } else {
      process.env.YAGR_SKIP_GEMINI_RUNTIME_VALIDATION = previousSkipValidation;
    }
    if (previousAuthPath === undefined) {
      delete process.env.YAGR_GEMINI_AUTH_PATH;
    } else {
      process.env.YAGR_GEMINI_AUTH_PATH = previousAuthPath;
    }
    if (previousSettingsPath === undefined) {
      delete process.env.YAGR_GEMINI_SETTINGS_PATH;
    } else {
      process.env.YAGR_GEMINI_SETTINGS_PATH = previousSettingsPath;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('prepareProviderRuntime resolves the local GitHub Copilot OAuth session for copilot-proxy', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-copilot-auth-'));
  const cachePath = path.join(tempDir, 'copilot-token.json');
  fs.writeFileSync(cachePath, JSON.stringify({
    token: 'copilot-token;proxy-ep=proxy.example.com;',
    expiresAt: Date.now() + 60 * 60 * 1000,
    updatedAt: Date.now(),
  }));

  const previousGhToken = process.env.GH_TOKEN;
  const previousCachePath = process.env.YAGR_COPILOT_TOKEN_CACHE_PATH;
  const previousSkipValidation = process.env.YAGR_SKIP_COPILOT_RUNTIME_VALIDATION;
  process.env.GH_TOKEN = 'github-access-token';
  process.env.YAGR_COPILOT_TOKEN_CACHE_PATH = cachePath;
  process.env.YAGR_SKIP_COPILOT_RUNTIME_VALIDATION = '1';

  try {
    const result = await prepareProviderRuntime('copilot-proxy');

    assert.equal(result.ready, true);
    assert.equal(result.runtime?.baseUrl, 'https://api.example.com');
    assert.deepEqual(result.runtime?.models, [
      'claude-sonnet-4.6',
      'claude-sonnet-4.5',
      'gpt-4o',
      'gpt-4.1',
      'gpt-4.1-mini',
      'gpt-4.1-nano',
      'o1',
      'o1-mini',
      'o3-mini',
    ]);
  } finally {
    if (previousSkipValidation === undefined) {
      delete process.env.YAGR_SKIP_COPILOT_RUNTIME_VALIDATION;
    } else {
      process.env.YAGR_SKIP_COPILOT_RUNTIME_VALIDATION = previousSkipValidation;
    }
    if (previousGhToken === undefined) {
      delete process.env.GH_TOKEN;
    } else {
      process.env.GH_TOKEN = previousGhToken;
    }
    if (previousCachePath === undefined) {
      delete process.env.YAGR_COPILOT_TOKEN_CACHE_PATH;
    } else {
      process.env.YAGR_COPILOT_TOKEN_CACHE_PATH = previousCachePath;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
