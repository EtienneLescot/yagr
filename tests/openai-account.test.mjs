import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createOpenAiAccountLanguageModel } from '../dist/llm/openai-account.js';

function makeJwtWithAccountId(accountId) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    'https://api.openai.com/auth': {
      chatgpt_account_id: accountId,
    },
  })).toString('base64url');
  return `${header}.${payload}.signature`;
}

function createSseResponse(events) {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

test('openai-proxy sends function tools and returns tool calls from Codex responses', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-openai-account-'));
  const authPath = path.join(tempDir, 'auth.json');
  const accessToken = makeJwtWithAccountId('acct_yagr_test');
  fs.writeFileSync(authPath, JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: {
      access_token: accessToken,
      refresh_token: 'refresh-token',
    },
  }));

  const previousAuthPath = process.env.YAGR_CODEX_AUTH_PATH;
  const previousFetch = globalThis.fetch;
  let seenBody;

  process.env.YAGR_CODEX_AUTH_PATH = authPath;
  globalThis.fetch = async (_url, init) => {
    seenBody = JSON.parse(String(init?.body || '{}'));
    return createSseResponse([
      {
        type: 'response.output_item.added',
        item: {
          type: 'function_call',
          call_id: 'call_123',
          name: 'n8nac',
          arguments: '',
        },
      },
      {
        type: 'response.function_call_arguments.delta',
        item_id: 'call_123',
        delta: '{"action":"setup_check"}',
      },
      {
        type: 'response.completed',
        response: {
          usage: {
            input_tokens: 11,
            output_tokens: 7,
          },
        },
      },
    ]);
  };

  try {
    const model = createOpenAiAccountLanguageModel('gpt-5.4');
    const result = await model.doGenerate({
      inputFormat: 'prompt',
      mode: {
        type: 'regular',
        tools: [{
          type: 'function',
          name: 'n8nac',
          description: 'Run n8nac.',
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string' },
            },
            required: ['action'],
            additionalProperties: false,
          },
        }],
        toolChoice: { type: 'auto' },
      },
      prompt: [{
        role: 'user',
        content: [{ type: 'text', text: 'Check workspace setup.' }],
      }],
    });

    assert.equal(seenBody.model, 'gpt-5.4');
    assert.equal(Array.isArray(seenBody.tools), true);
    assert.equal(seenBody.tools[0].type, 'function');
    assert.equal(seenBody.tools[0].name, 'n8nac');
    assert.deepEqual(seenBody.tools[0].parameters.required, ['action']);
    assert.equal(result.finishReason, 'tool-calls');
    assert.equal(Array.isArray(result.toolCalls), true);
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].toolName, 'n8nac');
    assert.equal(result.toolCalls[0].toolCallId, 'call_123');
    assert.equal(result.toolCalls[0].args, '{"action":"setup_check"}');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousAuthPath === undefined) {
      delete process.env.YAGR_CODEX_AUTH_PATH;
    } else {
      process.env.YAGR_CODEX_AUTH_PATH = previousAuthPath;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
