#!/usr/bin/env node
/**
 * Dump recent n8n executions (includeData) for a workflow id.
 * Uses the same managed-test YAGR_HOME and stored API key as scenario integration tests.
 *
 * Usage:
 *   node scripts/dump-n8n-executions-for-workflow.mjs <workflowId> [output.json]
 *
 * Example (after a run with YAGR_SCN_SKIP_REMOTE_WORKFLOW_CLEANUP=1):
 *   node scripts/dump-n8n-executions-for-workflow.mjs Yc3G6rbPFxc75YiT
 *
 * Default host is http://127.0.0.1:5678 (managed Docker stores the key under that origin). If your `.env`
 * sets N8N_HOST=http://localhost:5678, that can be a *different* stored JWT — override with:
 *   YAGR_DUMP_N8N_EXEC_HOST=http://127.0.0.1:5678 node scripts/dump-n8n-executions-for-workflow.mjs <id>
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig({ path: path.join(process.cwd(), '.env'), quiet: true, override: true });
dotenvConfig({ path: path.join(process.cwd(), '.env.test'), quiet: true, override: true });

const wfId = process.argv[2];
if (!wfId) {
  process.stderr.write('Usage: node scripts/dump-n8n-executions-for-workflow.mjs <workflowId> [output.json]\n');
  process.exit(1);
}

const outPath = process.argv[3] || path.join(process.cwd(), 'reports', 'last-n8n-executions-dump.json');

const uid = typeof process.getuid === 'function' ? String(process.getuid()) : 'user';
const managedHome = String(process.env.YAGR_IT_MANAGED_HOME || '').trim()
  || path.join(os.tmpdir(), `yagr-it-managed-n8n-${uid}`);
// After dotenv: force managed-test home so .env YAGR_HOME (dev workspace) does not point credential store elsewhere.
process.env.YAGR_HOME = managedHome;

const host = String(process.env.YAGR_DUMP_N8N_EXEC_HOST || 'http://127.0.0.1:5678').replace(/\/+$/, '');

const { YagrN8nConfigService } = await import('../dist/config/n8n-config-service.js');
const apiKey = new YagrN8nConfigService().getApiKey(host);
if (!apiKey) {
  process.stderr.write(`No stored API key for ${host} (YAGR_HOME=${managedHome}). Run scenario integration with managed Docker once.\n`);
  process.exit(1);
}

const url = `${host}/api/v1/executions?workflowId=${encodeURIComponent(wfId)}&limit=3&includeData=true`;
const res = await fetch(url, { headers: { 'X-N8N-API-KEY': apiKey, Accept: 'application/json' } });
const json = await res.json();
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(json, null, 2)}\n`);
process.stdout.write(`Wrote ${outPath} (HTTP ${res.status})\n`);
const blob = JSON.stringify(json);
if (/paris/i.test(blob)) {
  process.stdout.write('Substring "paris" (case-insensitive) appears in the dump.\n');
}
