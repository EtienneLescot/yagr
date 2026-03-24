import assert from 'node:assert/strict';
import test from 'node:test';

import { getProviderPlugin } from '../dist/llm/provider-plugin.js';

test('provider plugin exposes transport facts for openai-compatible and oauth providers', () => {
  const openRouterPlugin = getProviderPlugin('openrouter');
  const openAiProxyPlugin = getProviderPlugin('openai-proxy');
  const anthropicPlugin = getProviderPlugin('anthropic');

  assert.equal(openRouterPlugin.transport.usesOpenAiCompatibleApi, true);
  assert.equal(openRouterPlugin.transport.managedProxy, false);
  assert.equal(openAiProxyPlugin.transport.oauthAccount, true);
  assert.equal(anthropicPlugin.transport.usesOpenAiCompatibleApi, false);
});
