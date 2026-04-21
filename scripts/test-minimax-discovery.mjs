import { config as loadEnv } from 'dotenv';
import { fetchAvailableModels } from '../dist/llm/provider-discovery.js';

loadEnv({ path: '.env' });

const apiKey = process.env.MNIMAX_API_KEY ?? process.env.MINIMAX_API_KEY;

if (!apiKey) {
  console.error('Missing MNIMAX_API_KEY or MINIMAX_API_KEY in .env');
  process.exit(1);
}

const targets = [
  {
    provider: 'minimax',
    label: 'MiniMax API (.io)',
    baseUrl: 'https://api.minimax.io/anthropic',
  },
  {
    provider: 'minimax',
    label: 'MiniMax API (.com)',
    baseUrl: 'https://api.minimaxi.com/anthropic',
  },
  {
    provider: 'minimax-token-plan',
    label: 'MiniMax Token Plan (.io)',
    baseUrl: 'https://api.minimax.io/anthropic',
  },
  {
    provider: 'minimax-token-plan',
    label: 'MiniMax Token Plan (.com)',
    baseUrl: 'https://api.minimaxi.com/anthropic',
  },
];

const results = [];

for (const target of targets) {
  try {
    const models = await fetchAvailableModels(target.provider, apiKey, target.baseUrl);
    results.push({ ...target, ok: true, models });
  } catch (error) {
    results.push({
      ...target,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      models: [],
    });
  }
}

for (const result of results) {
  console.log(`\n[${result.label}]`);
  console.log(`provider: ${result.provider}`);
  console.log(`baseUrl: ${result.baseUrl}`);
  if (!result.ok) {
    console.log(`error: ${result.error}`);
    continue;
  }
  console.log(`models: ${result.models.length}`);
  console.log(`sample: ${result.models.slice(0, 10).join(', ') || '(none)'}`);
}

const successful = results.filter((result) => result.ok);
const hasDynamicModels = successful.some((result) => result.models.length > 0);

if (!hasDynamicModels) {
  console.error('\nNo MiniMax endpoint returned any models.');
  process.exit(2);
}

console.log('\nMiniMax discovery returned at least one non-empty live model list.');
