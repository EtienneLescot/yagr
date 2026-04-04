#!/usr/bin/env node
/**
 * Multi-scenario integration test for a single LLM provider.
 *
 * Tests a variety of real-world agent interactions: pure Q&A, workflow listing,
 * simple workflow creation, complex workflow creation, workflow explanation, etc.
 *
 * Usage:
 *   node scripts/scenario-integration-test.mjs [--strict] [--no-markdown]
 *
 * Environment variables:
 *   YAGR_SCN_PROVIDER          Provider to use (default: openrouter)
 *   YAGR_SCN_MODEL             Model to use (default: google/gemini-3-flash-preview)
 *   YAGR_SCN_TIMEOUT_MS        Timeout for Q&A scenarios (default: 60000)
 *   YAGR_SCN_CREATION_TIMEOUT_MS  Timeout for creation scenarios (default: 180000)
 *   YAGR_SCN_MARKDOWN_PATH     Markdown report output path
 *   YAGR_SCN_SCENARIOS         Comma-separated list of scenario IDs to run (default: all)
 *   N8N_HOST / YAGR_IT_N8N_HOST          n8n host for workflow tests
 *   N8N_API_KEY / YAGR_IT_N8N_API_KEY    n8n API key for workflow tests
 *   N8N_PROJECT_ID / YAGR_IT_N8N_PROJECT_ID  n8n project ID
 */

import process from 'node:process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig({ path: '.env', quiet: true, override: true });
dotenvConfig({ path: '.env.test', quiet: true, override: true });

const { getYagrPaths } = await import('../dist/config/yagr-home.js');
const { createN8nEngineFromWorkspace } = await import('../dist/config/load-n8n-engine-config.js');
const { YagrAgent } = await import('../dist/agent.js');
const { analyzeRunOutcome } = await import('../dist/runtime/outcome.js');
const { getDefaultBaseUrlForProvider } = await import('../dist/llm/provider-registry.js');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PROVIDER = String(process.env.YAGR_SCN_PROVIDER || 'openrouter').trim();
const MODEL = String(process.env.YAGR_SCN_MODEL || 'google/gemini-3-flash-preview').trim();
const DEFAULT_TIMEOUT_MS = toInt(process.env.YAGR_SCN_TIMEOUT_MS, 60_000);
const CREATION_TIMEOUT_MS = toInt(process.env.YAGR_SCN_CREATION_TIMEOUT_MS, 180_000);
const strict = process.argv.includes('--strict');
const markdownDisabled = process.argv.includes('--no-markdown');
const markdownPath = process.env.YAGR_SCN_MARKDOWN_PATH
  || path.join(process.cwd(), 'reports', 'scenario-integration-report.md');

