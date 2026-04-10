import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveYagrProxyCredentialBaseUrl } from '../dist/manager-tooling/yagr-proxy.js';
import { YagrN8nConfigService } from '../dist/config/n8n-config-service.js';

test('yagrProxy credential base url uses relay host url for managed-local runtime', async () => {
  const original = YagrN8nConfigService.prototype.getLocalConfig;
  YagrN8nConfigService.prototype.getLocalConfig = () => ({ runtimeSource: 'managed-local' });

  try {
    const baseUrl = await resolveYagrProxyCredentialBaseUrl({
      port: 11437,
      baseUrl: 'https://stale-example.trycloudflare.com/v1',
      hostBaseUrl: 'http://127.0.0.1:11437/v1',
      apiKey: 'yagr-relay-key',
    });

    assert.doesNotMatch(baseUrl, /trycloudflare/i);
    assert.match(baseUrl, /11437\/v1$/);
  } finally {
    YagrN8nConfigService.prototype.getLocalConfig = original;
  }
});

test('yagrProxy credential base url keeps configured relay url for external runtime', async () => {
  const original = YagrN8nConfigService.prototype.getLocalConfig;
  YagrN8nConfigService.prototype.getLocalConfig = () => ({ runtimeSource: 'external' });

  try {
    const baseUrl = await resolveYagrProxyCredentialBaseUrl({
      port: 11437,
      baseUrl: 'https://relay-example.trycloudflare.com/v1',
      hostBaseUrl: 'http://127.0.0.1:11437/v1',
      apiKey: 'yagr-relay-key',
    });

    assert.equal(baseUrl, 'https://relay-example.trycloudflare.com/v1');
  } finally {
    YagrN8nConfigService.prototype.getLocalConfig = original;
  }
});