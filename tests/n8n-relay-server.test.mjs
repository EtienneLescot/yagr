import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  translateResponsesRequestToChatCompletionsBody,
  buildRelayInfo,
  resolveDockerHostAddress,
  ensureN8nRelayServerInProcess,
  closeN8nRelayServerInProcessForTests,
} from '../dist/llm/llm-relay-server.js';
import { YagrConfigService } from '../dist/config/yagr-config-service.js';

function withTempHome(run) {
  const previousHome = process.env.YAGR_HOME;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-relay-info-'));
  process.env.YAGR_HOME = tempHome;
  try {
    return run(tempHome);
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
}

async function withTempHomeAsync(run) {
  const previousHome = process.env.YAGR_HOME;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-relay-info-'));
  process.env.YAGR_HOME = tempHome;
  try {
    return await run(tempHome);
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
}

async function occupyLoopbackPort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (error) => {
      if (error?.code === 'EADDRINUSE') {
        resolve(undefined);
        return;
      }
      reject(error);
    });
    server.once('listening', () => resolve(server));
    server.listen({ host: '127.0.0.1', port, exclusive: true });
  });
}

test('translateResponsesRequestToChatCompletionsBody converts responses input to chat messages', () => {
  const body = Buffer.from(JSON.stringify({
    model: 'gpt-4o-mini',
    instructions: 'You are helpful.',
    input: [
      { role: 'user', content: [{ type: 'input_text', text: 'Capital of France?' }] },
    ],
    stream: false,
  }), 'utf-8');

  const translated = JSON.parse(translateResponsesRequestToChatCompletionsBody(body).toString('utf-8'));

  assert.equal(translated.model, 'gpt-4o-mini');
  assert.equal(translated.stream, false);
  assert.deepEqual(translated.messages, [
    { role: 'system', content: 'You are helpful.' },
    { role: 'user', content: 'Capital of France?' },
  ]);
});

test('translateResponsesRequestToChatCompletionsBody maps response tools to chat tools', () => {
  const body = Buffer.from(JSON.stringify({
    model: 'gpt-4o-mini',
    input: [],
    tools: [{
      type: 'function',
      name: 'lookup_capital',
      description: 'Look up a capital city',
      parameters: { type: 'object', properties: { country: { type: 'string' } } },
      strict: true,
    }],
  }), 'utf-8');

  const translated = JSON.parse(translateResponsesRequestToChatCompletionsBody(body).toString('utf-8'));

  assert.deepEqual(translated.tools, [{
    type: 'function',
    function: {
      name: 'lookup_capital',
      description: 'Look up a capital city',
      parameters: { type: 'object', properties: { country: { type: 'string' } } },
      strict: true,
    },
  }]);
});

test('buildRelayInfo returns baseUrl from llmTunnelUrl when mode is tunnel', () => {
  withTempHome((tempHome) => {
    const configService = new YagrConfigService();
    configService.updateLocalConfig((cfg) => ({
      ...cfg,
      llmProxy: {
        enabled: true,
        mode: 'tunnel',
        credentialBaseUrl: 'https://my-llm-tunnel.example.com/v1',
        llmTunnelUrl: 'https://my-llm-tunnel.example.com',
      },
    }));
    const relayPort = 11437;
    const result = buildRelayInfo(relayPort);
    assert.equal(result.port, relayPort);
    assert.equal(result.baseUrl, 'https://my-llm-tunnel.example.com/v1');
    assert.equal(result.hostBaseUrl, `http://127.0.0.1:${relayPort}/v1`);
    assert.equal(result.apiKey, 'yagr-relay-key');
  });
});

test('buildRelayInfo falls back to hostBaseUrl when mode is tunnel but llmTunnelUrl is missing', () => {
  withTempHome(() => {
    const configService = new YagrConfigService();
    configService.updateLocalConfig((cfg) => ({
      ...cfg,
      llmProxy: {
        enabled: true,
        mode: 'tunnel',
        credentialBaseUrl: 'https://my-llm-tunnel.example.com/v1',
        // no llmTunnelUrl
      },
    }));
    const relayPort = 11437;
    const result = buildRelayInfo(relayPort);
    assert.equal(result.baseUrl, `http://127.0.0.1:${relayPort}/v1`);
  });
});

test('buildRelayInfo uses dockerHostAddress when mode is docker', () => {
  withTempHome(() => {
    const configService = new YagrConfigService();
    configService.updateLocalConfig((cfg) => ({
      ...cfg,
      llmProxy: {
        enabled: true,
        mode: 'docker',
        credentialBaseUrl: 'http://host.docker.internal:11437/v1',
        dockerHostAddress: 'host.docker.internal',
      },
    }));
    const relayPort = 11437;
    const result = buildRelayInfo(relayPort);
    assert.equal(result.baseUrl, `http://host.docker.internal:${relayPort}/v1`);
    assert.equal(result.hostBaseUrl, `http://127.0.0.1:${relayPort}/v1`);
  });
});

