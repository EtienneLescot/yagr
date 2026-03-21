import { createLanguageModel } from './dist/llm/create-language-model.js';
import { generateText } from 'ai';

// Test gemini-3-flash-preview with a timeout indicator
console.log('Testing gemini-3-flash-preview with 30s timeout...');
const model = createLanguageModel({ provider: 'google-proxy', model: 'gemini-3-flash-preview' });

const timeout = setTimeout(() => {
  console.log('[!] Still waiting after 15s...');
}, 15000);

try {
  const result = await generateText({ model, prompt: 'Reply with only OK.', maxTokens: 10 });
  clearTimeout(timeout);
  console.log('Result:', JSON.stringify(result.text));
  console.log('Finish reason:', result.finishReason);
} catch (error) {
  clearTimeout(timeout);
  console.error('Error:', error.message);
}
