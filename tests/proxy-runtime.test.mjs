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
    await withMockedFetch(async (url) => {
      assert.equal(url, 'https://chatgpt.com/backend-api/models');
      return new Response(JSON.stringify({
        data: [
          { id: 'gpt-5.4' },
          { id: 'gpt-5.2' },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }, async () => {
      const result = await prepareProviderRuntime('openai-proxy');

      assert.equal(result.ready, true);
      assert.equal(result.runtime?.baseUrl, 'https://chatgpt.com/backend-api');
      assert.equal(result.runtime?.apiKey, 'test-access-token');
      assert.deepEqual(result.runtime?.models, ['gpt-5.2', 'gpt-5.4']);
    });
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
  const sessionPath = path.join(tempDir, 'gemini-session.json');
  const authPath = path.join(tempDir, 'oauth_creds.json');
  const settingsPath = path.join(tempDir, 'settings.json');
  fs.writeFileSync(sessionPath, JSON.stringify({
    provider: 'google-proxy',
    accessToken: 'gemini-access-token',
    refreshToken: 'gemini-refresh-token',
    expiresAt: Date.now() + 60 * 60 * 1000,
    email: 'user@example.com',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));

  const previousSessionPath = process.env.YAGR_GEMINI_SESSION_PATH;
  const previousAuthPath = process.env.YAGR_GEMINI_AUTH_PATH;
  const previousSettingsPath = process.env.YAGR_GEMINI_SETTINGS_PATH;
  const previousSkipValidation = process.env.YAGR_SKIP_GEMINI_RUNTIME_VALIDATION;
  process.env.YAGR_GEMINI_SESSION_PATH = sessionPath;
  process.env.YAGR_GEMINI_AUTH_PATH = authPath;
  process.env.YAGR_GEMINI_SETTINGS_PATH = settingsPath;
  process.env.YAGR_SKIP_GEMINI_RUNTIME_VALIDATION = '1';

  try {
    await withMockedFetch(async (url) => {
      assert.match(String(url), /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models/);
      return new Response(JSON.stringify({
        models: [
          { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }, async () => {
      const result = await prepareProviderRuntime('google-proxy');

      assert.equal(result.ready, true);
      assert.deepEqual(result.runtime?.models, ['gemini-2.5-flash', 'gemini-2.5-pro']);
      assert.ok(result.notes.some((note) => note.includes('Yagr-managed Gemini OAuth')));
      const writtenAuth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
      assert.equal(writtenAuth.access_token, 'gemini-access-token');
      const writtenSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      assert.equal(writtenSettings.selectedAuthType, 'oauth-personal');
    });
  } finally {
    if (previousSkipValidation === undefined) {
      delete process.env.YAGR_SKIP_GEMINI_RUNTIME_VALIDATION;
    } else {
      process.env.YAGR_SKIP_GEMINI_RUNTIME_VALIDATION = previousSkipValidation;
    }
    if (previousSessionPath === undefined) {
      delete process.env.YAGR_GEMINI_SESSION_PATH;
    } else {
      process.env.YAGR_GEMINI_SESSION_PATH = previousSessionPath;
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
  const sessionPath = path.join(tempDir, 'copilot-session.json');
  const cachePath = path.join(tempDir, 'copilot-token.json');
  fs.writeFileSync(sessionPath, JSON.stringify({
    provider: 'copilot-proxy',
    githubToken: 'github-access-token',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
  fs.writeFileSync(cachePath, JSON.stringify({
    token: 'copilot-token;proxy-ep=proxy.example.com;',
    expiresAt: Date.now() + 60 * 60 * 1000,
    updatedAt: Date.now(),
  }));

  const previousSessionPath = process.env.YAGR_COPILOT_SESSION_PATH;
  const previousCachePath = process.env.YAGR_COPILOT_TOKEN_CACHE_PATH;
  const previousSkipValidation = process.env.YAGR_SKIP_COPILOT_RUNTIME_VALIDATION;
  process.env.YAGR_COPILOT_SESSION_PATH = sessionPath;
  process.env.YAGR_COPILOT_TOKEN_CACHE_PATH = cachePath;
  process.env.YAGR_SKIP_COPILOT_RUNTIME_VALIDATION = '1';

  try {
    await withMockedFetch(async (url) => {
      if (String(url) === 'https://api.github.com/copilot_internal/v2/token') {
        return new Response(JSON.stringify({
          token: 'copilot-token;proxy-ep=proxy.example.com;',
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      assert.equal(String(url), 'https://api.example.com/models');
      return new Response(JSON.stringify({
        data: [
          { id: 'gpt-4.1' },
          { id: 'o3-mini' },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }, async () => {
      const result = await prepareProviderRuntime('copilot-proxy');

      assert.equal(result.ready, true);
      assert.equal(result.runtime?.baseUrl, 'https://api.example.com');
      assert.deepEqual(result.runtime?.models, ['gpt-4.1', 'o3-mini']);
    });
  } finally {
    if (previousSkipValidation === undefined) {
      delete process.env.YAGR_SKIP_COPILOT_RUNTIME_VALIDATION;
    } else {
      process.env.YAGR_SKIP_COPILOT_RUNTIME_VALIDATION = previousSkipValidation;
    }
    if (previousSessionPath === undefined) {
      delete process.env.YAGR_COPILOT_SESSION_PATH;
    } else {
      process.env.YAGR_COPILOT_SESSION_PATH = previousSessionPath;
    }
    if (previousCachePath === undefined) {
      delete process.env.YAGR_COPILOT_TOKEN_CACHE_PATH;
    } else {
      process.env.YAGR_COPILOT_TOKEN_CACHE_PATH = previousCachePath;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
