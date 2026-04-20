import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AIMessage, HumanMessage } from '@langchain/core/messages';

import { createOpenAiAccountLanguageModel, getDefaultCodexReasoningEffort } from '../dist/llm/openai-account.js';
import { createLangChainModel } from '../dist/llm/create-langchain-model.js';
import { ChatCodexOAuth } from '../dist/llm/chat-codex-oauth.js';

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

test('openai-oauth defaults gpt-5.4 reasoning effort to none', () => {
  assert.equal(getDefaultCodexReasoningEffort('gpt-5.4'), 'none');
  assert.equal(getDefaultCodexReasoningEffort('gpt-5.4-mini'), 'none');
  assert.equal(getDefaultCodexReasoningEffort('gpt-5.3-codex'), 'medium');
});

test('openai-oauth sends function tools and returns tool calls from Codex responses', async () => {
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
    assert.notEqual(seenBody.tools[0].strict, false);
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

test('openai-oauth preserves all system instruction layers when translating prompts to Codex', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-openai-system-layers-'));
  const authPath = path.join(tempDir, 'auth.json');
  const accessToken = makeJwtWithAccountId('acct_yagr_system_layers');
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
        type: 'response.output_text.delta',
        delta: 'OK',
      },
      {
        type: 'response.completed',
        response: {
          usage: {
            input_tokens: 4,
            output_tokens: 1,
          },
        },
      },
    ]);
  };

  try {
    const model = createOpenAiAccountLanguageModel('gpt-5.4');
    const result = await model.doGenerate({
      inputFormat: 'prompt',
      mode: { type: 'regular' },
      prompt: [
        { role: 'system', content: 'Layer one instructions.' },
        { role: 'system', content: 'Layer two instructions.' },
        { role: 'user', content: [{ type: 'text', text: 'Reply with OK' }] },
      ],
    });

    assert.equal(result.text, 'OK');
    assert.match(seenBody.instructions, /^You are Codex, based on GPT-5\./);
    assert.match(seenBody.instructions, /Layer one instructions\./);
    assert.match(seenBody.instructions, /Layer two instructions\./);
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

test('openai-oauth LangChain model invokes the Codex runtime instead of ChatOpenAI backend compatibility mode', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-openai-langchain-'));
  const authPath = path.join(tempDir, 'auth.json');
  const accessToken = makeJwtWithAccountId('acct_yagr_langchain');
  fs.writeFileSync(authPath, JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: {
      access_token: accessToken,
      refresh_token: 'refresh-token',
    },
  }));

  const previousAuthPath = process.env.YAGR_CODEX_AUTH_PATH;
  const previousFetch = globalThis.fetch;
  let seenUrl;

  process.env.YAGR_CODEX_AUTH_PATH = authPath;
  globalThis.fetch = async (url) => {
    seenUrl = String(url);
    return createSseResponse([
      {
        type: 'response.output_text.delta',
        delta: 'OK',
      },
      {
        type: 'response.completed',
        response: {
          usage: {
            input_tokens: 3,
            output_tokens: 1,
          },
        },
      },
    ]);
  };

  try {
    const model = await createLangChainModel({ provider: 'openai-oauth', model: 'gpt-5.1-codex-mini' });
    const result = await model.invoke([new HumanMessage('Reply with exactly: OK')]);

    assert.equal(result.text, 'OK');
    assert.equal(seenUrl, 'https://chatgpt.com/backend-api/codex/responses');
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

test('openai-oauth LangChain model preserves bindTools tool choice and sends bound tools to Codex', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-openai-langchain-bind-'));
  const authPath = path.join(tempDir, 'auth.json');
  const accessToken = makeJwtWithAccountId('acct_yagr_langchain_bind');
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
          call_id: 'call_456',
          name: 'n8nac',
          arguments: '',
        },
      },
      {
        type: 'response.function_call_arguments.delta',
        item_id: 'call_456',
        delta: '{"action":"setup_check"}',
      },
      {
        type: 'response.completed',
        response: {
          usage: {
            input_tokens: 9,
            output_tokens: 4,
          },
        },
      },
    ]);
  };

  try {
    const model = await createLangChainModel({ provider: 'openai-oauth', model: 'gpt-5.1-codex-mini' });
    const boundModel = model.bindTools([
      {
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
      },
    ], { tool_choice: 'any' });

    const result = await boundModel.invoke([new HumanMessage('Check workspace setup.')]);

    assert.equal(seenBody.model, 'gpt-5.1-codex-mini');
    assert.equal(Array.isArray(seenBody.tools), true);
    assert.equal(seenBody.tools[0].name, 'n8nac');
    assert.equal(seenBody.tool_choice, 'required');
    assert.equal(result.tool_calls.length, 1);
    assert.equal(result.tool_calls[0].name, 'n8nac');
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

test('openai-oauth always sends include: ["reasoning.encrypted_content"] in request body', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-openai-include-'));
  const authPath = path.join(tempDir, 'auth.json');
  const accessToken = makeJwtWithAccountId('acct_yagr_include');
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
  let seenHeaders;

  process.env.YAGR_CODEX_AUTH_PATH = authPath;
  globalThis.fetch = async (_url, init) => {
    seenBody = JSON.parse(String(init?.body || '{}'));
    seenHeaders = init?.headers;
    return createSseResponse([
      { type: 'response.output_text.delta', delta: 'Hello' },
      {
        type: 'response.completed',
        response: { usage: { input_tokens: 3, output_tokens: 1 } },
      },
    ]);
  };

  try {
    const model = createOpenAiAccountLanguageModel('gpt-5.4');
    await model.doGenerate({
      inputFormat: 'prompt',
      mode: { type: 'regular' },
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Say hello' }] }],
    });

    assert.deepEqual(seenBody.include, ['reasoning.encrypted_content']);
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

test('openai-oauth sends originator: "codex_cli_rs" header matching LiteLLM default', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-openai-originator-'));
  const authPath = path.join(tempDir, 'auth.json');
  const accessToken = makeJwtWithAccountId('acct_yagr_originator');
  fs.writeFileSync(authPath, JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: {
      access_token: accessToken,
      refresh_token: 'refresh-token',
    },
  }));

  const previousAuthPath = process.env.YAGR_CODEX_AUTH_PATH;
  const previousFetch = globalThis.fetch;
  let seenHeaders;

  process.env.YAGR_CODEX_AUTH_PATH = authPath;
  globalThis.fetch = async (_url, init) => {
    seenHeaders = init?.headers;
    return createSseResponse([
      { type: 'response.output_text.delta', delta: 'Hi' },
      {
        type: 'response.completed',
        response: { usage: { input_tokens: 3, output_tokens: 1 } },
      },
    ]);
  };

  try {
    const model = createOpenAiAccountLanguageModel('gpt-5.4');
    await model.doGenerate({
      inputFormat: 'prompt',
      mode: { type: 'regular' },
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
    });

    assert.equal(seenHeaders?.['originator'], 'codex_cli_rs');
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

test('openai-oauth sends codex-style request identity headers and client_metadata', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-openai-codex-identity-'));
  const authPath = path.join(tempDir, 'auth.json');
  const accessToken = makeJwtWithAccountId('acct_yagr_identity');
  fs.writeFileSync(authPath, JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: {
      access_token: accessToken,
      refresh_token: 'refresh-token',
    },
  }));

  const previousAuthPath = process.env.YAGR_CODEX_AUTH_PATH;
  const previousHome = process.env.YAGR_HOME;
  const previousFetch = globalThis.fetch;
  let seenHeaders;
  let seenBody;

  process.env.YAGR_CODEX_AUTH_PATH = authPath;
  process.env.YAGR_HOME = tempDir;
  globalThis.fetch = async (_url, init) => {
    seenHeaders = init?.headers;
    seenBody = JSON.parse(String(init?.body || '{}'));
    return createSseResponse([
      { type: 'response.output_text.delta', delta: 'OK' },
      {
        type: 'response.completed',
        response: { usage: { input_tokens: 3, output_tokens: 1 } },
      },
    ]);
  };

  try {
    const model = createOpenAiAccountLanguageModel('gpt-5.4', 'low', 'session-ident-123');
    await model.doGenerate({
      inputFormat: 'prompt',
      mode: { type: 'regular' },
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Identity test' }] }],
    });

    const headers = new Headers(seenHeaders);
    assert.equal(headers.get('x-client-request-id'), 'session-ident-123');
    assert.equal(headers.get('x-codex-window-id'), 'session-ident-123:0');
    assert.ok(typeof headers.get('x-codex-installation-id') === 'string' && headers.get('x-codex-installation-id').length > 0);
    assert.equal(seenBody.client_metadata['x-codex-window-id'], 'session-ident-123:0');
    assert.equal(seenBody.client_metadata['x-codex-installation-id'], headers.get('x-codex-installation-id'));
  } finally {
    globalThis.fetch = previousFetch;
    if (previousAuthPath === undefined) delete process.env.YAGR_CODEX_AUTH_PATH;
    else process.env.YAGR_CODEX_AUTH_PATH = previousAuthPath;
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('openai-oauth prepends Codex base instructions before application system prompts', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-openai-instructions-'));
  const authPath = path.join(tempDir, 'auth.json');
  const accessToken = makeJwtWithAccountId('acct_yagr_instructions');
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
      { type: 'response.output_text.delta', delta: 'OK' },
      {
        type: 'response.completed',
        response: { usage: { input_tokens: 3, output_tokens: 1 } },
      },
    ]);
  };

  try {
    const model = createOpenAiAccountLanguageModel('gpt-5.4');
    await model.doGenerate({
      inputFormat: 'prompt',
      mode: { type: 'regular' },
      prompt: [
        { role: 'system', content: 'Use n8n workflow files and finish by presenting workflow output.' },
        { role: 'user', content: [{ type: 'text', text: 'Create the workflow.' }] },
      ],
    });

    assert.match(seenBody.instructions, /^You are Codex, based on GPT-5\./);
    assert.match(seenBody.instructions, /Use n8n workflow files and finish by presenting workflow output\./);
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

test('openai-oauth sends a stable session_id header across repeated calls on the same model instance', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-openai-session-'));
  const authPath = path.join(tempDir, 'auth.json');
  const accessToken = makeJwtWithAccountId('acct_yagr_session');
  fs.writeFileSync(authPath, JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: {
      access_token: accessToken,
      refresh_token: 'refresh-token',
    },
  }));

  const previousAuthPath = process.env.YAGR_CODEX_AUTH_PATH;
  const previousFetch = globalThis.fetch;
  const seenSessionIds = [];

  process.env.YAGR_CODEX_AUTH_PATH = authPath;
  globalThis.fetch = async (_url, init) => {
    seenSessionIds.push(init?.headers?.session_id);
    return createSseResponse([
      { type: 'response.output_text.delta', delta: 'OK' },
      {
        type: 'response.completed',
        response: { usage: { input_tokens: 3, output_tokens: 1 } },
      },
    ]);
  };

  try {
    const model = createOpenAiAccountLanguageModel('gpt-5.4', 'medium', 'session-fixed-123');
    await model.doGenerate({
      inputFormat: 'prompt',
      mode: { type: 'regular' },
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'First call' }] }],
    });
    await model.doGenerate({
      inputFormat: 'prompt',
      mode: { type: 'regular' },
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Second call' }] }],
    });

    assert.deepEqual(seenSessionIds, ['session-fixed-123', 'session-fixed-123']);
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

