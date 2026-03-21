// Test whether streamText properly surfaces errors from doStream
import { streamText } from 'ai';

// Fake model whose doStream hangs forever then aborts
const hangingModel = {
  specificationVersion: 'v1',
  provider: 'test',
  modelId: 'test',
  defaultObjectGenerationMode: undefined,
  supportsImageUrls: false,
  supportsStructuredOutputs: false,
  async doGenerate() { throw new Error('doGenerate not supported'); },
  async doStream() {
    console.log('doStream called, waiting 3s then throwing AbortError...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    throw err;
  },
};

console.log('Starting streamText with hanging model...');
const result = streamText({
  model: hangingModel,
  messages: [{ role: 'user', content: 'test' }],
  maxSteps: 3,
});

const timeout = setTimeout(() => {
  console.error('[!] HANG — Promise.all did not resolve after 10s');
  process.exit(1);
}, 10000);

try {
  for await (const delta of result.textStream) {
    console.log('delta:', delta);
  }
  console.log('textStream done — now awaiting result.text, result.finishReason, result.steps...');
  const [text, reason, steps] = await Promise.all([result.text, result.finishReason, result.steps]);
  clearTimeout(timeout);
  console.log('text:', JSON.stringify(text), '| reason:', reason, '| steps:', steps.length);
} catch (e) {
  clearTimeout(timeout);
  console.log('error:', e.name, e.message);
}
