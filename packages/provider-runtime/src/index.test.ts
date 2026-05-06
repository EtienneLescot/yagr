import test from 'node:test';
import assert from 'node:assert/strict';

import {
  YAGR_MODEL_PROVIDERS,
  getDefaultModelForProvider,
  getProviderDisplayName,
  normalizeProviderId,
  providerRequiresApiKey,
} from './index.js';

test('provider-runtime exposes full public provider registry', () => {
  assert.ok(YAGR_MODEL_PROVIDERS.includes('openai-oauth'));
  assert.ok(YAGR_MODEL_PROVIDERS.includes('copilot-proxy'));
  assert.ok(YAGR_MODEL_PROVIDERS.includes('anthropic-proxy'));
  assert.equal(getProviderDisplayName('copilot-proxy'), 'GitHub');
});

test('provider-runtime normalizes provider ids and defaults', () => {
  assert.equal(normalizeProviderId('claude'), 'anthropic');
  assert.equal(normalizeProviderId('gemini'), 'google');
  assert.equal(getDefaultModelForProvider('openai-oauth'), 'gpt-5.4');
  assert.equal(providerRequiresApiKey('openai-oauth'), false);
});
