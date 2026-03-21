import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { prepareProviderRuntime } from '../dist/llm/proxy-runtime.js';

async function withModelServer(run) {
  const server = http.createServer((request, response) => {
    if (request.url === '/v1/models') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        data: [
          { id: 'gpt-5' },
          { id: 'gpt-5-mini' },
        ],
      }));
      return;
    }

    response.writeHead(404);
    response.end();
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  try {
    await run(`http://127.0.0.1:${port}/v1`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('prepareProviderRuntime detects an already running proxy endpoint', async () => {
  await withModelServer(async (baseUrl) => {
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
  process.env.YAGR_CODEX_AUTH_PATH = authPath;

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
    if (previousAuthPath === undefined) {
      delete process.env.YAGR_CODEX_AUTH_PATH;
    } else {
      process.env.YAGR_CODEX_AUTH_PATH = previousAuthPath;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