test('openai-oauth LangChain model reuses previous_response_id on incremental follow-up calls', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-openai-previous-response-'));
  const authPath = path.join(tempDir, 'auth.json');
  const accessToken = makeJwtWithAccountId('acct_yagr_previous_response');
  fs.writeFileSync(authPath, JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: {
      access_token: accessToken,
      refresh_token: 'refresh-token',
    },
  }));

  const previousAuthPath = process.env.YAGR_CODEX_AUTH_PATH;
  const previousFetch = globalThis.fetch;
  const seenBodies = [];
  let callCount = 0;

  process.env.YAGR_CODEX_AUTH_PATH = authPath;
  globalThis.fetch = async (_url, init) => {
    seenBodies.push(JSON.parse(String(init?.body || '{}')));
    callCount += 1;
    return createSseResponse([
      { type: 'response.output_text.delta', delta: callCount === 1 ? 'First' : 'Second' },
      {
        type: 'response.completed',
        response: {
          id: callCount === 1 ? 'resp_1' : 'resp_2',
          usage: { input_tokens: 3, output_tokens: 1 },
        },
      },
    ]);
  };

  try {
    const model = new ChatCodexOAuth({ model: 'gpt-5.4', sessionId: 'session-langchain-prev-id' });
    await model._generate([new HumanMessage('First turn')], {});
    await model._generate([new HumanMessage('First turn'), new HumanMessage('Second turn')], {});

    assert.equal(seenBodies[0].previous_response_id, undefined);
    assert.equal(seenBodies[1].previous_response_id, 'resp_1');
    assert.equal(seenBodies[1].input.length, 1);
    assert.equal(seenBodies[1].input[0].content[0].text, 'Second turn');
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

test('openai-oauth low-level generate extracts assistant phase from responses events', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-openai-phase-'));
  const authPath = path.join(tempDir, 'auth.json');
  const accessToken = makeJwtWithAccountId('acct_yagr_phase');
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
        type: 'response.output_item.done',
        output_index: 0,
        item: {
          type: 'message',
          role: 'assistant',
          phase: 'final',
          content: [{ type: 'output_text', text: 'First' }],
        },
      },
      {
        type: 'response.completed',
        response: {
          id: 'resp_phase_1',
          usage: { input_tokens: 3, output_tokens: 1 },
        },
      },
    ]);
  };

  try {
    const model = createOpenAiAccountLanguageModel('gpt-5.4', 'none', 'session-phase');
    const first = await model.doGenerate({
      inputFormat: 'prompt',
      mode: { type: 'regular' },
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'First turn' }] }],
    });
    assert.equal(first.response?.assistantPhase, 'final');
    assert.equal(seenBody.input[0].role, 'user');
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

