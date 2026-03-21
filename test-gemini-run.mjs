import { YagrRunEngine } from './dist/runtime/run-engine.js';
import { YagrNativeEngine } from './dist/engine/yagr-engine.js';
import { buildSystemPrompt } from './dist/prompt/build-system-prompt.js';

console.log('Creating engine...');
const engine = new YagrNativeEngine();

const systemPrompt = buildSystemPrompt(engine);
console.log('System prompt length:', systemPrompt.length, 'chars');

const runEngine = new YagrRunEngine(engine, [], systemPrompt);

console.log('\nRunning "salut" with google-proxy (gemini-3-flash-preview)...');
const timeout = setTimeout(() => {
  console.error('\n[!] HANG detected after 45s — still waiting');
  process.exit(1);
}, 45000);

let lastPhase = '';
try {
  const result = await runEngine.execute('salut', {
    provider: 'google-proxy',
    model: 'gemini-3-flash-preview',
    onPhaseChange: async (event) => {
      console.log(`[phase] ${event.phase} ${event.status}: ${event.message}`);
      lastPhase = event.message;
    },
    onStepFinish: async (step) => {
      console.log(`[step] #${step.stepNumber} ${step.stepType} finishReason=${step.finishReason} tools=[${step.toolCalls.map(t => t.toolName).join(',')}]`);
    },
    onTextDelta: async (delta) => {
      process.stdout.write(delta);
    },
  });
  clearTimeout(timeout);
  console.log('\n\nResult:', result.finishReason, '| text:', result.text.slice(0, 100));
} catch (error) {
  clearTimeout(timeout);
  console.error('\nERROR:', error.message);
  console.error('Last phase:', lastPhase);
}
