import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createGitHubCopilotLanguageModel } from '../dist/llm/copilot-account.js';
import { clearProviderMetadataCache } from '../dist/llm/provider-metadata.js';

async function withMockedFetch(mockedFetch, run) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = mockedFetch;
  try {
    await run();
  } finally {
    globalThis.fetch = previousFetch;
  }
}

test.afterEach(() => {
  clearProviderMetadataCache();
});

test('copilot-proxy routes gpt-5.1-codex-mini through /responses when metadata requires it', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-copilot-responses-'));
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
  process.env.YAGR_COPILOT_SESSION_PATH = sessionPath;
  process.env.YAGR_COPILOT_TOKEN_CACHE_PATH = cachePath;

  try {
    await withMockedFetch(async (url, init) => {
      const normalizedUrl = String(url);

      if (normalizedUrl === 'https://api.example.com/models') {
        return new Response(JSON.stringify({
          data: [
            {
              id: 'gpt-5.1-codex-mini',
              supported_endpoints: ['/responses'],
              capabilities: {
                supports: {
                  tool_calls: true,
                  parallel_tool_calls: true,
                  structured_outputs: true,
                },
                limits: {
                  max_context_window_tokens: 400_000,
                  max_output_tokens: 128_000,
                },
              },
            },
          ],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (normalizedUrl === 'https://api.example.com/responses') {
        const body = JSON.parse(String(init?.body));
        assert.equal(body.model, 'gpt-5.1-codex-mini');
        assert.equal(body.tool_choice, 'auto');
        assert.equal(body.tools[0].name, 'ping');
        return new Response(JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'function_call',
              call_id: 'call_ping',
              name: 'ping',
              arguments: '{"value":"ok"}',
            },
          ],
          usage: {
            input_tokens: 12,
            output_tokens: 5,
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      throw new Error(`Unexpected fetch: ${normalizedUrl}`);
    }, async () => {
      const model = createGitHubCopilotLanguageModel('gpt-5.1-codex-mini', {
        provider: 'copilot-proxy',
        model: 'gpt-5.1-codex-mini',
        toolCalling: 'compatible',
        supportsParallelToolCalls: false,
        supportsStructuredOutputs: false,
        supportsStreamingToolCalls: false,
        supportsForcedToolChoice: true,
        prefersStrictToolSchemas: false,
      });

      const result = await model.doGenerate({
        inputFormat: 'messages',
        mode: {
          type: 'regular',
          tools: [
            {
              type: 'function',
              name: 'ping',
              description: 'Ping tool',
              parameters: {
                type: 'object',
                properties: {
                  value: { type: 'string' },
                },
                required: ['value'],
                additionalProperties: false,
              },
            },
          ],
          toolChoice: { type: 'auto' },
        },
        prompt: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Call the ping tool with value ok.' }],
          },
        ],
      });

      assert.equal(result.finishReason, 'tool-calls');
      assert.equal(result.toolCalls?.[0]?.toolName, 'ping');
      assert.equal(result.toolCalls?.[0]?.args, '{"value":"ok"}');
    });
  } finally {
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

