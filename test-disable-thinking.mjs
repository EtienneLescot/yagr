// Quick test: does reasoning_effort='none' or thinking_budget=0 disable thinking in Google compat API?
import { createOpenAI } from '@ai-sdk/openai';
import { streamText, tool } from 'ai';
import { z } from 'zod';

const apiKey = process.env.GEMINI_API_KEY;

async function testWithParam(paramName, paramValue) {
  process.stdout.write(`\nTesting ${paramName}=${JSON.stringify(paramValue)} ...\n`);
  
  const interceptingFetch = async (input, init) => {
    if (init?.body && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body);
        body[paramName] = paramValue;
        return await fetch(input, { ...init, body: JSON.stringify(body) });
      } catch {
        return fetch(input, init);
      }
    }
    return fetch(input, init);
  };

  const providerClient = createOpenAI({
    apiKey,
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
      messages: [{ role: 'user', content: 'List some files' }],
      tools: {
        listFiles: tool({
          description: 'List files',
          parameters: z.object({ dir: z.string().describe('directory') }),
          execute: async ({ dir }) => `Found files in ${dir}: file1.ts, file2.ts`,
        }),
      },
      maxSteps: 2,
    });

    let text = '';
    for await (const chunk of result.textStream) {
      text += chunk;
    }
    const steps = await result.steps;
    process.stdout.write(`SUCCESS: ${steps.length} steps, text: ${text.slice(0, 100)}\n`);
  } catch(e) {
    process.stdout.write(`FAIL: ${e.message?.slice(0, 200)}\n`);
  }
}

await testWithParam('reasoning_effort', 'none');
await testWithParam('thinking_budget', 0);
