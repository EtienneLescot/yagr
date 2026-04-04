import assert from 'node:assert/strict';
import test from 'node:test';

import {
  translateChatCompletionsToAnthropic,
  translateAnthropicResponseToChatCompletions,
  translateAnthropicSseEvent,
  createAnthropicSseTranslationState,
} from '../dist/llm/anthropic-relay.js';

// ─── Request translation ─────────────────────────────────────────────────────

test('translateChatCompletionsToAnthropic: separates system message', () => {
  const result = translateChatCompletionsToAnthropic({
    model: 'claude-opus-4-5',
    messages: [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
    ],
  });

  assert.equal(result.system, 'You are helpful.');
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].role, 'user');
  assert.equal(result.messages[0].content, 'Hello');
});

test('translateChatCompletionsToAnthropic: multiple system messages are joined', () => {
  const result = translateChatCompletionsToAnthropic({
    model: 'claude-opus-4-5',
    messages: [
      { role: 'system', content: 'You are helpful.' },
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'Hi' },
    ],
  });

  assert.ok(result.system?.includes('You are helpful.'));
  assert.ok(result.system?.includes('Be concise.'));
});

test('translateChatCompletionsToAnthropic: sets max_tokens default', () => {
  const result = translateChatCompletionsToAnthropic({
    model: 'claude-opus-4-5',
    messages: [{ role: 'user', content: 'Hi' }],
  });
  assert.ok(result.max_tokens > 0);
});

test('translateChatCompletionsToAnthropic: respects explicit max_tokens', () => {
  const result = translateChatCompletionsToAnthropic({
    model: 'claude-opus-4-5',
    messages: [{ role: 'user', content: 'Hi' }],
    max_tokens: 512,
  });
  assert.equal(result.max_tokens, 512);
});

test('translateChatCompletionsToAnthropic: translates tool definitions', () => {
  const result = translateChatCompletionsToAnthropic({
    model: 'claude-opus-4-5',
    messages: [{ role: 'user', content: 'Search' }],
    tools: [
      {
        type: 'function',
        function: {
          name: 'search',
          description: 'Search the web',
          parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
        },
      },
    ],
  });

  assert.equal(result.tools?.length, 1);
  assert.equal(result.tools?.[0].name, 'search');
  assert.equal(result.tools?.[0].description, 'Search the web');
  assert.deepEqual(result.tools?.[0].input_schema, {
    type: 'object',
    properties: { q: { type: 'string' } },
    required: ['q'],
  });
});

test('translateChatCompletionsToAnthropic: translates assistant tool_calls', () => {
  const result = translateChatCompletionsToAnthropic({
    model: 'claude-opus-4-5',
    messages: [
      { role: 'user', content: 'Search' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'tc_1', type: 'function', function: { name: 'search', arguments: '{"q":"yagr"}' } },
        ],
      },
    ],
  });

  const assistantMsg = result.messages[1];
  assert.equal(assistantMsg.role, 'assistant');
  assert.ok(Array.isArray(assistantMsg.content));
  const toolUse = (assistantMsg.content).find((b) => b.type === 'tool_use');
  assert.ok(toolUse);
  assert.equal(toolUse.id, 'tc_1');
  assert.equal(toolUse.name, 'search');
});

test('translateChatCompletionsToAnthropic: translates tool result messages', () => {
  const result = translateChatCompletionsToAnthropic({
    model: 'claude-opus-4-5',
    messages: [
      { role: 'user', content: 'Search' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'tc_1', type: 'function', function: { name: 'search', arguments: '{}' } }] },
      { role: 'tool', content: 'result text', tool_call_id: 'tc_1' },
    ],
  });

  const toolResultMsg = result.messages[2];
  assert.equal(toolResultMsg.role, 'user');
  assert.ok(Array.isArray(toolResultMsg.content));
  assert.equal(toolResultMsg.content[0].type, 'tool_result');
});

test('translateChatCompletionsToAnthropic: translates tool_choice auto', () => {
  const result = translateChatCompletionsToAnthropic({
    model: 'claude-opus-4-5',
    messages: [{ role: 'user', content: 'Hi' }],
    tool_choice: 'auto',
  });
  assert.deepEqual(result.tool_choice, { type: 'auto' });
});

test('translateChatCompletionsToAnthropic: translates tool_choice required to any', () => {
  const result = translateChatCompletionsToAnthropic({
    model: 'claude-opus-4-5',
    messages: [{ role: 'user', content: 'Hi' }],
    tool_choice: 'required',
  });
  assert.deepEqual(result.tool_choice, { type: 'any' });
});

test('translateChatCompletionsToAnthropic: translates specific function tool_choice', () => {
  const result = translateChatCompletionsToAnthropic({
    model: 'claude-opus-4-5',
    messages: [{ role: 'user', content: 'Hi' }],
    tool_choice: { type: 'function', function: { name: 'search' } },
  });
  assert.deepEqual(result.tool_choice, { type: 'tool', name: 'search' });
});

// ─── Non-streaming response translation ─────────────────────────────────────

test('translateAnthropicResponseToChatCompletions: basic text response', () => {
  const response = {
    id: 'msg_123',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'Hello world' }],
    model: 'claude-opus-4-5',
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 5 },
  };

  const result = translateAnthropicResponseToChatCompletions(response);

  assert.equal(result.id, 'msg_123');
  assert.equal(result.object, 'chat.completion');
  assert.equal(result.model, 'claude-opus-4-5');
  assert.equal(result.choices[0].message.content, 'Hello world');
  assert.equal(result.choices[0].message.role, 'assistant');
  assert.equal(result.choices[0].finish_reason, 'stop');
  assert.equal(result.usage.prompt_tokens, 10);
  assert.equal(result.usage.completion_tokens, 5);
  assert.equal(result.usage.total_tokens, 15);
});