const requestedScenarioIds = (process.env.YAGR_SCN_SCENARIOS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// ---------------------------------------------------------------------------
// Scenario definitions
// ---------------------------------------------------------------------------

const SCENARIOS = [
  {
    id: 'hello-world',
    name: 'Réponse simple sans outils',
    prompt: 'Réponds uniquement "Bonjour !" sans utiliser d\'outils.',
    maxSteps: 2,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    n8nRequired: false,
    assert(result) {
      const text = String(result.text || '').toLowerCase();
      if (!text) return { pass: false, note: 'Réponse vide.' };
      if (text.includes('bonjour')) return { pass: true, note: 'Texte contient "Bonjour".' };
      return { pass: true, note: `Texte reçu (${result.text.length} chars) — "Bonjour" non trouvé mais réponse valide.` };
    },
  },

  {
    id: 'yagr-role',
    name: 'Explication du rôle de yagr',
    prompt: 'En 2-3 phrases, explique le rôle d\'un agent yagr dans un système d\'automatisation.',
    maxSteps: 2,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    n8nRequired: false,
    assert(result) {
      const text = String(result.text || '');
      if (text.length < 30) return { pass: false, note: `Réponse trop courte (${text.length} chars).` };
      const hasRelevant = /n8n|workflow|automatisa|orchestr|agent/i.test(text);
      return {
        pass: true,
        note: `Réponse reçue (${text.length} chars)${hasRelevant ? ', contient termes pertinents.' : '.'}`,
      };
    },
  },

  {
    id: 'n8n-concept',
    name: 'Concept n8n expliqué',
    prompt: 'Explique-moi ce qu\'est n8n, à quoi ça sert, et comment yagr l\'utilise. Sois concis.',
    maxSteps: 2,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    n8nRequired: false,
    assert(result) {
      const text = String(result.text || '');
      if (text.length < 40) return { pass: false, note: `Réponse trop courte (${text.length} chars).` };
      const mentionsN8n = /n8n/i.test(text);
      return {
        pass: mentionsN8n,
        note: mentionsN8n
          ? `Réponse reçue (${text.length} chars), mentionne n8n.`
          : `Réponse reçue (${text.length} chars) mais ne mentionne pas n8n.`,
      };
    },
  },

  {
    id: 'agent-capabilities',
    name: 'Capacités de l\'agent listées',
    prompt: 'Liste de façon structurée les principales actions que tu peux effectuer sur n8n en tant qu\'agent.',
    maxSteps: 2,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    n8nRequired: false,
    assert(result) {
      const text = String(result.text || '');
      if (text.length < 50) return { pass: false, note: `Réponse trop courte (${text.length} chars).` };
      const mentionsActions = /créer|lister|modifier|déployer|supprimer|workflow|push|create|list/i.test(text);
      return {
        pass: true,
        note: `Réponse reçue (${text.length} chars)${mentionsActions ? ', mentionne des actions.' : '.'}`,
      };
    },
  },

  {
    id: 'credential-orchestration',
    name: 'Orchestration credentials par noeud',
    prompt: 'Décris précisément comment tu configures les credentials LLM dans un workflow avec plusieurs agents: choix provider par noeud, warning Yagr affiché une seule fois, réutilisation prioritaire des credentials existants, puis création si nécessaire.',
    maxSteps: 3,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    n8nRequired: false,
    assert(result) {
      const text = String(result.text || '');
      if (text.length < 80) return { pass: false, note: `Réponse trop courte (${text.length} chars).` };
      const perNode = /par n[oœ]ud|each node|per-node/i.test(text);
      const warningOnce = /une seule fois|only once|warning.*once/i.test(text);
      const reuseFirst = /r[ée]utilis|reuse.*credential|existing credential/i.test(text);
      const createIfNeeded = /cr[ée]er|create.*credential|si n[ée]cessaire|if needed/i.test(text);
      return {
        pass: perNode && warningOnce && reuseFirst && createIfNeeded,
        note: `Signals: per-node=${perNode}, warning-once=${warningOnce}, reuse-first=${reuseFirst}, create-if-needed=${createIfNeeded}.`,
      };
    },
  },

  {
    id: 'setup-check',
    name: 'Vérification configuration n8n',
    prompt: 'Vérifie que ma connexion à n8n est opérationnelle et dis-moi ce que tu trouves.',
    maxSteps: 5,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    n8nRequired: true,
    assert(result, outcome) {
      const text = String(result.text || '');
      if (text.length < 10) return { pass: false, note: 'Réponse vide.' };
      const usedN8nac = outcome.successfulActions.length > 0 || outcome.failedActions.length > 0;
      return {
        pass: true,
        note: `Réponse reçue (${text.length} chars)${usedN8nac ? ', a utilisé n8nac.' : '.'}`,
      };
    },
  },

  {
    id: 'list-workflows',
    name: 'Listing des workflows existants',
    prompt: 'Liste tous mes workflows n8n disponibles. Montre-moi leurs noms.',
    maxSteps: 8,
    timeoutMs: DEFAULT_TIMEOUT_MS * 2,
    n8nRequired: true,
    assert(result, outcome) {
      const text = String(result.text || '');
      if (text.length < 10) return { pass: false, note: 'Réponse vide.' };
      const usedN8nac = outcome.successfulActions.length > 0 || outcome.failedActions.length > 0;
      const hasListAction = outcome.successfulActions.some((a) => a.action === 'list')
        || outcome.failedActions.some((a) => a.action === 'list');
      if (!usedN8nac) {
        return { pass: false, note: `N'a pas utilisé n8nac. Réponse: ${text.slice(0, 120)}` };
      }
      return {
        pass: true,
        note: `A utilisé n8nac${hasListAction ? ' (list)' : ''}. Réponse: ${text.slice(0, 80)}…`,
      };
    },
  },

  {
    id: 'create-simple',
    name: 'Création workflow simple (Manual Trigger + Set)',
    prompt: 'Crée immédiatement un workflow n8n minimal avec exactement deux noeuds: '
      + 'un Manual Trigger puis un Set qui définit status="ok". '
      + 'Ne me pose aucune question. Utilise les outils n8n disponibles, enregistre le workflow et déploie-le.',
    maxSteps: 12,
    timeoutMs: CREATION_TIMEOUT_MS,
    n8nRequired: true,
    assert(result, outcome) {
      if (outcome.successfulPush) {
        return {
          pass: true,
          note: `Workflow créé et poussé${outcome.successfulVerify ? ' + vérifié' : ''}. File: ${outcome.hasWorkflowWrites ? 'yes' : 'no'}.`,
        };
      }
      if (outcome.hasWorkflowWrites) {
        return { pass: false, note: 'Fichier workflow écrit mais push non confirmé.' };
      }
      const text = String(result.text || '');
      return { pass: false, note: `Aucun push détecté. Réponse: ${text.slice(0, 150)}` };
    },
  },

  {
    id: 'create-webhook',
    name: 'Création workflow webhook (réception POST + réponse)',
    prompt: 'Crée un workflow n8n qui: (1) écoute un Webhook POST sur /ping, '
      + '(2) ajoute un champ "timestamp" avec la date ISO courante via un Set node, '
      + '(3) renvoie la réponse via un Respond to Webhook node. '
      + 'Déploie-le immédiatement sans poser de questions.',
    maxSteps: 15,
    timeoutMs: CREATION_TIMEOUT_MS,
    n8nRequired: true,
    assert(result, outcome) {
      if (outcome.successfulPush) {
        return {
          pass: true,
          note: `Workflow webhook créé et poussé${outcome.successfulVerify ? ' + vérifié' : ''}.`,
        };
      }
      if (outcome.hasWorkflowWrites) {
        return { pass: false, note: 'Fichier workflow écrit mais push non confirmé.' };
      }
      const text = String(result.text || '');
      return { pass: false, note: `Aucun push détecté. Réponse: ${text.slice(0, 150)}` };
    },
  },

  {
    id: 'create-complex',
    name: 'Création workflow complexe (Schedule + HTTP + Set)',
    prompt: 'Crée un workflow n8n automatisé qui: '
      + '(1) démarre sur un Schedule Trigger toutes les heures, '
      + '(2) fait un HTTP Request GET sur https://jsonplaceholder.typicode.com/todos/1, '
      + '(3) extrait le champ "title" et le stocke dans une variable "todo_title" avec un Set node. '
      + 'Déploie-le immédiatement sans poser de questions.',
    maxSteps: 15,
    timeoutMs: CREATION_TIMEOUT_MS,
    n8nRequired: true,
    assert(result, outcome) {
      if (outcome.successfulPush) {
        return {
          pass: true,
          note: `Workflow complexe créé et poussé${outcome.successfulVerify ? ' + vérifié' : ''}.`,
        };
      }
      if (outcome.hasWorkflowWrites) {
        return { pass: false, note: 'Fichier workflow écrit mais push non confirmé.' };
      }
      const text = String(result.text || '');
      return { pass: false, note: `Aucun push détecté. Réponse: ${text.slice(0, 150)}` };
    },
  },

  {
    id: 'explain-workflow',
    name: 'Explication d\'un workflow existant',
    prompt: 'Explique en détail le fonctionnement d\'un de mes workflows : '
      + 'liste d\'abord mes workflows, choisis-en un, et décris ce qu\'il fait nœud par nœud.',
    maxSteps: 8,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    n8nRequired: true,
    assert(result, outcome) {
      const text = String(result.text || '');
      if (text.length < 80) return { pass: false, note: `Réponse trop courte (${text.length} chars).` };
      const usedN8nac = outcome.successfulActions.length > 0 || outcome.failedActions.length > 0;
      const mentionsNodes = /nœud|node|trigger|set|webhook|workflow/i.test(text);
      if (!usedN8nac) {
        return { pass: false, note: `N'a pas listé les workflows via n8nac. Réponse: ${text.slice(0, 100)}` };
      }
      return {
        pass: true,
        note: `A listé + expliqué (${text.length} chars)${mentionsNodes ? ', mentionne des nœuds.' : '.'}`,
      };
    },
  },
];

// ---------------------------------------------------------------------------
// n8n runtime resolution
// ---------------------------------------------------------------------------

function resolveTestN8nRuntime() {
  const configuredHost = String(process.env.N8N_HOST || process.env.YAGR_IT_N8N_HOST || '').trim();
  const configuredApiKey = String(process.env.N8N_API_KEY || process.env.YAGR_IT_N8N_API_KEY || '').trim();
  const configuredProjectId = String(process.env.N8N_PROJECT_ID || process.env.YAGR_IT_N8N_PROJECT_ID || '').trim();
  const host = configuredHost;
  const apiKey = configuredApiKey;
  const projectId = configuredProjectId;

  return { host, apiKey, projectId, configured: Boolean(host && apiKey) };
}

// ---------------------------------------------------------------------------
// Isolated home setup
// ---------------------------------------------------------------------------

function createIsolatedHome(testN8nRuntime) {
  const baseDir = path.join(os.tmpdir(), 'yagr-scenario-test');
  fs.mkdirSync(baseDir, { recursive: true });
  const tempHome = fs.mkdtempSync(path.join(baseDir, `${PROVIDER.replace(/[^a-z0-9]+/gi, '-')}-`));
  const sourcePaths = getYagrPaths();

  writeIsolatedYagrConfig(tempHome);
  copyIfExists(sourcePaths.homeInstructionsPath, path.join(tempHome, 'AGENTS.md'));
  copyDirIfExists(sourcePaths.n8nWorkspaceDir, path.join(tempHome, 'n8n-workspace'));

  const { host, apiKey, projectId } = testN8nRuntime;
  if (host || apiKey || projectId) {
    reconcileN8nRuntime(tempHome, { host, apiKey, projectId });
  }

  return tempHome;
}

function reconcileN8nRuntime(tempHome, { host, apiKey, projectId }) {
  const configPath = path.join(tempHome, 'n8n-workspace', 'n8nac-config.json');
  const localConfig = readJsonIfExists(configPath) || {};

  if (host) localConfig.host = host;
  if (projectId) localConfig.projectId = projectId;
  if (!localConfig.syncFolder) localConfig.syncFolder = 'workflows';

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(localConfig, null, 2)}\n`);
}

function writeIsolatedYagrConfig(tempHome) {
  const configPath = path.join(tempHome, 'yagr-config.json');
  const baseUrlEnvKey = `YAGR_${PROVIDER.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_BASE_URL`;
  const baseUrl = String(process.env[baseUrlEnvKey] || '').trim() || getDefaultBaseUrlForProvider(PROVIDER);
  const localConfig = {
    provider: PROVIDER,
    model: MODEL,
    ...(baseUrl ? { baseUrl } : {}),
  };

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(localConfig, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// Scenario runner
// ---------------------------------------------------------------------------

async function runScenario(scenario, isolatedHome, testN8nRuntime) {
  const journal = [];
  const toolEvents = [];
  const envOverrides = {
    YAGR_HOME: isolatedHome,
    YAGR_LAUNCH_CWD: process.cwd(),
    YAGR_ALLOW_N8N_ENV: '1',
    YAGR_PREFER_ENV_CREDENTIALS: '1',
    ...(testN8nRuntime.host ? { N8N_HOST: testN8nRuntime.host } : {}),
    ...(testN8nRuntime.apiKey ? { N8N_API_KEY: testN8nRuntime.apiKey } : {}),
    ...(testN8nRuntime.projectId ? { N8N_PROJECT_ID: testN8nRuntime.projectId } : {}),
  };

  return await withScopedEnv(envOverrides, async () => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error(`Timeout after ${scenario.timeoutMs}ms`)),
      scenario.timeoutMs,
    );

    try {
      const engine = await createN8nEngineFromWorkspace();
      const agent = new YagrAgent(engine);
      const result = await agent.run(scenario.prompt, {
        provider: PROVIDER,
        model: MODEL,
        maxSteps: scenario.maxSteps,
        abortSignal: controller.signal,
        onToolEvent: async (event) => { toolEvents.push(event); },
        onJournalEntry: async (entry) => { journal.push(entry); },
      });

      const mergedJournal = result.journal?.length ? result.journal : journal;
      const outcome = analyzeRunOutcome(mergedJournal);
      const assertion = scenario.assert(result, outcome, toolEvents);

      return {
        status: assertion.pass ? 'PASS' : 'FAIL',
        note: assertion.note,
        text: result.text || '',
        steps: result.steps || 0,
        timedOut: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const timedOut = /timeout after/i.test(message);
      return {
        status: 'FAIL',
        note: timedOut ? `Timeout après ${scenario.timeoutMs}ms.` : message.slice(0, 200),
        text: '',
        steps: 0,
        timedOut,
      };
    } finally {
      clearTimeout(timer);
    }
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const testN8nRuntime = resolveTestN8nRuntime();
const isolatedHome = createIsolatedHome(testN8nRuntime);

process.stdout.write(`Scenario integration test\n`);
process.stdout.write(`Provider: ${PROVIDER}  Model: ${MODEL}\n`);
process.stdout.write(`n8n: ${testN8nRuntime.configured ? testN8nRuntime.host : 'not configured'}\n`);
process.stdout.write(`Isolated home: ${isolatedHome}\n\n`);

const scenariosToRun = SCENARIOS.filter((s) =>
  requestedScenarioIds.length === 0 || requestedScenarioIds.includes(s.id));

const results = [];

for (const scenario of scenariosToRun) {
  const skipped = scenario.n8nRequired && !testN8nRuntime.configured;
  process.stdout.write(`Running [${scenario.id}] ${scenario.name}…\n`);

  if (skipped) {
    results.push({ scenario, status: 'SKIP', note: 'n8n non configuré.', steps: 0, timedOut: false });
    process.stdout.write(`  → SKIP (n8n not configured)\n`);
    continue;
  }

  const result = await runScenario(scenario, isolatedHome, testN8nRuntime);
  results.push({ scenario, ...result });
  process.stdout.write(`  → ${result.status} — ${result.note}\n`);
}

// Cleanup
try { fs.rmSync(isolatedHome, { recursive: true, force: true }); } catch { /* best effort */ }

process.stdout.write('\n');
printTable(results);

if (!markdownDisabled) {
  writeMarkdownReport(results);
  process.stdout.write(`\nMarkdown report: ${markdownPath}\n`);
}

const failed = results.filter((r) => r.status === 'FAIL');
if (strict && failed.length > 0) {
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function printTable(rows) {
  const headers = ['ID', 'Nom', 'Status', 'Steps', 'Note'];
  const data = rows.map((r) => [
    r.scenario.id,
    r.scenario.name,
    r.status,
    String(r.steps || 0),
    truncate(r.note || '', 80),
  ]);

  const widths = headers.map((h, i) =>
    Math.max(h.length, ...data.map((row) => row[i].length)));

  const sep = `+-${widths.map((w) => '-'.repeat(w)).join('-+-')}-+`;
  process.stdout.write(`${sep}\n`);
  process.stdout.write(`| ${headers.map((h, i) => h.padEnd(widths[i])).join(' | ')} |\n`);
  process.stdout.write(`${sep}\n`);
  for (const row of data) {
    process.stdout.write(`| ${row.map((cell, i) => cell.padEnd(widths[i])).join(' | ')} |\n`);
  }
  process.stdout.write(`${sep}\n`);

  const pass = rows.filter((r) => r.status === 'PASS').length;
  const fail = rows.filter((r) => r.status === 'FAIL').length;
  const skip = rows.filter((r) => r.status === 'SKIP').length;
  process.stdout.write(`\nSummary: ${pass} PASS, ${fail} FAIL, ${skip} SKIP\n`);
}

function writeMarkdownReport(rows) {
  const pass = rows.filter((r) => r.status === 'PASS').length;
  const fail = rows.filter((r) => r.status === 'FAIL').length;
  const skip = rows.filter((r) => r.status === 'SKIP').length;

  const lines = [
    '# Scenario Integration Report',
    '',
    `- Generated at: ${new Date().toISOString()}`,
    `- Provider: \`${PROVIDER}\``,
    `- Model: \`${MODEL}\``,
    `- n8n: \`${testN8nRuntime.configured ? testN8nRuntime.host : 'not configured'}\``,
    '',
    '## Summary',
    '',
    `| Status | Count |`,
    `| --- | ---: |`,
    `| PASS | ${pass} |`,
    `| FAIL | ${fail} |`,
    `| SKIP | ${skip} |`,
    '',
    '## Scenario Results',
    '',
    '| ID | Name | Status | Steps | Note |',
    '| --- | --- | --- | ---: | --- |',
    ...rows.map((r) =>
      `| \`${escapeMd(r.scenario.id)}\` | ${escapeMd(r.scenario.name)} | **${r.status}** | ${r.steps || 0} | ${escapeMd(truncate(r.note || '', 200))} |`),
    '',
    '## Scenario Details',
    '',
    ...rows.flatMap((r) => [
      `### ${r.scenario.id} — ${r.scenario.name}`,
      '',
      `- **Status:** ${r.status}`,
      `- **Steps:** ${r.steps || 0}`,
      `- **Note:** ${r.note || 'n/a'}`,
      `- **Prompt:** ${r.scenario.prompt.slice(0, 200)}`,
      ...(r.text ? ['', '**Response (truncated):**', '', '```text', r.text.slice(0, 500), '```'] : []),
      '',
    ]),
  ];

  fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
  fs.writeFileSync(markdownPath, lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

async function withScopedEnv(overrides, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined || value === null || value === '') {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function copyIfExists(source, destination) {
  if (!source || !fs.existsSync(source)) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function copyDirIfExists(sourceDir, destinationDir) {
  if (!sourceDir || !fs.existsSync(sourceDir)) return;
  fs.mkdirSync(path.dirname(destinationDir), { recursive: true });
  fs.cpSync(sourceDir, destinationDir, { recursive: true });
}

function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function toInt(input, fallback) {
  const value = Number.parseInt(String(input ?? ''), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function escapeMd(text) {
  return String(text).replace(/\|/g, '\\|');
}
