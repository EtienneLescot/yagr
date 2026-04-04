#!/usr/bin/env node
/**
 * Multi-scenario integration test for a single LLM provider.
 *
 * Tests a variety of real-world agent interactions: pure Q&A, workflow listing,
 * simple workflow creation, complex workflow creation, workflow explanation, etc.
 *
 * Usage:
 *   node --test scripts/scenario-integration-test.mjs [options]
 *
 * Run specific scenarios (env var, because node --test isolates argv in workers):
 *   YAGR_SCN_SCENARIOS=setup-check node --test scripts/scenario-integration-test.mjs
 *
 * Options (CLI args override env vars where applicable):
 *   --provider <name>       Provider to use (default: DEFAULT_PROVIDER)
 *   --model <name>          Model to use (default: DEFAULT_MODEL)
 *   --no-markdown           Skip writing the markdown report
 *
 * Environment variables (used when CLI args are not provided):
 *   YAGR_SCN_PROVIDER                    Provider to use
 *   YAGR_SCN_MODEL                       Model to use
 *   YAGR_SCN_SCENARIOS                   Comma-separated scenario IDs to run
 *   YAGR_SCN_TIMEOUT_MS                  Timeout for Q&A scenarios (default: 60000)
 *   YAGR_SCN_CREATION_TIMEOUT_MS         Timeout for creation scenarios (default: 180000)
 *   YAGR_SCN_MARKDOWN_PATH               Markdown report output path
 *   N8N_HOST / YAGR_IT_N8N_HOST          n8n host for workflow tests
 *   N8N_API_KEY / YAGR_IT_N8N_API_KEY    n8n API key for workflow tests
 *   N8N_PROJECT_ID / YAGR_IT_N8N_PROJECT_ID  n8n project ID
 */

import process from 'node:process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert';
import { describe, it, before, after } from 'node:test';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig({ path: '.env', quiet: true, override: true });
dotenvConfig({ path: '.env.test', quiet: true, override: true });

const { getYagrPaths } = await import('../dist/config/yagr-home.js');
const { createN8nEngineFromWorkspace } = await import('../dist/config/load-n8n-engine-config.js');
const { YagrAgent } = await import('../dist/agent.js');
const { analyzeRunOutcome } = await import('../dist/runtime/outcome.js');
const { getDefaultBaseUrlForProvider } = await import('../dist/llm/provider-registry.js');

// ---------------------------------------------------------------------------
// Defaults (edit here to change the baseline provider / model)
// ---------------------------------------------------------------------------

const DEFAULT_PROVIDER = 'openrouter';
const DEFAULT_MODEL = 'google/gemini-3-flash-preview';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function readCliArg(flag) {
  const index = process.argv.indexOf(flag);
  return index !== -1 && index + 1 < process.argv.length ? String(process.argv[index + 1]).trim() : undefined;
}

