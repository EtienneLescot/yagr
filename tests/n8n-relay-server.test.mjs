import assert from 'node:assert/strict';
import test from 'node:test';

import { translateResponsesRequestToChatCompletionsBody } from '../dist/llm/llm-relay-server.js';

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