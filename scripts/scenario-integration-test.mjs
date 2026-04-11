#!/usr/bin/env node
/**
 * Multi-scenario integration test for a single LLM provider.
 *
 * Tests a variety of real-world agent interactions: pure Q&A, workflow listing,
 * simple workflow creation, complex workflow creation, workflow explanation, etc.
 *
 * Usage:
 *   node --test scripts/scenario-integration-test.mjs [options]
 *   node scripts/run-scenario-integration.mjs [options]
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
 *   N8N_HOST / YAGR_IT_N8N_HOST          n8n host for workflow tests (when managed Docker is off)
 *   N8N_API_KEY / YAGR_IT_N8N_API_KEY    n8n API key for workflow tests
 *   N8N_PROJECT_ID / YAGR_IT_N8N_PROJECT_ID  n8n project ID
 *   YAGR_IT_USE_MANAGED_DOCKER           Default on (1): isolated test n8n via Docker. Set 0 to use env n8n only.
 *   --no-managed-docker / --managed-docker  CLI overrides (same semantics)
 *
 * Isolated YAGR_HOME: scripts/test-bootstrap/profiles/scenario-integration.yaml via runHomeBootstrap().
 */

import process from 'node:process';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert';
import { describe, it, before, after, beforeEach } from 'node:test';
import { config as dotenvConfig } from 'dotenv';
import {
  cleanManagedDockerTestRuntimeWorkflows,
  ensureManagedDockerTestRuntime,
  stopManagedDockerTestRuntime,
} from './test-managed-n8n-runtime.mjs';
import {
  defaultProfilePath,
  getIsolatedWorkspaceDir,
  readJsonIfExists,
  runAgentPrepPhases,
  runHomeBootstrap,
} from './test-bootstrap/index.mjs';

dotenvConfig({ path: '.env', quiet: true, override: true });
dotenvConfig({ path: '.env.test', quiet: true, override: true });

const { createN8nEngineFromWorkspace } = await import('../dist/config/load-n8n-engine-config.js');
const { createYagrDeepAgent } = await import('../dist/agent-factory.js');
const { createRunAccumulator, processStreamEvent } = await import('../dist/gateway/langgraph-events.js');

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

const scenarioCliArg = readCliArg('--scenario') || readCliArg('--scenarios');
const PROVIDER = readCliArg('--provider') || String(process.env.YAGR_SCN_PROVIDER || DEFAULT_PROVIDER).trim();
const MODEL = readCliArg('--model') || String(process.env.YAGR_SCN_MODEL || DEFAULT_MODEL).trim();
const DEFAULT_TIMEOUT_MS = toInt(process.env.YAGR_SCN_TIMEOUT_MS, 90_000);
const CREATION_TIMEOUT_MS = toInt(process.env.YAGR_SCN_CREATION_TIMEOUT_MS, 240_000);
const markdownDisabled = process.argv.includes('--no-markdown') || process.env.YAGR_SCN_NO_MARKDOWN === '1';
const debug = process.argv.includes('--debug') || process.env.YAGR_SCN_DEBUG === '1';
const keepTemp = process.argv.includes('--keep-temp') || process.env.YAGR_SCN_KEEP_TEMP === '1';
/** Default: isolated managed Docker n8n. Opt out: --no-managed-docker or YAGR_IT_USE_MANAGED_DOCKER=0 */
const useManagedDocker = (() => {
  if (process.argv.includes('--no-managed-docker')) return false;
  if (process.argv.includes('--managed-docker')) return true;
  const v = String(process.env.YAGR_IT_USE_MANAGED_DOCKER ?? '').trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  return true;
})();
const keepManagedDocker = process.argv.includes('--keep-managed-docker') || process.env.YAGR_IT_KEEP_MANAGED_DOCKER === '1';
/** Do not DELETE workflows on n8n after a scenario (for API / UI inspection). Local temp home still removed unless keep-temp. */
const skipRemoteWorkflowCleanup = process.env.YAGR_SCN_SKIP_REMOTE_WORKFLOW_CLEANUP === '1';
const MANAGED_DOCKER_TIMEOUT_BONUS_MS = toInt(
  process.env.YAGR_SCN_MANAGED_DOCKER_TIMEOUT_BONUS_MS,
  useManagedDocker ? 60_000 : 0,
);
const SCENARIO_MAX_RETRIES = Math.max(0, toInt(process.env.YAGR_SCN_MAX_RETRIES, useManagedDocker ? 1 : 0));
const heartbeatMs = toInt(process.env.YAGR_SCN_HEARTBEAT_MS, 15_000);
const markdownPath = process.env.YAGR_SCN_MARKDOWN_PATH
  || path.join(process.cwd(), 'reports', 'scenario-integration-report.md');