test('openai-oauth re-emits assistant phase on incremental follow-up turns', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-openai-phase-followup-'));
  const authPath = path.join(tempDir, 'auth.json');
  const accessToken = makeJwtWithAccountId('acct_yagr_phase_followup');
  fs.writeFileSync(authPath, JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: {
      access_token: accessToken,
      refresh_token: 'refresh-token',
    },
  }));

  const previousAuthPath = process.env.YAGR_CODEX_AUTH_PATH;
  const previousFetch = globalThis.fetch;
  const seenBodies = [];
  let callCount = 0;

  process.env.YAGR_CODEX_AUTH_PATH = authPath;
  globalThis.fetch = async (_url, init) => {
    seenBodies.push(JSON.parse(String(init?.body || '{}')));
    callCount += 1;
    return createSseResponse([
      {
        type: 'response.completed',
        response: {
          id: callCount === 1 ? 'resp_phase_1' : 'resp_phase_2',
          usage: { input_tokens: 3, output_tokens: 1 },
        },
      },
    ]);
  };

  try {
    const model = new ChatCodexOAuth({ model: 'gpt-5.4', sessionId: 'session-phase' });
    await model._generate([new HumanMessage('First turn')], {});
    const assistant = new AIMessage({
      content: 'First',
      additional_kwargs: { phase: 'final' },
    });

    await model._generate([
      new HumanMessage('First turn'),
      assistant,
      new HumanMessage('Second turn'),
    ], {});

    assert.equal(seenBodies[1].previous_response_id, 'resp_phase_1');
    assert.equal(seenBodies[1].input[0].phase, 'final');
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

test('openai-oauth builds User-Agent with terminal information', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-openai-ua-'));
  const authPath = path.join(tempDir, 'auth.json');
  const accessToken = makeJwtWithAccountId('acct_yagr_ua');
  fs.writeFileSync(authPath, JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: {
      access_token: accessToken,
      refresh_token: 'refresh-token',
    },
  }));

  const previousAuthPath = process.env.YAGR_CODEX_AUTH_PATH;
  const previousFetch = globalThis.fetch;
  let seenHeaders;

  process.env.YAGR_CODEX_AUTH_PATH = authPath;
  globalThis.fetch = async (_url, init) => {
    seenHeaders = init?.headers;
    return createSseResponse([
      { type: 'response.output_text.delta', delta: 'OK' },
      {
        type: 'response.completed',
        response: { usage: { input_tokens: 3, output_tokens: 1 } },
      },
    ]);
  };

  try {
    const model = createOpenAiAccountLanguageModel('gpt-5.4');
    await model.doGenerate({
      inputFormat: 'prompt',
      mode: { type: 'regular' },
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }],
    });

    const ua = seenHeaders?.['User-Agent'];
    assert.ok(typeof ua === 'string' && ua.length > 0, `User-Agent should be non-empty, got: ${ua}`);
    assert.ok(ua.startsWith('codex_cli_rs/'), `User-Agent should start with "codex_cli_rs/", got: ${ua}`);
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

