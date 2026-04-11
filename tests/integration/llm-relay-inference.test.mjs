/**
 * Integration (low-level): HTTP POST to the local OpenAI-compatible LLM relay → upstream provider.
 * Skips when no API key (CI / offline). Does not start n8n or the full agent stack.
 *
 * Not part of `npm run test:unit` — requires a real provider credential.
 *
 * Loads `.env` / `.env.test` from the repo root (same as `scripts/scenario-integration-test.mjs`) so
 * `OPENROUTER_*` keys are visible even when not exported in the shell — otherwise this test could SKIP
 * while scenario integration PASSes with the same machine.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { config as dotenvConfig } from 'dotenv';

const _repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenvConfig({ path: path.join(_repoRoot, '.env'), quiet: true, override: true });
dotenvConfig({ path: path.join(_repoRoot, '.env.test'), quiet: true, override: true });

const hasOpenRouter = Boolean(
  String(process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_LLM_API_KEY || '').trim(),
);

test(
  'LLM relay (in-process) forwards /v1/chat/completions to the configured Yagr provider',
  { skip: !hasOpenRouter, timeout: 90_000 },
  async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-relay-inf-'));
    const prevHome = process.env.YAGR_HOME;
    const model = String(process.env.YAGR_TEST_RELAY_MODEL || 'openai/gpt-4o-mini').trim();
    process.env.YAGR_HOME = tmp;
    fs.writeFileSync(
      path.join(tmp, 'yagr-config.json'),
      `${JSON.stringify({ provider: 'openrouter', model }, null, 2)}\n`,
    );

    const {
      ensureN8nRelayServerInProcess,
      closeN8nRelayServerInProcessForTests,
      N8N_RELAY_FAKE_API_KEY,
    } = await import('../../dist/llm/llm-relay-server.js');

    try {
      const info = await ensureN8nRelayServerInProcess();
      const url = `${info.hostBaseUrl}/chat/completions`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${N8N_RELAY_FAKE_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'ignored-by-relay',
          messages: [
            {
              role: 'user',
              content:
                'Reply with a single line containing exactly this token and nothing else: YAGR_RELAY_SMOKE_TOKEN',
            },
          ],
          max_tokens: 64,
          temperature: 0,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        assert.fail(`relay HTTP ${res.status}: ${errText.slice(0, 400)}`);
      }
      const body = await res.json();
      const content = body?.choices?.[0]?.message?.content;
      assert.ok(typeof content === 'string' && content.length > 0, 'empty completion content');
      assert.match(
        content,
        /YAGR_RELAY_SMOKE_TOKEN/i,
        `expected smoke token in model reply, got: ${content.slice(0, 200)}`,
      );
    } finally {
      closeN8nRelayServerInProcessForTests();
      if (prevHome === undefined) {
        delete process.env.YAGR_HOME;
      } else {
        process.env.YAGR_HOME = prevHome;
      }
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
  },
);