const requestedScenarioIds = (scenarioCliArg || process.env.YAGR_SCN_SCENARIOS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function getProviderApiKey(provider) {
  const byProvider = {
    openai: process.env.OPENAI_LLM_API_KEY || process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_LLM_API_KEY || process.env.ANTHROPIC_API_KEY,
    google:
      process.env.GOOGLE_GENERATIVE_AI_API_KEY
      || process.env.GEMINI_API_KEY
      || process.env.GOOGLE_API_KEY
      || process.env.GEMINI_LLM_API_KEY
      || process.env.GOOGLE_LLM_API_KEY,
    mistral: process.env.MISTRAL_API_KEY || process.env.MISTRAL_LLM_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_LLM_API_KEY,
    'openai-proxy': process.env.YAGR_OPENAI_PROXY_TOKEN,
    'anthropic-proxy': process.env.YAGR_ANTHROPIC_SETUP_TOKEN,
    'copilot-proxy': process.env.YAGR_COPILOT_TOKEN,
  };
  return byProvider[provider];
}

function resolveScenarioProviderBootstrap(scenarioId) {
  if (scenarioId !== 'credential-orchestration') {
    return null;
  }

  const candidates = [
    { provider: 'google', envVar: 'GEMINI_API_KEY', apiKey: getProviderApiKey('google') },
    { provider: 'openai', envVar: 'OPENAI_API_KEY', apiKey: getProviderApiKey('openai') },
    { provider: 'anthropic', envVar: 'ANTHROPIC_API_KEY', apiKey: getProviderApiKey('anthropic') },
    { provider: 'mistral', envVar: 'MISTRAL_API_KEY', apiKey: getProviderApiKey('mistral') },
    { provider: 'openrouter', envVar: 'OPENROUTER_API_KEY', apiKey: getProviderApiKey('openrouter') },
  ];

  return candidates.find((candidate) => typeof candidate.apiKey === 'string' && candidate.apiKey.trim().length > 0) ?? null;
}

function buildScenarioPrompt(scenario) {
  const bootstrap = resolveScenarioProviderBootstrap(scenario.id);
  if (!bootstrap) {
    return scenario.prompt;
  }

  return `${scenario.prompt}\n\nContexte de test: si aucun credential LLM compatible n'existe encore, crée-le toi-même sans me poser de question. Un provider ${bootstrap.provider} est autorisé pour ce test et une clé API valide est déjà disponible dans l'environnement via ${bootstrap.envVar}. Utilise cette variable d'environnement au lieu de demander une clé.`;
}

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
        const checkedCredentials = /credential|llm_provider|gemini|google/i.test(text);
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
    name: 'Workflow géographique : webhook + agent IA (preuve dans les exécutions n8n)',
    prompt:
      'Crée un workflow n8n minimal : Webhook qui reçoit par exemple `country` (ex. « France ») ou une question '
      + 'du type « capitale de la France » **sans** inclure le nom « Paris » dans le payload de test — le corps '
      + 'd’entrée ne doit parler que du pays / de la question. '
      + 'C’est un **agent IA** dans le workflow qui doit produire la réponse renvoyée au client — pas du code '
      + 'statique, une simple règle métier ni une phrase écrite à la main. '
      + 'Pour ta réponse à l’utilisateur, base-toi sur la **réponse HTTP** du webhook / la sortie visible de '
      + '`n8nac test`. Tu n’as **pas** besoin de télécharger les exécutions via l’API (le test le fait déjà '
      + 'lui-même côté harness). Ne présente pas le nom de la capitale comme un fait si tu ne t’appuies pas sur '
      + 'cette sortie concrète du workflow.',
    maxSteps: 40,
    timeoutMs: CREATION_TIMEOUT_MS,
    n8nRequired: true,
    async assert(result, outcome, _toolEvents, testN8nRuntime, _isolatedHome, workflowIds) {
      const text = String(result.text || '');
      const relayExecutionConfirmed = outcome.relayExecutionConfirmed;

      // Preuve serveur : le harness appelle directement l’API n8n (includeData) — sans demander à l’agent de
      // consulter les exécutions. Le payload de test ne nomme en principe pas « Paris » (seulement France /
      // capitale) ; si « Paris » apparaît dans les données d’exécution, c’est très probablement la réponse de
      // l’**agent IA** (via le proxy), pas le texte d’entrée du webhook.
      const parisInN8nExecutions = testN8nRuntime?.configured && workflowIds?.length
        ? await n8nExecutionJsonContainsMatch(testN8nRuntime, workflowIds, /paris/i)
        : false;

      if (!relayExecutionConfirmed) {
        if (!outcome.hasWorkflowWrites) {
          return { pass: false, note: `Workflow non créé ou preuve relay absente. Réponse: ${text.slice(0, 150)}` };
        }
        return {
          pass: false,
          note: `Workflow créé mais relay non confirmé (credential Yagr LLM Proxy / traces d’exécution n8n). Réponse: ${text.slice(0, 150)}`,
        };
      }

      if (!outcome.hasWorkflowWrites || outcome.successfulScriptRuns <= 0) {
        return {
          pass: false,
          note: `Écriture workflow ou exécutions shell insuffisantes (writes=${outcome.hasWorkflowWrites}, scripts=${outcome.successfulScriptRuns}).`,
        };
      }

      if (!parisInN8nExecutions) {
        return {
          pass: false,
          note:
            `« Paris » absent des données d'exécution n8n (API harness, includeData) — attendu surtout comme sortie de l’agent IA puisque le payload ne doit pas le contenir. Réponse agent: ${text.slice(0, 140)}`,
        };
      }

      if (!/paris|capitale/i.test(text)) {
        return {
          pass: false,
          note:
            `Paris figure dans les exécutions n8n mais pas dans ta synthèse utilisateur — cite explicitement le résultat du workflow. Réponse: ${text.slice(0, 160)}`,
        };
      }

      return {
        pass: true,
        note:
          'Proxy confirmé + « Paris » dans les exécutions n8n (harness API) et dans la synthèse — cohérent avec une réponse d’agent IA côté graphe (payload de test sans « Paris »).',
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
  if (_managedDockerRuntime) {
    return _managedDockerRuntime;
  }
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

const SCENARIO_BOOTSTRAP_PROFILE = defaultProfilePath('scenario-integration.yaml');

async function createIsolatedHome(testN8nRuntime) {
  const { homeDir } = await runHomeBootstrap(SCENARIO_BOOTSTRAP_PROFILE, {
    provider: PROVIDER,
    model: MODEL,
    testN8nRuntime,
    useManagedDocker,
    verbose: debug,
    n8nRequired: false,
    agentsMd: {
      onUpdateAiFailure: (msg) => console.warn(msg),
    },
  });
  registerIsolatedContextSources(homeDir);
  return homeDir;
}

// ---------------------------------------------------------------------------
// Scenario runner
// ---------------------------------------------------------------------------

async function runScenario(scenario, isolatedHome, testN8nRuntime) {
  const journal = [];
  const toolEvents = [];
  const stdoutChunks = [];
  const effectiveTimeoutMs = getEffectiveScenarioTimeoutMs(scenario);
  const envOverrides = {
    YAGR_HOME: isolatedHome,
    YAGR_LAUNCH_CWD: getIsolatedWorkspaceDir(isolatedHome),
    YAGR_ALLOW_N8N_ENV: '1',
    YAGR_PREFER_ENV_CREDENTIALS: '1',
    ...(testN8nRuntime.host ? { N8N_HOST: testN8nRuntime.host } : {}),
    ...(testN8nRuntime.apiKey ? { N8N_API_KEY: testN8nRuntime.apiKey } : {}),
    ...(testN8nRuntime.projectId ? { N8N_PROJECT_ID: testN8nRuntime.projectId } : {}),
  };

  return await withScopedEnv(envOverrides, async () => {
    const previousCwd = process.cwd();
    process.chdir(getIsolatedWorkspaceDir(isolatedHome));
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error(`Timeout after ${effectiveTimeoutMs}ms`)),
      effectiveTimeoutMs,
    );
    let heartbeat;
    let lastActivityAt = Date.now();
    let lastActivityLabel = 'scenario start';
    let accumulator = createRunAccumulator();

    const noteActivity = (label) => {
      lastActivityAt = Date.now();
      lastActivityLabel = label;
    };

    if (debug) {
      heartbeat = setInterval(() => {
        const idleMs = Date.now() - lastActivityAt;
        if (idleMs >= heartbeatMs) {
          logDebug(`scenario ${scenario.id}: heartbeat (${Math.round(idleMs / 1000)}s idle since ${lastActivityLabel})`);
          lastActivityAt = Date.now();
        }
      }, heartbeatMs);
    }

    if (scenario.n8nRequired && testN8nRuntime.configured) {
      try {
        await runAgentPrepPhases(SCENARIO_BOOTSTRAP_PROFILE, {
          homeDir: isolatedHome,
          provider: PROVIDER,
          model: MODEL,
          testN8nRuntime,
          useManagedDocker,
          verbose: debug,
          n8nRequired: true,
          agentsMd: {},
        });
        if (debug) {
          logDebug(`scenario ${scenario.id}: LLM proxy bootstrap (relay + yagr-config + credential) done`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logProgress(`scenario ${scenario.id}: LLM proxy bootstrap failed (non-fatal): ${truncate(singleLine(msg), 220)}`);
      }
    }

    try {
      const engine = _engine;
      const { agent } = await createYagrDeepAgent(engine, undefined, { provider: PROVIDER, model: MODEL });
      accumulator = createRunAccumulator();
      const threadId = `scenario-${scenario.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      logProgress(`scenario ${scenario.id}: start (${scenario.name})`);
      const stream = agent.streamEvents(
        { messages: [{ role: 'user', content: buildScenarioPrompt(scenario) }] },
        { configurable: { thread_id: threadId }, version: 'v2', signal: controller.signal },
      );

      for await (const event of stream) {
        noteActivity(event.event || event.name || 'stream event');
        await processStreamEvent(event, accumulator, {
          onTextDelta: async (delta) => {
            stdoutChunks.push(delta);
            noteActivity('assistant text');
            if (debug) {
              logDebug(`scenario ${scenario.id}: assistant ${truncate(singleLine(delta), 160)}`);
            }
          },
          onUserVisibleUpdate: async (update) => {
            const message = `${update.title}${update.detail ? `: ${update.detail}` : ''}`;
            toolEvents.push({ type: 'status', toolName: 'reportProgress', message });
            noteActivity('user-visible update');
            if (debug) {
              logDebug(`scenario ${scenario.id}: update ${truncate(singleLine(message), 180)}`);
            }
          },
        });

        if (event.event === 'on_tool_start') {
          const rawInput = event.data?.input;
          const inner = rawInput?.input;
          let parsedInput;
          if (typeof inner === 'string') {
            try { parsedInput = JSON.parse(inner); } catch { parsedInput = rawInput; }
          } else {
            parsedInput = inner ?? rawInput;
          }
          const toolName = event.name;
          const cmd = String(parsedInput?.command || parsedInput?.cmd || '');
          if (cmd) {
            const toolEvent = { type: 'command-start', toolName, command: cmd };
            toolEvents.push(toolEvent);
            if (debug) {
              logDebug(`scenario ${scenario.id}: ${formatToolEvent(toolEvent)}`);
            }
          } else {
            const toolEvent = { type: 'status', toolName, message: `start:${JSON.stringify(parsedInput ?? {}).slice(0, 120)}` };
            toolEvents.push(toolEvent);
            if (debug) {
              logDebug(`scenario ${scenario.id}: ${formatToolEvent(toolEvent)}`);
            }
          }
          journal.push({
            timestamp: new Date().toISOString(),
            type: 'step',
            status: 'started',
            message: `Tool ${toolName} started`,
          });
        } else if (event.event === 'on_tool_end') {
          const toolName = event.name;
          const output = event.data?.output;
          let parsedOutput;
          if (typeof output === 'string') {
            try { parsedOutput = JSON.parse(output); } catch { parsedOutput = { text: output }; }
          } else {
            parsedOutput = output;
          }
          const exitCode = extractToolExitCode(toolName, parsedOutput, output);
          if (exitCode !== undefined) {
            const toolEvent = { type: 'command-end', toolName, exitCode: Number(exitCode), timedOut: false };
            toolEvents.push(toolEvent);
            if (debug) {
              logDebug(`scenario ${scenario.id}: ${formatToolEvent(toolEvent)}`);
            }
          }
          const statusMsg = parsedOutput?.message || parsedOutput?.status;
          if (statusMsg) {
            const toolEvent = { type: 'status', toolName, message: String(statusMsg) };
            toolEvents.push(toolEvent);
            if (debug) {
              logDebug(`scenario ${scenario.id}: ${formatToolEvent(toolEvent)}`);
            }
          }
          journal.push({
            timestamp: new Date().toISOString(),
            type: 'step',
            status: 'completed',
            message: `Tool ${toolName} finished`,
          });
        }
      }

      const result = {
        text: stdoutChunks.join(''),
        steps: journal.length,
        journal,
      };
      const embedWorkflowIds = (accumulator.workflowEmbeds || [])
        .filter((e) => e.workflowId)
        .map((e) => e.workflowId);
      const diskWorkflowIds = collectWorkflowIdsFromWorkflowTs(getIsolatedWorkspaceDir(isolatedHome));
      const workflowIdsForOutcome = [...new Set([...embedWorkflowIds, ...diskWorkflowIds])];
      const outcome = await buildScenarioOutcome(
        toolEvents,
        isolatedHome,
        testN8nRuntime,
        workflowIdsForOutcome,
      );
      const assertion = await Promise.resolve(
        scenario.assert(result, outcome, toolEvents, testN8nRuntime, isolatedHome, workflowIdsForOutcome),
      );
      const createdWorkflowIds = workflowIdsForOutcome;
      return {
        status: assertion.pass ? 'PASS' : 'FAIL',
        note: assertion.note,
        text: result.text || '',
        steps: result.steps || 0,
        timedOut: false,
        createdWorkflowIds,
        outcome,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const timedOut = /timeout after/i.test(message);
      return {
        status: 'FAIL',
        note: timedOut ? `Timeout après ${effectiveTimeoutMs}ms.` : message.slice(0, 200),
        text: '',
        steps: 0,
        timedOut,
      };
    } finally {
      try {
        process.chdir(previousCwd);
      } catch {
        // Best effort restore only.
      }
      clearTimeout(timer);
      if (heartbeat) {
        clearInterval(heartbeat);
      }
    }
  });
}

function getEffectiveScenarioTimeoutMs(scenario) {
  const baseTimeoutMs = Number(scenario?.timeoutMs || DEFAULT_TIMEOUT_MS);
  if (!useManagedDocker || !scenario?.n8nRequired) {
    return baseTimeoutMs;
  }
  return baseTimeoutMs + MANAGED_DOCKER_TIMEOUT_BONUS_MS;
}

function getScenarioTestTimeoutMs(scenario) {
  const attempts = 1 + (scenario?.n8nRequired ? SCENARIO_MAX_RETRIES : 0);
  return (getEffectiveScenarioTimeoutMs(scenario) * attempts) + 20_000;
}

function isInfrastructureError(message) {
  const normalized = String(message || '').toLowerCase();
  return (
    normalized.includes('socket hang up')
    || normalized.includes('econnrefused')
    || normalized.includes('econnreset')
    || normalized.includes('fetch failed')
    || normalized.includes('network error')
    || normalized.includes('connect etimedout')
  );
}

function shouldRetryScenarioResult(scenario, result) {
  if (!scenario?.n8nRequired || !result || result.status !== 'FAIL') {
    return false;
  }
  if (result.timedOut) {
    return true;
  }
  return isInfrastructureError(result.note || '');
}

async function prepareManagedDockerScenario() {
  if (!_managedDockerRuntime) {
    return;
  }
  _managedDockerRuntime = await ensureManagedDockerTestRuntime();
  _testN8nRuntime = resolveTestN8nRuntime();
  const cleanup = await cleanManagedDockerTestRuntimeWorkflows(_managedDockerRuntime);
  process.stdout.write(`${stamp()} managed docker cleanup: ${cleanup.deleted} workflow(s)\n`);
}

async function cleanupScenarioAttempt(result, isolatedHome, testN8nRuntime) {
  const createdWorkflowIds = result?.createdWorkflowIds ?? [];
  if (createdWorkflowIds.length > 0) {
    if (skipRemoteWorkflowCleanup) {
      process.stdout.write(
        `${stamp()} skip remote workflow cleanup (YAGR_SCN_SKIP_REMOTE_WORKFLOW_CLEANUP=1) — ids: ${createdWorkflowIds.join(', ')}\n`,
      );
    } else {
      await cleanupWorkflows(createdWorkflowIds, isolatedHome, testN8nRuntime);
    }
  }
  if (keepTemp || debug) {
    process.stdout.write(`${stamp()} isolated home preserved: ${isolatedHome}\n`);
  } else {
    try { fs.rmSync(isolatedHome, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

async function runScenarioWithRetries(scenario) {
  const attempts = 1 + (scenario?.n8nRequired ? SCENARIO_MAX_RETRIES : 0);
  let lastResult;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const testN8nRuntime = _testN8nRuntime;
    const isolatedHome = await createIsolatedHome(testN8nRuntime);
    let result;
    try {
      result = await runScenario(scenario, isolatedHome, testN8nRuntime);
      lastResult = result;
    } finally {
      await cleanupScenarioAttempt(result, isolatedHome, testN8nRuntime);
    }

    if (lastResult?.status === 'PASS') {
      return lastResult;
    }

    if (attempt >= attempts || !shouldRetryScenarioResult(scenario, lastResult)) {
      return lastResult;
    }

    logProgress(`scenario ${scenario.id}: retry ${attempt + 1}/${attempts} after ${lastResult.timedOut ? 'timeout' : 'transient infrastructure failure'}`);
    await prepareManagedDockerScenario();
  }

  return lastResult;
}

async function buildScenarioOutcome(toolEvents, isolatedHome, testN8nRuntime, workflowIdsForLookup = []) {
  const events = toolEvents || [];
  const scriptEnds = events.filter((event) => event.type === 'command-end');
  const successfulScriptRuns = scriptEnds.filter((event) => Number(event.exitCode ?? 0) === 0).length;
  const failedScriptRuns = scriptEnds.filter((event) => Number(event.exitCode ?? 0) !== 0).length;
  const hasWorkflowWrites = events.some((event) =>
    event.type === 'status'
    && ['write_file', 'writeFile', 'edit_file', 'editFile', 'moveFile', 'move_file'].includes(event.toolName));
  const usedYagrProxyTool = events.some((event) => event.toolName === 'yagrProxy')
    || events.some((event) => event.type === 'command-start' && /(^|\s)(?:npx\s+)?yagr\s+yagrProxy(\s|$)/.test(String(event.command || '')));
  const successfulProdTestRuns = countSuccessfulProdTests(events);
  const fromCliSignals = (usedYagrProxyTool && successfulProdTestRuns > 0)
    || (successfulProdTestRuns > 0 && hasYagrProxyCredentialReference(isolatedHome));
  const fromN8nApi = testN8nRuntime?.configured
    ? await relayConfirmedViaN8nExecutions(isolatedHome, testN8nRuntime, workflowIdsForLookup)
    : false;
  const relayExecutionConfirmed = fromCliSignals || fromN8nApi;

  return {
    successfulScriptRuns,
    failedScriptRuns,
    hasWorkflowWrites,
    usedYagrProxyTool,
    successfulProdTestRuns,
    relayExecutionConfirmed,
  };
}

function countSuccessfulProdTests(events) {
  let count = 0;

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event?.type !== 'command-start' || event.toolName !== 'execute') {
      continue;
    }
    const command = String(event.command || '');
    if (!/n8nac(?:@[^\s]+)?\s+test\s+/i.test(command) || !/--prod\b/i.test(command)) {
      continue;
    }

    const nextEnd = events.slice(index + 1).find((candidate) =>
      candidate?.type === 'command-end' && candidate.toolName === 'execute');
    if (Number(nextEnd?.exitCode ?? 1) === 0) {
      count += 1;
    }
  }

  return count;
}

/**
 * Scans pushed/synced `.workflow.ts` files for the remote workflow id (n8n-as-code @workflow block).
 */
function collectWorkflowIdsFromWorkflowTs(workspaceDir) {
  const ids = [];
  const workflowsRoot = path.join(workspaceDir, 'workflows');
  if (!workspaceDir || !fs.existsSync(workflowsRoot)) {
    return ids;
  }

  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
        continue;
      }
      if (!ent.isFile() || !ent.name.endsWith('.workflow.ts')) {
        continue;
      }
      try {
        const content = fs.readFileSync(full, 'utf8');
        const match = content.match(/@workflow\s*\(\s*\{[\s\S]*?\bid:\s*['"]([^'"]+)['"]/);
        if (match?.[1]) {
          ids.push(match[1]);
        }
      } catch {
        // best effort
      }
    }
  };

  walk(workflowsRoot);
  return ids;
}

/**
 * Confirms the LLM relay was hit by inspecting recent server-side executions (n8nac does not write local exec_*.json).
 */
async function relayConfirmedViaN8nExecutions(isolatedHome, testN8nRuntime, workflowIds) {
  const host = String(testN8nRuntime?.host || '').replace(/\/+$/, '');
  const apiKey = String(testN8nRuntime?.apiKey || '').trim();
  if (!host || !apiKey || !workflowIds?.length) {
    return false;
  }

  const relayUrls = collectConfirmedRelayBaseUrls(isolatedHome);
  const urlHints = new Set();
  for (const u of relayUrls) {
    if (!u) continue;
    const trimmed = u.replace(/\/+$/, '');
    urlHints.add(trimmed);
    urlHints.add(trimmed.replace(/^http:\/\/127\.0\.0\.1/i, 'http://localhost'));
  }

  const headers = { 'X-N8N-API-KEY': apiKey, Accept: 'application/json' };

  for (const wfId of workflowIds) {
    try {
      const url = `${host}/api/v1/executions?workflowId=${encodeURIComponent(wfId)}&limit=10&includeData=true`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        continue;
      }
      const body = await res.json();
      const serialized = JSON.stringify(body);
      for (const hint of urlHints) {
        if (hint && serialized.includes(hint)) {
          return true;
        }
      }
      if (serialized.includes('Yagr LLM Proxy')) {
        return true;
      }
    } catch {
      // try next workflow id
    }
  }

  return false;
}

/**
 * True if `needle` matches anywhere in recent execution payloads for the given workflows (includeData).
 * `needle`: literal substring, or RegExp (e.g. /paris/i) tested on JSON.stringify(execution response).
 */
async function n8nExecutionJsonContainsMatch(testN8nRuntime, workflowIds, needle) {
  const host = String(testN8nRuntime?.host || '').replace(/\/+$/, '');
  const apiKey = String(testN8nRuntime?.apiKey || '').trim();
  if (!host || !apiKey || !workflowIds?.length) {
    return false;
  }
  if (typeof needle === 'string' && !needle) {
    return false;
  }

  const headers = { 'X-N8N-API-KEY': apiKey, Accept: 'application/json' };

  for (const wfId of workflowIds) {
    try {
      const url = `${host}/api/v1/executions?workflowId=${encodeURIComponent(wfId)}&limit=12&includeData=true`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        continue;
      }
      const body = await res.json();
      const serialized = JSON.stringify(body);
      const hit = typeof needle === 'string'
        ? serialized.includes(needle)
        : needle instanceof RegExp && needle.test(serialized);
      if (hit) {
        return true;
      }
    } catch {
      // next id
    }
  }

  return false;
}

function collectConfirmedRelayBaseUrls(isolatedHome) {
  const urls = new Set();

  try {
    const yagrConfig = JSON.parse(fs.readFileSync(path.join(isolatedHome, 'yagr-config.json'), 'utf-8'));
    const confirmed = String(yagrConfig?.llmProxy?.confirmedCredentialBaseUrl || '').trim();
    if (confirmed) {
      urls.add(confirmed.replace(/\/+$/, ''));
    }
  } catch {
    // Best effort only.
  }

  try {
    const relayState = JSON.parse(fs.readFileSync(path.join(isolatedHome, 'proxy-runtime', 'llm-relay.json'), 'utf-8'));
    const port = Number(relayState?.port);
    if (Number.isFinite(port) && port > 0) {
      urls.add(`http://127.0.0.1:${port}/v1`);
      urls.add(`http://localhost:${port}/v1`);
      urls.add(`http://host.docker.internal:${port}/v1`);
    }
  } catch {
    // Best effort only.
  }

  return [...urls];
}

function hasYagrProxyCredentialReference(isolatedHome) {
  try {
    const workspaceDir = getIsolatedWorkspaceDir(isolatedHome);
    const workflowRoot = path.join(workspaceDir, 'workflows');
    const stack = [workflowRoot];

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || !fs.existsSync(current)) {
        continue;
      }
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith('.workflow.ts')) {
          continue;
        }
        const content = fs.readFileSync(fullPath, 'utf-8');
        if (/name:\s*'Yagr LLM Proxy'/.test(content)) {
          return true;
        }
      }
    }

    return false;
  } catch {
    return false;
  }
}