test('buildRelayInfo rewrites stale docker bridge host to host.docker.internal on native Windows', () => {
  withTempHome(() => {
    const configService = new YagrConfigService();
    configService.updateLocalConfig((cfg) => ({
      ...cfg,
      llmProxy: {
        enabled: true,
        mode: 'docker',
        credentialBaseUrl: 'http://172.17.0.1:11437/v1',
        dockerHostAddress: '172.17.0.1',
      },
    }));
    const relayPort = 11437;
    const result = buildRelayInfo(relayPort, 'win32');
    assert.equal(result.baseUrl, `http://host.docker.internal:${relayPort}/v1`);
    assert.equal(result.hostBaseUrl, `http://127.0.0.1:${relayPort}/v1`);
  });
});

test('buildRelayInfo returns hostBaseUrl when mode is local', () => {
  withTempHome(() => {
    const configService = new YagrConfigService();
    configService.updateLocalConfig((cfg) => ({
      ...cfg,
      llmProxy: {
        enabled: true,
        mode: 'local',
        credentialBaseUrl: `http://127.0.0.1:${11437}/v1`,
      },
    }));
    const relayPort = 11437;
    const result = buildRelayInfo(relayPort);
    assert.equal(result.baseUrl, `http://127.0.0.1:${relayPort}/v1`);
  });
});

test('buildRelayInfo ignores tunnelUrl field (no legacy fallback)', () => {
  withTempHome(() => {
    const configService = new YagrConfigService();
    configService.updateLocalConfig((cfg) => ({
      ...cfg,
      llmProxy: {
        enabled: true,
        mode: 'tunnel',
        credentialBaseUrl: 'https://old-tunnel.example.com/v1',
        // @ts-ignore — injecting legacy field to verify it is NOT read
        tunnelUrl: 'https://should-be-ignored.example.com',
      },
    }));
    const relayPort = 11437;
    const result = buildRelayInfo(relayPort);
    // tunnelUrl should be ignored; since llmTunnelUrl is absent, falls back to local
    assert.equal(result.baseUrl, `http://127.0.0.1:${relayPort}/v1`);
  });
});

test('relay skips default port when Windows loopback is already occupied', async () => {
  const loopbackBlocker = await occupyLoopbackPort(11437);
  try {
    await withTempHomeAsync(async () => {
      const relay = await ensureN8nRelayServerInProcess();
      assert.notEqual(relay.port, 11437);
      assert.equal(relay.hostBaseUrl, `http://127.0.0.1:${relay.port}/v1`);
    });
  } finally {
    closeN8nRelayServerInProcessForTests();
    await new Promise((resolve) => loopbackBlocker?.close(resolve) ?? resolve());
  }
});

test('resolveDockerHostAddress prefers host.docker.internal on native Windows', async () => {
  const previous = process.env.YAGR_LLM_RELAY_HOST;
  delete process.env.YAGR_LLM_RELAY_HOST;
  try {
    const host = await resolveDockerHostAddress('win32');
    assert.equal(host, 'host.docker.internal');
  } finally {
    if (previous === undefined) delete process.env.YAGR_LLM_RELAY_HOST;
    else process.env.YAGR_LLM_RELAY_HOST = previous;
  }
});

test('relay health endpoint reports provider-not-ready when no usable LLM runtime is configured', async () => {
  await withTempHomeAsync(async () => {
    const originalGetLocalConfig = YagrConfigService.prototype.getLocalConfig;
    const originalGetApiKey = YagrConfigService.prototype.getApiKey;
    const previousOpenRouterApiKey = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    YagrConfigService.prototype.getLocalConfig = () => ({
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
      baseUrl: 'https://openrouter.ai/api/v1',
    });
    YagrConfigService.prototype.getApiKey = () => undefined;

    try {
      const relay = await ensureN8nRelayServerInProcess();
      const response = await fetch(`${relay.hostBaseUrl}/health`);
      assert.equal(response.status, 503);
      const payload = await response.json();
      assert.equal(payload.ok, false);
      assert.equal(payload.providerReady, false);
    } finally {
      if (previousOpenRouterApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousOpenRouterApiKey;
      YagrConfigService.prototype.getLocalConfig = originalGetLocalConfig;
      YagrConfigService.prototype.getApiKey = originalGetApiKey;
      closeN8nRelayServerInProcessForTests();
    }
  });
});

test('relay health endpoint reports ready state when the configured provider runtime is reachable', async () => {
  await withTempHomeAsync(async () => {
    const originalGetLocalConfig = YagrConfigService.prototype.getLocalConfig;
    const originalGetApiKey = YagrConfigService.prototype.getApiKey;
    YagrConfigService.prototype.getLocalConfig = () => ({
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
      baseUrl: 'https://openrouter.ai/api/v1',
    });
    YagrConfigService.prototype.getApiKey = () => 'test-key';

    const previousFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const target = String(url);
      if (target.startsWith('http://127.0.0.1:')) {
        return previousFetch(url, init);
      }
      assert.equal(target, 'https://openrouter.ai/api/v1/models');
      return new Response(JSON.stringify({
        data: [{ id: 'openai/gpt-4o-mini' }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    try {
      const relay = await ensureN8nRelayServerInProcess();
      const response = await fetch(`${relay.hostBaseUrl}/health`);
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.ok, true);
      assert.equal(payload.providerReady, true);
      assert.equal(payload.provider, 'openrouter');
    } finally {
      globalThis.fetch = previousFetch;
      YagrConfigService.prototype.getLocalConfig = originalGetLocalConfig;
      YagrConfigService.prototype.getApiKey = originalGetApiKey;
      closeN8nRelayServerInProcessForTests();
    }
  });
});
