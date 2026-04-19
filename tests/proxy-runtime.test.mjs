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
    // Uses openrouter's fixed discovery URL (independent of baseUrl override).
    assert.equal(url, 'https://openrouter.ai/api/v1/models');
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
    const result = await prepareProviderRuntime('openrouter', { apiKey: 'test-key', baseUrl: 'https://openrouter.ai/api/v1' });

    assert.equal(result.ready, true);
    assert.deepEqual(result.runtime?.models, ['gpt-5', 'gpt-5-mini']);
    assert.equal(result.runtime?.baseUrl, 'https://openrouter.ai/api/v1');
    assert.equal(result.runtime?.autoStarted, false);
  });
});

test('prepareProviderRuntime keeps configured openai-compatible providers usable when model discovery fails', async () => {
  await withMockedFetch(async () => {
    throw new Error('transient discovery failure');
  }, async () => {
    const result = await prepareProviderRuntime('openrouter', { apiKey: 'test-key', baseUrl: 'https://openrouter.ai/api/v1' });

    assert.equal(result.ready, true);
    assert.equal(result.runtime?.baseUrl, 'https://openrouter.ai/api/v1');
    assert.equal(result.runtime?.apiKey, 'test-key');
    assert.deepEqual(result.runtime?.models, []);
    assert.match(
      result.notes.join('\n'),
      /Model discovery (failed|returned no models),/,
    );
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
      assert.equal(String(url), 'https://chatgpt.com/backend-api/codex/models?client_version=1.0.0');
      return new Response(JSON.stringify({
        models: [
          { slug: 'gpt-5.1-codex-mini', visibility: 'list', supported_in_api: true, priority: 2 },
          { slug: 'gpt-5.4', visibility: 'list', supported_in_api: true, priority: 1 },
          { slug: 'hidden-model', visibility: 'hidden', supported_in_api: true, priority: 3 },
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
      assert.deepEqual(result.runtime?.models, ['gpt-5.4', 'gpt-5.1-codex-mini']);
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

test('prepareProviderRuntime imports the GitHub CLI OAuth token for copilot-proxy when the Yagr session file is missing', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-copilot-gh-import-'));
  const sessionPath = path.join(tempDir, 'copilot-session.json');
  const cachePath = path.join(tempDir, 'copilot-token.json');
  const hostsPath = path.join(tempDir, 'hosts.yml');
  fs.writeFileSync(hostsPath, [
    'github.com:',
    '    user: test-user',
    '    oauth_token: gho_test_token_from_gh_cli',
    '    git_protocol: https',
    '',
  ].join('\n'));
  fs.writeFileSync(cachePath, JSON.stringify({
    token: 'copilot-token;proxy-ep=proxy.example.com;',
    expiresAt: Date.now() + 60 * 60 * 1000,
    updatedAt: Date.now(),
  }));

  const previousSessionPath = process.env.YAGR_COPILOT_SESSION_PATH;
  const previousCachePath = process.env.YAGR_COPILOT_TOKEN_CACHE_PATH;
  const previousHostsPath = process.env.YAGR_GH_HOSTS_PATH;
  const previousSkipValidation = process.env.YAGR_SKIP_COPILOT_RUNTIME_VALIDATION;
  process.env.YAGR_COPILOT_SESSION_PATH = sessionPath;
  process.env.YAGR_COPILOT_TOKEN_CACHE_PATH = cachePath;
  process.env.YAGR_GH_HOSTS_PATH = hostsPath;
  process.env.YAGR_SKIP_COPILOT_RUNTIME_VALIDATION = '1';

  try {
    await withMockedFetch(async (url) => {
      if (String(url) === 'https://api.example.com/models') {
        return new Response(JSON.stringify({
          data: [
            { id: 'gpt-4.1' },
            { id: 'o3-mini' },
          ],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch call: ${String(url)}`);
    }, async () => {
      const result = await prepareProviderRuntime('copilot-proxy');

      assert.equal(result.ready, true);
      assert.ok(fs.existsSync(sessionPath), 'The imported Yagr Copilot session should be persisted');
      const importedSession = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
      assert.equal(importedSession.githubToken, 'gho_test_token_from_gh_cli');
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
    if (previousHostsPath === undefined) {
      delete process.env.YAGR_GH_HOSTS_PATH;
    } else {
      process.env.YAGR_GH_HOSTS_PATH = previousHostsPath;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('prepareProviderRuntime resolves the local Anthropic credentials for anthropic-proxy', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-anthropic-auth-'));
  const claudeConfigPath = path.join(tempDir, 'config.json');
  fs.writeFileSync(claudeConfigPath, JSON.stringify({
    primaryApiKey: 'sk-ant-test-key',
  }));

  const previousClaudeConfigPath = process.env.YAGR_CLAUDE_CONFIG_PATH;
  const previousSkipValidation = process.env.YAGR_SKIP_ANTHROPIC_RUNTIME_VALIDATION;
  process.env.YAGR_CLAUDE_CONFIG_PATH = claudeConfigPath;
  process.env.YAGR_SKIP_ANTHROPIC_RUNTIME_VALIDATION = '1';

  try {
    await withMockedFetch(async (url) => {
      assert.equal(url, 'https://api.anthropic.com/v1/models');
      return new Response(JSON.stringify({
        data: [
          { id: 'claude-haiku-4-5' },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }, async () => {
      const result = await prepareProviderRuntime('anthropic-proxy');

      assert.equal(result.ready, true);
      assert.equal(result.runtime?.apiKey, 'sk-ant-test-key');
      assert.deepEqual(result.runtime?.models, ['claude-haiku-4-5']);
      assert.ok(result.notes.some((note) => note.includes('Claude Code CLI credentials')));
    });
  } finally {
    if (previousSkipValidation === undefined) {
      delete process.env.YAGR_SKIP_ANTHROPIC_RUNTIME_VALIDATION;
    } else {
      process.env.YAGR_SKIP_ANTHROPIC_RUNTIME_VALIDATION = previousSkipValidation;
    }
    if (previousClaudeConfigPath === undefined) {
      delete process.env.YAGR_CLAUDE_CONFIG_PATH;
    } else {
      process.env.YAGR_CLAUDE_CONFIG_PATH = previousClaudeConfigPath;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
