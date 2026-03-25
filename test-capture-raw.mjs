// Capture raw Google streaming response to see where thought_signature appears
import { createOpenAI } from '@ai-sdk/openai';
import { streamText, tool } from 'ai';
import { z } from 'zod';

const chunks = [];
let firstResponseCaptured = false;

const interceptingFetch = async (input, init) => {
  const url = String(input);
  const isGoogle = url.includes('generativelanguage') || url.includes('googleapis');
  
  if (!isGoogle) return fetch(input, init);
  
  const response = await fetch(input, init);
  
  if (!firstResponseCaptured && response.ok) {
    firstResponseCaptured = true;
    
    // Read the full body
    const body = await response.text();
    
    // Log the full SSE body (first 5000 chars)
    process.stderr.write('\n=== RAW STREAMING RESPONSE (first 5000 chars) ===\n');
    process.stderr.write(body.slice(0, 5000) + '\n');
    process.stderr.write('=== END RAW RESPONSE ===\n');
    
    // Look for thought_signature in the response
    if (body.includes('thought_signature')) {
      process.stderr.write('!!! FOUND thought_signature in response !!!\n');
    } else {
      process.stderr.write('No thought_signature in response\n');
    }
    
    // Return a new response with the same body
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
  
  return response;
};

const providerClient = createOpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
  name: 'google',
  compatibility: 'compatible',
  fetch: interceptingFetch,
});

const model = providerClient('gemini-3-flash-preview');

try {
  const result = streamText({
    model,
    system: 'You are a helpful assistant.',
    messages: [{ role: 'user', content: 'List some files in /tmp' }],
    tools: {
      listFiles: tool({
        description: 'List files in a directory',
        parameters: z.object({ dir: z.string() }),
        execute: async ({ dir }) => `Files in ${dir}: file1.ts, file2.ts`,
      }),
    },
    maxSteps: 2,
    onStepFinish: ({ stepType, toolCalls, text }) => {
      process.stdout.write(`Step finished: type=${stepType} toolCalls=${toolCalls?.length || 0} text=${text?.slice(0, 50) || ''}\n`);
    }
  });

  let text = '';
  for await (const chunk of result.textStream) { text += chunk; }
  const steps = await result.steps;
  process.stdout.write('Final text: ' + text.slice(0, 200) + '\n');
  process.stdout.write('Steps: ' + steps.length + '\n');
} catch(e) {
  process.stdout.write('Error: ' + e.message?.slice(0, 300) + '\n');
}