test('translateAnthropicResponseToChatCompletions: tool_use response maps to tool_calls', () => {
  const response = {
    id: 'msg_456',
    type: 'message',
    role: 'assistant',
    content: [
      { type: 'tool_use', id: 'tu_1', name: 'search', input: { q: 'test' } },
    ],
    model: 'claude-opus-4-5',
    stop_reason: 'tool_use',
    usage: { input_tokens: 5, output_tokens: 3 },
  };

  const result = translateAnthropicResponseToChatCompletions(response);

  assert.equal(result.choices[0].finish_reason, 'tool_calls');
  const toolCalls = result.choices[0].message.tool_calls;
  assert.equal(toolCalls.length, 1);
  assert.equal(toolCalls[0].id, 'tu_1');
  assert.equal(toolCalls[0].function.name, 'search');
  assert.equal(toolCalls[0].function.arguments, '{"q":"test"}');
});

test('translateAnthropicResponseToChatCompletions: max_tokens maps to length finish reason', () => {
  const response = {
    id: 'msg_789',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'Hello' }],
    model: 'claude-opus-4-5',
    stop_reason: 'max_tokens',
    usage: { input_tokens: 10, output_tokens: 100 },
  };

  const result = translateAnthropicResponseToChatCompletions(response);
  assert.equal(result.choices[0].finish_reason, 'length');
});

// ─── SSE streaming translation ────────────────────────────────────────────────

test('translateAnthropicSseEvent: message_start emits role delta', () => {
  const state = createAnthropicSseTranslationState('claude-opus-4-5');
  const lines = translateAnthropicSseEvent('message_start', {
    message: { id: 'msg_abc', model: 'claude-opus-4-5', type: 'message', role: 'assistant', content: [], stop_reason: null, usage: { input_tokens: 5, output_tokens: 0 } },
  }, state);

  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0].replace(/^data: /, ''));
  assert.equal(parsed.choices[0].delta.role, 'assistant');
  assert.equal(parsed.choices[0].delta.content, '');
  assert.equal(state.completionId, 'msg_abc');
});

test('translateAnthropicSseEvent: content_block_delta text emits content chunk', () => {
  const state = createAnthropicSseTranslationState('claude-opus-4-5');
  const lines = translateAnthropicSseEvent('content_block_delta', {
    index: 0,
    delta: { type: 'text_delta', text: 'Hello' },
  }, state);

  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0].replace(/^data: /, ''));
  assert.equal(parsed.choices[0].delta.content, 'Hello');
});

test('translateAnthropicSseEvent: content_block_start tool_use emits tool call delta', () => {
  const state = createAnthropicSseTranslationState('claude-opus-4-5');
  const lines = translateAnthropicSseEvent('content_block_start', {
    index: 0,
    content_block: { type: 'tool_use', id: 'tu_1', name: 'search' },
  }, state);

  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0].replace(/^data: /, ''));
  const tc = parsed.choices[0].delta.tool_calls[0];
  assert.equal(tc.id, 'tu_1');
  assert.equal(tc.function.name, 'search');
  assert.equal(tc.index, 0);
  assert.equal(state.currentToolIndex, 0);
});

test('translateAnthropicSseEvent: input_json_delta emits arguments chunk', () => {
  const state = createAnthropicSseTranslationState('claude-opus-4-5');
  state.currentToolIndex = 0;
  state.toolInputAccumulator[0] = '';

  const lines = translateAnthropicSseEvent('content_block_delta', {
    index: 0,
    delta: { type: 'input_json_delta', partial_json: '{"q":' },
  }, state);

  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0].replace(/^data: /, ''));
  assert.equal(parsed.choices[0].delta.tool_calls[0].function.arguments, '{"q":');
});

test('translateAnthropicSseEvent: message_delta emits finish chunk', () => {
  const state = createAnthropicSseTranslationState('claude-opus-4-5');
  const lines = translateAnthropicSseEvent('message_delta', {
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 10 },
  }, state);

  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0].replace(/^data: /, ''));
  assert.equal(parsed.choices[0].finish_reason, 'stop');
});

test('translateAnthropicSseEvent: message_delta tool_use maps to tool_calls finish reason', () => {
  const state = createAnthropicSseTranslationState('claude-opus-4-5');
  const lines = translateAnthropicSseEvent('message_delta', {
    delta: { stop_reason: 'tool_use' },
    usage: { output_tokens: 5 },
  }, state);

  const parsed = JSON.parse(lines[0].replace(/^data: /, ''));
  assert.equal(parsed.choices[0].finish_reason, 'tool_calls');
});

test('translateAnthropicSseEvent: message_stop emits [DONE]', () => {
  const state = createAnthropicSseTranslationState('claude-opus-4-5');
  const lines = translateAnthropicSseEvent('message_stop', {}, state);
  assert.equal(lines.length, 1);
  assert.equal(lines[0], 'data: [DONE]');
});

test('translateAnthropicSseEvent: unknown event type returns empty', () => {
  const state = createAnthropicSseTranslationState('claude-opus-4-5');
  const lines = translateAnthropicSseEvent('ping', {}, state);
  assert.equal(lines.length, 0);
});
