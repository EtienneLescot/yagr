import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  translateResponsesRequestToChatCompletionsBody,
  buildRelayInfo,
  resolveDockerHostAddress,
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
