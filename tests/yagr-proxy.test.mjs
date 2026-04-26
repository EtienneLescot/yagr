import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRelayInfo } from '../dist/llm/llm-relay-server.js';
import {
  buildYagrProxyCredentialData,
  getYagrProxyStatus,
} from '../dist/manager-tooling/yagr-proxy.js';
import { YagrConfigService } from '../dist/config/yagr-config-service.js';

// ─── buildRelayInfo — SSOT for credential base URL ───────────────────────────

test('buildRelayInfo returns local URL when proxy mode is local', () => {
  const original = YagrConfigService.prototype.getLocalConfig;
  YagrConfigService.prototype.getLocalConfig = () => ({
    llmProxy: {
      enabled: true,
      mode: 'local',
      credentialBaseUrl: 'http://127.0.0.1:11437/v1',
      consentVersion: '1',
      consentAcceptedAt: '2026-01-01T00:00:00.000Z',
    },
  });

  try {
    const relay = buildRelayInfo(11437);
    assert.equal(relay.baseUrl, 'http://127.0.0.1:11437/v1');
    assert.equal(relay.hostBaseUrl, 'http://127.0.0.1:11437/v1');
    assert.equal(relay.port, 11437);
  } finally {
    YagrConfigService.prototype.getLocalConfig = original;
  }
});

test('buildRelayInfo returns docker host URL when proxy mode is docker', () => {
  const original = YagrConfigService.prototype.getLocalConfig;
  YagrConfigService.prototype.getLocalConfig = () => ({
    llmProxy: {
      enabled: true,
      mode: 'docker',
      dockerHostAddress: 'host.docker.internal',
      credentialBaseUrl: 'http://host.docker.internal:11437/v1',
      consentVersion: '1',
      consentAcceptedAt: '2026-01-01T00:00:00.000Z',
    },
  });

  try {
    const relay = buildRelayInfo(11437);
    assert.equal(relay.baseUrl, 'http://host.docker.internal:11437/v1');
    assert.equal(relay.hostBaseUrl, 'http://127.0.0.1:11437/v1');
    assert.equal(relay.port, 11437);
  } finally {
    YagrConfigService.prototype.getLocalConfig = original;
  }
});

test('buildRelayInfo returns tunnel URL when proxy mode is tunnel', () => {
  const original = YagrConfigService.prototype.getLocalConfig;
  YagrConfigService.prototype.getLocalConfig = () => ({
    llmProxy: {
      enabled: true,
      mode: 'tunnel',
      llmTunnelUrl: 'https://abc123.trycloudflare.com',
      credentialBaseUrl: 'https://abc123.trycloudflare.com/v1',
      consentVersion: '1',
      consentAcceptedAt: '2026-01-01T00:00:00.000Z',
    },
  });

  try {
    const relay = buildRelayInfo(11437);
    assert.equal(relay.baseUrl, 'https://abc123.trycloudflare.com/v1');
    assert.equal(relay.hostBaseUrl, 'http://127.0.0.1:11437/v1');
  } finally {
    YagrConfigService.prototype.getLocalConfig = original;
  }
});

test('buildRelayInfo uses the current port for docker URL regardless of stored credential URL', () => {
  const original = YagrConfigService.prototype.getLocalConfig;
  YagrConfigService.prototype.getLocalConfig = () => ({
    llmProxy: {
      enabled: true,
      mode: 'docker',
      dockerHostAddress: 'host.docker.internal',
      credentialBaseUrl: 'http://host.docker.internal:11437/v1',
      consentVersion: '1',
      consentAcceptedAt: '2026-01-01T00:00:00.000Z',
    },
  });

  try {
    const relay = buildRelayInfo(38119);
    assert.equal(relay.baseUrl, 'http://host.docker.internal:38119/v1');
  } finally {
    YagrConfigService.prototype.getLocalConfig = original;
  }
});

// ─── getYagrProxyStatus — proxy not configured ───────────────────────────────

test('getYagrProxyStatus reports configured:false when llmProxy is not set', async () => {
  const original = YagrConfigService.prototype.getLocalConfig;
  YagrConfigService.prototype.getLocalConfig = () => ({});

  try {
    const status = await getYagrProxyStatus();
    assert.equal(status.configured, false);
    assert.match(status.next, /not configured/i);
  } finally {
    YagrConfigService.prototype.getLocalConfig = original;
  }
});

test('Yagr proxy credential data contains the relay API key and base URL', () => {
  assert.deepEqual(
    buildYagrProxyCredentialData('http://host.docker.internal:11437/v1'),
    {
      apiKey: 'yagr-relay-key',
      url: 'http://host.docker.internal:11437/v1',
    },
  );
});