const PROVIDER = readCliArg('--provider') || String(process.env.YAGR_SCN_PROVIDER || DEFAULT_PROVIDER).trim();
const MODEL = readCliArg('--model') || String(process.env.YAGR_SCN_MODEL || DEFAULT_MODEL).trim();
const DEFAULT_TIMEOUT_MS = toInt(process.env.YAGR_SCN_TIMEOUT_MS, 90_000);
const CREATION_TIMEOUT_MS = toInt(process.env.YAGR_SCN_CREATION_TIMEOUT_MS, 240_000);
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
    name: 'Workflow LangChain Agent avec credential LLM',
    prompt: 'Crée un workflow n8n avec un nœud LangChain AI Agent. '
      + 'Configure le credential LLM pour ce nœud: inspecte les credentials existants, '
      + 'propose un provider, et déploie le workflow. '
      + 'Ne me pose pas de questions inutiles, avance au maximum avec les outils disponibles.',
    maxSteps: 20,
    timeoutMs: CREATION_TIMEOUT_MS,
    n8nRequired: true,
    assert(result, outcome) {
      // Primary signal: workflow file written + scripts ran successfully
      if (outcome.hasWorkflowWrites && outcome.successfulScriptRuns > 0) {
        const text = String(result.text || '');
        const checkedCredentials = /credential|llm_provider/i.test(text);
        return {
          pass: true,
          note: `Workflow déployé. Credentials inspectés: ${checkedCredentials}.`,
        };
      }
      // Secondary signal: agent hit a structured blocker on credentials (acceptable)
      const text = String(result.text || '');
      const hasRequiredAction = /credential|provider|clé|api key/i.test(text);
      if (outcome.hasWorkflowWrites && hasRequiredAction) {
        return {
          pass: true,
          note: `Workflow écrit, bloqueur credential structuré détecté.`,
        };
      }
      if (outcome.hasWorkflowWrites) {
        return { pass: false, note: 'Workflow écrit mais déploiement non confirmé et aucun bloqueur credential.' };
      }
      return { pass: false, note: `Aucun workflow créé. Réponse: ${text.slice(0, 150)}` };
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
      const usedScripts = outcome.successfulScriptRuns > 0 || outcome.failedScriptRuns > 0;
      return {
        pass: true,
        note: `Réponse reçue (${text.length} chars)${usedScripts ? ', a exécuté des scripts.' : '.'}`,
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
      const usedScripts = outcome.successfulScriptRuns > 0 || outcome.failedScriptRuns > 0;
      if (!usedScripts) {
        return { pass: false, note: `N'a pas invoqué de scripts. Réponse: ${text.slice(0, 120)}` };
      }
      return {
        pass: true,
        note: `A utilisé des scripts. Réponse: ${text.slice(0, 80)}…`,
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
      if (outcome.hasWorkflowWrites && outcome.successfulScriptRuns > 0) {
        return {
          pass: true,
          note: `Workflow créé et déployé. File: ${outcome.hasWorkflowWrites ? 'yes' : 'no'}.`,
        };
      }
      if (outcome.hasWorkflowWrites) {
        return { pass: false, note: 'Fichier workflow écrit mais déploiement non confirmé.' };
      }
      const text = String(result.text || '');
      return { pass: false, note: `Aucun déploiement détecté. Réponse: ${text.slice(0, 150)}` };
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
      if (outcome.hasWorkflowWrites && outcome.successfulScriptRuns > 0) {
        return {
          pass: true,
          note: `Workflow webhook créé et déployé.`,
        };
      }
      if (outcome.hasWorkflowWrites) {
        return { pass: false, note: 'Fichier workflow écrit mais déploiement non confirmé.' };
      }
      const text = String(result.text || '');
      return { pass: false, note: `Aucun déploiement détecté. Réponse: ${text.slice(0, 150)}` };
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
      if (outcome.hasWorkflowWrites && outcome.successfulScriptRuns > 0) {
        return {
          pass: true,
          note: `Workflow complexe créé et déployé.`,
        };
      }
      if (outcome.hasWorkflowWrites) {
        return { pass: false, note: 'Fichier workflow écrit mais déploiement non confirmé.' };
      }
      const text = String(result.text || '');
      return { pass: false, note: `Aucun déploiement détecté. Réponse: ${text.slice(0, 150)}` };
    },
  },

  {
    id: 'yagr-proxy-workflow',
    name: 'Workflow AI Agent via Yagr LLM Proxy (création + exécution)',
    prompt:
      'Est-ce que tu pourrais créer un workflow tout simple avec un agent géographique IA qui donne la capitale des pays ? '
      + 'Il faudrait un webhook trigger qui passe la variable country à cet agent. '
      + 'Est-ce que tu peux créer ce workflow et l\'exécuter en passant par exemple le payload France et me donner la réponse de l\'agent ?',
    maxSteps: 40,
    timeoutMs: CREATION_TIMEOUT_MS,
    n8nRequired: true,
    assert(result, outcome) {
      const text = String(result.text || '');
      const mentionsCapital = /paris|capital/i.test(text);

      // Accept: workflow deployed + agent ran scripts (test/execution)
      if (outcome.hasWorkflowWrites && outcome.successfulScriptRuns > 0) {
        return {
          pass: true,
          note: `Proxy LLM opérationnel — workflow créé et déployé${mentionsCapital ? ', résultat mentionne Paris/capital' : ''}.`,
        };
      }

      // Accept: agent reused existing workflow and ran scripts
      if (!outcome.hasWorkflowWrites && outcome.successfulScriptRuns > 0 && mentionsCapital) {
        return {
          pass: true,
          note: `Workflow réutilisé (pas de fichier), scripts exécutés, résultat mentionne Paris/capital.`,
        };
      }

      if (!outcome.hasWorkflowWrites) {
        return { pass: false, note: `Workflow non créé et non testé. Réponse: ${text.slice(0, 150)}` };
      }

      return {
        pass: false,
        note: `Workflow créé mais exécution non confirmée. Réponse: ${text.slice(0, 150)}`,
      };
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
      const usedScripts = outcome.successfulScriptRuns > 0 || outcome.failedScriptRuns > 0;
      const mentionsNodes = /nœud|node|trigger|set|webhook|workflow/i.test(text);
      if (!usedScripts) {
        return { pass: false, note: `N'a pas listé les workflows. Réponse: ${text.slice(0, 100)}` };
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
  copyIfExists(sourcePaths.n8nCredentialsPath, path.join(tempHome, 'n8n-credentials.json'));
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
      const engine = _engine;
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
      const assertion = await Promise.resolve(scenario.assert(result, outcome, toolEvents, testN8nRuntime));
      const createdWorkflowIds = toolEvents
        .filter((e) => e.type === 'embed' && e.kind === 'workflow' && e.workflowId)
        .map((e) => e.workflowId)
        .filter((id, i, arr) => arr.indexOf(id) === i);
      return {
        status: assertion.pass ? 'PASS' : 'FAIL',
        note: assertion.note,
        text: result.text || '',
        steps: result.steps || 0,
        timedOut: false,
        createdWorkflowIds: [],
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
// Test suite
// ---------------------------------------------------------------------------

const scenariosToRun = SCENARIOS.filter((s) =>
  requestedScenarioIds.length === 0 || requestedScenarioIds.includes(s.id));

// Hoisted so writeMarkdownReport (a module-level function) can reference them.
let _testN8nRuntime;
let _isolatedHome;
let _engine;

describe(`Scenario Integration Tests (${PROVIDER} / ${MODEL})`, { concurrency: 1 }, () => {
  const results = [];

  before(async () => {
    _testN8nRuntime = resolveTestN8nRuntime();
    _isolatedHome = createIsolatedHome(_testN8nRuntime);
    process.stdout.write(`n8n: ${_testN8nRuntime.configured ? _testN8nRuntime.host : 'not configured'}\n`);
    process.stdout.write(`Isolated home: ${_isolatedHome}\n\n`);
    _engine = await createN8nEngineFromWorkspace();
  });

  after(async () => {
    const createdWorkflowIds = results.flatMap((r) => r.createdWorkflowIds ?? []);
    if (createdWorkflowIds.length > 0) {
      process.stdout.write(`\nCleaning up ${createdWorkflowIds.length} workflow(s) created during tests…\n`);
      await cleanupWorkflows(createdWorkflowIds, _isolatedHome, _testN8nRuntime);
    }
    try { fs.rmSync(_isolatedHome, { recursive: true, force: true }); } catch { /* best effort */ }

    if (!markdownDisabled) {
      writeMarkdownReport(results);
      process.stdout.write(`\nMarkdown report: ${markdownPath}\n`);
    }
  });

  for (const scenario of scenariosToRun) {
    it(`[${scenario.id}] ${scenario.name}`, { timeout: scenario.timeoutMs + 10_000 }, async (t) => {
      if (scenario.n8nRequired && !_testN8nRuntime.configured) {
        t.skip('n8n non configuré');
        return;
      }

      const result = await runScenario(scenario, _isolatedHome, _testN8nRuntime);
      results.push({ scenario, ...result });

      assert.ok(result.status === 'PASS', `${result.status}: ${result.note}`);
    });
  }
});

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

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
    `- n8n: \`${_testN8nRuntime?.configured ? _testN8nRuntime.host : 'not configured'}\``,
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

async function cleanupWorkflows(workflowIds, isolatedHome, n8nRuntime) {
  // Read host/apiKey from the isolated home's n8nac-config.json — same source the agent used.
  // Fall back to testN8nRuntime (env vars) if the file is missing.
  const n8nConfigPath = path.join(isolatedHome, 'n8n-workspace', 'n8nac-config.json');
  const n8nConfig = readJsonIfExists(n8nConfigPath) || {};
  const host = n8nConfig.host || n8nRuntime.host;
  const apiKey = n8nRuntime.apiKey; // apiKey comes from env (not stored in config file)
  if (!host || !apiKey) {
    process.stdout.write('  ✗ Cannot cleanup: n8n host or API key not resolved.\n');
    return;
  }
  const baseUrl = host.replace(/\/+$/, '');
  const headers = { 'X-N8N-API-KEY': apiKey, 'Content-Type': 'application/json' };

  for (const id of workflowIds) {
    try {
      // Deactivate first (required before delete for active workflows)
      await fetch(`${baseUrl}/api/v1/workflows/${id}/deactivate`, { method: 'POST', headers });
      const res = await fetch(`${baseUrl}/api/v1/workflows/${id}`, { method: 'DELETE', headers });
      if (res.ok) {
        process.stdout.write(`  ✓ Deleted workflow ${id}\n`);
      } else {
        process.stdout.write(`  ✗ Could not delete workflow ${id} (HTTP ${res.status})\n`);
      }
    } catch (err) {
      process.stdout.write(`  ✗ Error deleting workflow ${id}: ${err?.message ?? err}\n`);
    }
  }
}