test('openai-oauth LangChain model preserves optional tool properties as optional in Codex schema', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-openai-langchain-optional-'));
  const authPath = path.join(tempDir, 'auth.json');
  const accessToken = makeJwtWithAccountId('acct_yagr_langchain_optional');
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
          call_id: 'call_789',
          name: 'glob',
          arguments: '',
        },
      },
      {
        type: 'response.function_call_arguments.delta',
        item_id: 'call_789',
        delta: '{"pattern":"workflows/**/*.workflow.ts"}',
      },
      {
        type: 'response.completed',
        response: {
          usage: {
            input_tokens: 12,
            output_tokens: 5,
          },
        },
      },
    ]);
  };

  try {
    const model = await createLangChainModel({ provider: 'openai-oauth', model: 'gpt-5.1-codex-mini' });
    const boundModel = model.bindTools([
      {
        name: 'glob',
        description: 'Search files by glob pattern.',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string' },
            path: { type: 'string' },
          },
          required: ['pattern'],
          additionalProperties: false,
        },
      },
    ], { tool_choice: 'any' });

    const result = await boundModel.invoke([new HumanMessage('Find workflow files.')]);

    assert.equal(seenBody.tools[0].name, 'glob');
    assert.equal(seenBody.tools[0].strict, true);
    assert.deepEqual(seenBody.tools[0].parameters.required, ['pattern', 'path']);
    assert.deepEqual(seenBody.tools[0].parameters.properties.path.type, ['string', 'null']);
    assert.equal(result.tool_calls.length, 1);
    assert.equal(result.tool_calls[0].name, 'glob');
    assert.deepEqual(result.tool_calls[0].args, { pattern: 'workflows/**/*.workflow.ts' });
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