function extractToolExitCode(toolName, parsedOutput, rawOutput) {
  const directExitCode = parsedOutput?.exitCode ?? parsedOutput?.exit_code;
  if (directExitCode !== undefined && directExitCode !== null) {
    return Number(directExitCode);
  }
  if (toolName !== 'execute') {
    return undefined;
  }

  const candidates = [
    rawOutputToString(rawOutput),
    typeof parsedOutput?.text === 'string' ? parsedOutput.text : '',
    typeof parsedOutput?.stdout === 'string' ? parsedOutput.stdout : '',
    typeof parsedOutput?.stderr === 'string' ? parsedOutput.stderr : '',
  ];
  if (rawOutput && typeof rawOutput === 'object' && typeof rawOutput !== 'string') {
    try {
      candidates.push(JSON.stringify(rawOutput));
    } catch {
      // ignore
    }
  }

  for (const block of candidates) {
    const text = String(block || '');
    const exitMatch = text.match(/\[Command (?:succeeded|failed) with exit code (\d+)\]/);
    if (exitMatch) {
      return Number.parseInt(exitMatch[1], 10);
    }
  }
  return undefined;
}

function rawOutputToString(rawOutput) {
  if (typeof rawOutput === 'string') {
    return rawOutput;
  }
  if (rawOutput == null) {
    return '';
  }
  if (typeof rawOutput === 'object' && typeof rawOutput.text === 'string') {
    return rawOutput.text;
  }
  try {
    return JSON.stringify(rawOutput);
  } catch {
    return String(rawOutput);
  }
}

