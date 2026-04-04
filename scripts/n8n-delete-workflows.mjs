#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse .env file
function loadEnv(envPath) {
  const env = {};
  if (!fs.existsSync(envPath)) return env;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([^#=\s]+)\s*=\s*'?([^']*)'?\s*$/);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

const env = loadEnv(path.join(__dirname, '..', '.env'));
const N8N_API_KEY = env.N8N_API_KEY || process.env.N8N_API_KEY;
const N8N_HOST = (env.N8N_HOST || process.env.N8N_HOST || 'http://localhost:5678').replace(/\/$/, '');

if (!N8N_API_KEY) {
  console.error('Error: N8N_API_KEY not found in .env or environment');
  process.exit(1);
}

const days = parseInt(process.argv[2], 10);
if (isNaN(days) || days < 0) {
  console.error('Usage: node scripts/n8n-delete-workflows.mjs <days>');
  console.error('  <days>  Number of days back from today (e.g. 0 = today only, 1 = last 24h, 7 = last week)');
  process.exit(1);
}

const now = new Date();
const cutoffFrom = new Date(now);
cutoffFrom.setDate(cutoffFrom.getDate() - days);
cutoffFrom.setHours(0, 0, 0, 0);

console.log(`Deleting workflows created between ${cutoffFrom.toISOString()} and ${now.toISOString()}`);
console.log(`Instance: ${N8N_HOST}`);

async function fetchWorkflows() {
  const res = await fetch(`${N8N_HOST}/api/v1/workflows?limit=250`, {
    headers: { 'X-N8N-API-KEY': N8N_API_KEY },
  });
  if (!res.ok) throw new Error(`Failed to fetch workflows: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return data.data || [];
}

async function deleteWorkflow(id) {
  const res = await fetch(`${N8N_HOST}/api/v1/workflows/${id}`, {
    method: 'DELETE',
    headers: { 'X-N8N-API-KEY': N8N_API_KEY },
  });
  return res.status;
}

const workflows = await fetchWorkflows();
const fromTs = cutoffFrom.getTime();
const toTs = now.getTime();

const toDelete = workflows.filter(w => {
  const ts = new Date(w.createdAt).getTime();
  return ts >= fromTs && ts <= toTs;
});

if (toDelete.length === 0) {
  console.log('No workflows found in that time range.');
  process.exit(0);
}

console.log(`Found ${toDelete.length} workflow(s) to delete:`);
for (const w of toDelete) {
  console.log(`  [${w.id}] ${w.name} — ${w.createdAt}`);
}
console.log('');

for (const w of toDelete) {
  const status = await deleteWorkflow(w.id);
  console.log(`[${status}] Deleted [${w.id}] ${w.name}`);
}
