/**
 * Diagnoses whether thinking tokens survive through the LangGraph deepagent's streamEvents.
 *
 * Usage:
 *   npm run build && node test-thinking-streamevents.mjs
 *
 * Requires a working copilot-proxy session (yagr setup).
 */
import { createLangChainModel } from './dist/llm/create-langchain-model.js';
import { createYagrDeepAgent } from './dist/agent-factory.js';
import { HumanMessage } from '@langchain/core/messages';

const model = await createLangChainModel();
console.log('Model type:', model.constructor.name);

const messages = [new HumanMessage('In 3 sentences, what is 2+2? Think step by step.')];

// ── Test 1: model.stream() ──────────────────────────────────────────────────
console.log('\n=== Test 1: model.stream() ===');
let streamCount = 0, thinkingCount = 0;
for await (const chunk of await model.stream(messages)) {
  streamCount++;
  const ak = chunk.additional_kwargs;
  if (ak?.reasoning_content) {
    thinkingCount++;
    if (thinkingCount <= 2) {
      console.log(`Thinking chunk ${thinkingCount}: ${JSON.stringify(ak.reasoning_content).slice(0, 80)}`);
    }
  }
}
console.log(`Total chunks: ${streamCount} | Thinking chunks: ${thinkingCount}`);

// ── Test 2: model.streamEvents() ──────────────────────────────────────────
console.log('\n=== Test 2: model.streamEvents() ===');
let eventCount = 0, thinkingEventCount = 0;
const events = model.streamEvents(messages, { version: 'v2' });
for await (const event of events) {
  if (event.event === 'on_chat_model_stream') {
    eventCount++;
    const chunk = event.data?.chunk;
    const ak = chunk?.additional_kwargs;
    if (ak?.reasoning_content) {
      thinkingEventCount++;
      if (thinkingEventCount <= 2) {
        console.log(`Thinking event ${thinkingEventCount}: ${JSON.stringify(ak.reasoning_content).slice(0, 80)}`);
      }
    } else if (eventCount <= 3) {
      console.log(`Event ${eventCount} additional_kwargs:`, JSON.stringify(ak));
    }
  }
}
console.log(`Total on_chat_model_stream events: ${eventCount} | Thinking events: ${thinkingEventCount}`);

// ── Test 3: model.bindTools([]).streamEvents() ───────────────────────────
console.log('\n=== Test 3: model.bindTools([]).streamEvents() (simulating agent) ===');
const boundModel = model.bindTools([]);
let eventCount3 = 0, thinkingEventCount3 = 0;
const events3 = boundModel.streamEvents(messages, { version: 'v2' });
for await (const event of events3) {
  if (event.event === 'on_chat_model_stream') {
    eventCount3++;
    const chunk = event.data?.chunk;
    const ak = chunk?.additional_kwargs;
    if (ak?.reasoning_content) {
      thinkingEventCount3++;
      if (thinkingEventCount3 <= 2) {
        console.log(`Thinking event ${thinkingEventCount3}: ${JSON.stringify(ak.reasoning_content).slice(0, 80)}`);
      }
    } else if (eventCount3 <= 3) {
      console.log(`Event ${eventCount3} additional_kwargs:`, JSON.stringify(ak));
    }
  }
}
console.log(`Total on_chat_model_stream events: ${eventCount3} | Thinking events: ${thinkingEventCount3}`);

// ── Test 3b: model.bindTools([fakeTool]).streamEvents() ─────────────────
console.log('\n=== Test 3b: model with 1 real tool bound ===');
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
const fakeTool = tool(async () => 'ok', { name: 'echo', description: 'echo', schema: z.object({ msg: z.string() }) });
const boundModelWithTools = model.bindTools([fakeTool]);
let eventCount3b = 0, thinkingEventCount3b = 0;
const events3b = boundModelWithTools.streamEvents(messages, { version: 'v2' });
for await (const event of events3b) {
  if (event.event === 'on_chat_model_stream') {
    eventCount3b++;
    const chunk = event.data?.chunk;
    const ak = chunk?.additional_kwargs;
    if (ak?.reasoning_content) {
      thinkingEventCount3b++;
      if (thinkingEventCount3b <= 2) {
        console.log(`Thinking event ${thinkingEventCount3b}: ${JSON.stringify(ak.reasoning_content).slice(0, 80)}`);
      }
    } else if (eventCount3b <= 3) {
      console.log(`Event ${eventCount3b} additional_kwargs:`, JSON.stringify(ak));
    }
  }
}
console.log(`Total on_chat_model_stream events: ${eventCount3b} | Thinking events: ${thinkingEventCount3b}`);

// ── Test 4: deepagent.streamEvents() ──────────────────────────────────────
console.log('\n=== Test 4: deepagent.streamEvents() ===');

// Patch global fetch to log request body differences
let callCount = 0;
const origFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  callCount++;
  if (callCount <= 2 && init?.body) {
    try {
      const body = JSON.parse(init.body);
      console.log(`Request ${callCount}: model=${body.model} tools=${body.tools?.length ?? 0} stream=${body.stream}`);
      const keys = Object.keys(body).filter(k => k.includes('reason') || k.includes('budget') || k.includes('think'));
      if (keys.length > 0) console.log(`  thinking-related fields:`, keys.map(k => `${k}=${JSON.stringify(body[k])}`).join(', '));
    } catch {}
  }
  
  // For the first call, intercept and log if reasoning_text appears
  if (callCount === 1) {
    const resp = await origFetch(input, init);
    const text = await resp.text();
    const hasReasoning = text.includes('reasoning_text');
    console.log(`  Raw response has reasoning_text: ${hasReasoning}`);
    if (hasReasoning) {
      const idx = text.indexOf('reasoning_text');
      console.log(`  Snippet: ${text.slice(Math.max(0, idx-10), idx+100)}`);
    }
    return new Response(text, { status: resp.status, statusText: resp.statusText, headers: resp.headers });
  }
  
  return origFetch(input, init);
};

const fakeEngine = { name: 'test' };
const { agent } = await createYagrDeepAgent(fakeEngine);
let eventCount4 = 0, thinkingEventCount4 = 0;
const agentInput = { messages: [new HumanMessage('Analyze the fibonacci sequence: what is the 15th number? Show each step of your reasoning.') ] };
const agentConfig = { version: 'v2', configurable: { thread_id: 'test-thread-2' } };
for await (const event of agent.streamEvents(agentInput, agentConfig)) {
  if (event.event === 'on_chat_model_stream') {
    eventCount4++;
    const chunk = event.data?.chunk;
    const ak = chunk?.additional_kwargs;
    if (ak?.reasoning_content) {
      thinkingEventCount4++;
      if (thinkingEventCount4 <= 2) {
        console.log(`Thinking event ${thinkingEventCount4}: ${JSON.stringify(ak.reasoning_content).slice(0, 80)}`);
      }
    } else if (eventCount4 <= 5) {
      // Print full additional_kwargs AND content to understand what's there
      console.log(`Event ${eventCount4}: content=${JSON.stringify(String(chunk?.content ?? '').slice(0,40))} ak=${JSON.stringify(ak)} tc=${JSON.stringify(chunk?.tool_call_chunks?.length ?? 0)}`);
    }
  }
}
console.log(`Total on_chat_model_stream events: ${eventCount4} | Thinking events: ${thinkingEventCount4}`);
