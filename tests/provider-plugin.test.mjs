import assert from 'node:assert/strict';
import test from 'node:test';

import { getProviderPlugin } from '../dist/llm/provider-plugin.js';
import { YAGR_SELECTABLE_MODEL_PROVIDERS, isSupportedProvider } from '../dist/llm/provider-registry.js';

test('provider plugin exposes transport facts for openai-compatible and oauth providers', () => {
  const openRouterPlugin = getProviderPlugin('openrouter');
  const openAiProxyPlugin = getProviderPlugin('openai-proxy');
  const anthropicPlugin = getProviderPlugin('anthropic');

  assert.equal(openRouterPlugin.transport.usesOpenAiCompatibleApi, true);
  assert.equal(openRouterPlugin.transport.managedProxy, false);
  assert.equal(openAiProxyPlugin.transport.oauthAccount, true);
  assert.equal(anthropicPlugin.transport.usesOpenAiCompatibleApi, false);
});

test('provider plugin owns factory and discovery hooks', () => {
  const openRouterPlugin = getProviderPlugin('openrouter');
  const openAiPlugin = getProviderPlugin('openai');
  const anthropicProxyPlugin = getProviderPlugin('anthropic-proxy');

  assert.equal(typeof openRouterPlugin.factory.createLanguageModel, 'function');
  assert.equal(typeof openRouterPlugin.discovery?.fetchAvailableModels, 'function');
  assert.equal(typeof openRouterPlugin.metadata?.primeModelMetadata, 'function');
  assert.equal(typeof openAiPlugin.factory.createLanguageModel, 'function');
  assert.equal(typeof openAiPlugin.discovery?.fetchAvailableModels, 'function');
  assert.equal(typeof anthropicProxyPlugin.factory.createLanguageModel, 'function');
  assert.equal(anthropicProxyPlugin.discovery, undefined);
});

test('google-proxy is no longer exposed as a supported selectable provider', () => {
  assert.equal(isSupportedProvider('google-proxy'), false);
  assert.equal(YAGR_SELECTABLE_MODEL_PROVIDERS.includes('google-proxy'), false);
});
