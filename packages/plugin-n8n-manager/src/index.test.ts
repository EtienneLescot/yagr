import test from 'node:test';
import assert from 'node:assert/strict';

import { createYagrLlmSource, n8nManagerPlugin, resolveManagerWorkflowDir } from './index.js';

test('n8n manager plugin exposes expected manifest capabilities', () => {
  assert.equal(n8nManagerPlugin.manifest.name, '@yagr/plugin-n8n-manager');
  assert.equal(n8nManagerPlugin.manifest.kind, 'manager');
  assert.ok(n8nManagerPlugin.manifest.capabilities?.workflows?.includes('n8n-manager'));
  assert.ok(n8nManagerPlugin.manifest.capabilities?.workflows?.includes('n8n-credentials-manager'));
  assert.ok(n8nManagerPlugin.manifest.capabilities?.providers?.includes('yagr-llm-source'));
  assert.ok(n8nManagerPlugin.manifest.capabilities?.surfaces?.includes('webui'));
});

test('resolveManagerWorkflowDir builds a project workflow path', () => {
  const value = resolveManagerWorkflowDir({
    syncFolder: 'workflows',
    instanceIdentifier: '127.0.0.1:5678',
    projectName: 'My Project',
  }, '/tmp/yagr-workspace');

  assert.ok(value?.includes('127.0.0.1_5678'));
  assert.ok(value?.includes('my_project'));
});

test('createYagrLlmSource exposes Yagr model config through the generic n8n-manager LLM source contract', async () => {
  const source = createYagrLlmSource({
    getLocalConfig() {
      return {
        provider: 'openai',
        model: 'gpt-4o',
        baseUrl: 'https://api.openai.com/v1',
        llmProxy: {
          enabled: true,
          credentialBaseUrl: 'http://llm-bridge:8080/v1',
        },
      };
    },
    getApiKey(provider) {
      return provider === 'openai' ? 'secret' : undefined;
    },
  });

  const descriptor = await source.getDescriptor();
  assert.equal(source.id, 'yagr-default-llm');
  assert.equal(descriptor.provider, 'openai');
  assert.equal(descriptor.model, 'gpt-4o');
  assert.equal(descriptor.proxyBaseUrl, 'http://llm-bridge:8080/v1');
  assert.equal(descriptor.openAiCompatible, true);
  assert.equal(await source.getSecret?.({ provider: 'openai', key: 'apiKey' }), 'secret');
});
