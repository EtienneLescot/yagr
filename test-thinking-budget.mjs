import { getGitHubCopilotSession, resolveCopilotApiToken } from './dist/llm/copilot-account.js';
import { buildSystemPrompt } from './dist/prompt/build-system-prompt.js';

const session = getGitHubCopilotSession();
const auth = await resolveCopilotApiToken(session.githubToken);

const systemPrompt = buildSystemPrompt({ name: 'test' });
console.log('System prompt length:', systemPrompt.length, 'chars');

async function testRequest(testName, body) {
  console.log(`\n--- ${testName} ---`);
  const resp = await fetch(auth.baseUrl + '/chat/completions', {
    method: 'POST',
    headers: { 
      Authorization: 'Bearer ' + auth.token,
      'Content-Type': 'application/json',
      'Editor-Version': 'vscode/1.95.3',
    },
    body: JSON.stringify(body)
  });
  
  const text = await resp.text();
  console.log('Has reasoning_text:', text.includes('reasoning_text'));
  if (!text.includes('reasoning_text')) {
    console.log('First 200 chars:', text.slice(0, 200));
  }
}

const TOOLS_16 = Array.from({length: 16}, (_, i) => ({
  type: 'function',
  function: { name: 'tool_' + i, description: 'dummy tool', parameters: { type: 'object', properties: { x: { type: 'string' } } } }
}));

// Test 1: 16 tools, no system prompt, thinking_budget=512
await testRequest('16 tools + no system prompt + thinking_budget=512', {
  model: 'gemini-3-flash-preview', stream: true,
  messages: [{ role: 'user', content: 'What is 17*13? Think step by step.' }],
  tools: TOOLS_16, thinking_budget: 512,
});

// Test 2: 16 tools + real system prompt + thinking_budget=512
await testRequest('16 tools + real system prompt + thinking_budget=512', {
  model: 'gemini-3-flash-preview', stream: true,
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'What is 17*13? Think step by step.' }
  ],
  tools: TOOLS_16, thinking_budget: 512,
});

// Test 3: 16 tools, no system prompt, no thinking_budget
await testRequest('16 tools + no system prompt + no thinking_budget', {
  model: 'gemini-3-flash-preview', stream: true,
  messages: [{ role: 'user', content: 'What is 17*13? Think step by step.' }],
  tools: TOOLS_16,
});