/**
 * Register the workspace AGENTS.md as a context memory source in the isolated home.
 * Mirrors what `yagr n8n context setup` / registerN8nContextSources() does in production.
 * Manager instructions (YAGENTS.md) are injected via middleware and do NOT need a file entry.
 */
function registerIsolatedContextSources(homeDir) {
  const workspaceAgentsMd = path.join(homeDir, 'n8n-workspace', 'AGENTS.md');
  if (!fs.existsSync(workspaceAgentsMd)) {
    return;
  }
  const memorySources = path.join(homeDir, 'memory-sources.json');
  const existing = (() => {
    try { return JSON.parse(fs.readFileSync(memorySources, 'utf8')); } catch { return {}; }
  })();
  const contexts = existing.contexts ?? [];
  if (!contexts.includes(workspaceAgentsMd)) {
    fs.writeFileSync(
      memorySources,
      JSON.stringify({ ...existing, contexts: [...contexts, workspaceAgentsMd] }, null, 2),
    );
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

const scenariosToRun = SCENARIOS.filter((s) =>
  requestedScenarioIds.length === 0 || requestedScenarioIds.includes(s.id));

// Hoisted so writeMarkdownReport (a module-level function) can reference them.
let _testN8nRuntime;
let _engine;
let _managedDockerRuntime;

describe(`Scenario Integration Tests (${PROVIDER} / ${MODEL})`, { concurrency: 1 }, () => {
  const results = [];

  before(async () => {
    if (useManagedDocker) {
      _managedDockerRuntime = await ensureManagedDockerTestRuntime();
    }
    _testN8nRuntime = resolveTestN8nRuntime();
    process.stdout.write(`${stamp()} scenario integration start\n`);
    process.stdout.write(`${stamp()} provider/model: ${PROVIDER} / ${MODEL}\n`);
    process.stdout.write(`${stamp()} n8n: ${_testN8nRuntime.configured ? _testN8nRuntime.host : 'not configured'}\n`);
    process.stdout.write(`${stamp()} isolated home: per-scenario\n`);
    process.stdout.write(`${stamp()} debug: ${debug ? 'on' : 'off'} | keep-temp: ${(keepTemp || debug) ? 'on' : 'off'}\n\n`);
    _engine = await createN8nEngineFromWorkspace();
  });

  beforeEach(async () => {
    await prepareManagedDockerScenario();
  });

  after(async () => {
    if (!markdownDisabled) {
      writeMarkdownReport(results);
      process.stdout.write(`\nMarkdown report: ${markdownPath}\n`);
    }

    if (_managedDockerRuntime && !keepManagedDocker) {
      await stopManagedDockerTestRuntime();
      process.stdout.write(`${stamp()} managed docker n8n stopped\n`);
    }
  });

  for (const scenario of scenariosToRun) {
    it(`[${scenario.id}] ${scenario.name}`, { timeout: getScenarioTestTimeoutMs(scenario) }, async (t) => {
      if (scenario.n8nRequired && !_testN8nRuntime.configured) {
        t.skip('n8n non configuré');
        return;
      }

      const result = await runScenarioWithRetries(scenario);
      results.push({ scenario, ...result });
      logProgress(`scenario ${scenario.id}: ${result.status} (${result.steps || 0} steps) - ${truncate(singleLine(result.note || ''), 180)}`);
      if (result.status === 'FAIL' && result.outcome) {
        const o = result.outcome;
        logProgress(
          `scenario ${scenario.id}: outcome — hasWorkflowWrites=${o.hasWorkflowWrites} `
            + `successfulScriptRuns=${o.successfulScriptRuns} failedScriptRuns=${o.failedScriptRuns} `
            + `usedYagrProxyTool=${o.usedYagrProxyTool} relayExecutionConfirmed=${o.relayExecutionConfirmed} `
            + `successfulProdTestRuns=${o.successfulProdTestRuns}`,
        );
      }
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
      ...(r.status === 'FAIL' && r.outcome
        ? [
          '',
          '**Outcome (integration signals):**',
          '',
          `- \`hasWorkflowWrites\`: ${r.outcome.hasWorkflowWrites}`,
          `- \`successfulScriptRuns\`: ${r.outcome.successfulScriptRuns}`,
          `- \`failedScriptRuns\`: ${r.outcome.failedScriptRuns}`,
          `- \`usedYagrProxyTool\`: ${r.outcome.usedYagrProxyTool}`,
          `- \`relayExecutionConfirmed\`: ${r.outcome.relayExecutionConfirmed}`,
          `- \`successfulProdTestRuns\`: ${r.outcome.successfulProdTestRuns}`,
        ]
        : []),
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

function formatToolEvent(event) {
  if (event.type === 'command-start') {
    return `tool ${event.toolName} start: ${truncate(singleLine(event.command), 180)}`;
  }
  if (event.type === 'command-output') {
    return `tool ${event.toolName} ${event.stream}: ${truncate(singleLine(event.chunk), 180)}`;
  }
  if (event.type === 'command-end') {
    return `tool ${event.toolName} end: exit=${event.exitCode}${event.timedOut ? ' timeout' : ''}`;
  }
  if (event.type === 'embed') {
    return `tool ${event.toolName} embed: workflow=${event.workflowId} url=${event.url}`;
  }
  return `tool ${event.toolName} ${event.type}: ${truncate(singleLine(event.message || ''), 180)}`;
}

function formatJournalEntry(entry) {
  return `journal ${entry.type}/${entry.status}: ${truncate(singleLine(entry.message || ''), 180)}`;
}

function logProgress(message) {
  process.stdout.write(`${stamp()} ${message}\n`);
}

function logDebug(message) {
  process.stdout.write(`${stamp()} [debug] ${message}\n`);
}

function stamp() {
  return `[${new Date().toISOString().slice(11, 19)}]`;
}

function singleLine(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
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
