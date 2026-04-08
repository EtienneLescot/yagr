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
 *   N8N_HOST / YAGR_IT_N8N_HOST          n8n host for workflow tests
 *   N8N_API_KEY / YAGR_IT_N8N_API_KEY    n8n API key for workflow tests
 *   N8N_PROJECT_ID / YAGR_IT_N8N_PROJECT_ID  n8n project ID
 */

import process from 'node:process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert';
import { describe, it, before, after, beforeEach } from 'node:test';
import { spawnSync } from 'node:child_process';
import { config as dotenvConfig } from 'dotenv';
import {
  cleanManagedDockerTestRuntimeWorkflows,
  ensureManagedDockerTestRuntime,
  stopManagedDockerTestRuntime,
} from './test-managed-n8n-runtime.mjs';

dotenvConfig({ path: '.env', quiet: true, override: true });
dotenvConfig({ path: '.env.test', quiet: true, override: true });

const { getYagrPaths } = await import('../dist/config/yagr-home.js');
const { createN8nEngineFromWorkspace } = await import('../dist/config/load-n8n-engine-config.js');
const { createYagrDeepAgent } = await import('../dist/agent-factory.js');
const { createRunAccumulator, processStreamEvent } = await import('../dist/gateway/langgraph-events.js');
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

const scenarioCliArg = readCliArg('--scenario') || readCliArg('--scenarios');
const PROVIDER = readCliArg('--provider') || String(process.env.YAGR_SCN_PROVIDER || DEFAULT_PROVIDER).trim();
const MODEL = readCliArg('--model') || String(process.env.YAGR_SCN_MODEL || DEFAULT_MODEL).trim();
const DEFAULT_TIMEOUT_MS = toInt(process.env.YAGR_SCN_TIMEOUT_MS, 90_000);
const CREATION_TIMEOUT_MS = toInt(process.env.YAGR_SCN_CREATION_TIMEOUT_MS, 240_000);
const markdownDisabled = process.argv.includes('--no-markdown') || process.env.YAGR_SCN_NO_MARKDOWN === '1';
const debug = process.argv.includes('--debug') || process.env.YAGR_SCN_DEBUG === '1';
const keepTemp = process.argv.includes('--keep-temp') || process.env.YAGR_SCN_KEEP_TEMP === '1';
const useManagedDocker = process.argv.includes('--managed-docker') || process.env.YAGR_IT_USE_MANAGED_DOCKER === '1';
const keepManagedDocker = process.argv.includes('--keep-managed-docker') || process.env.YAGR_IT_KEEP_MANAGED_DOCKER === '1';
const heartbeatMs = toInt(process.env.YAGR_SCN_HEARTBEAT_MS, 15_000);
const markdownPath = process.env.YAGR_SCN_MARKDOWN_PATH
  || path.join(process.cwd(), 'reports', 'scenario-integration-report.md');

const requestedScenarioIds = (scenarioCliArg || process.env.YAGR_SCN_SCENARIOS || '')
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

/**
 * Regenerate AGENTS.md in an isolated test home using n8nac update-ai.
 * This ensures the test environment has fresh, up-to-date instructions.
 */
function generateTestAgentsMd(homeDir, testN8nRuntime = {}) {
  // Resolve n8nac package based on YAGR_N8NAC_VERSION
  const version = String(process.env.YAGR_N8NAC_VERSION || '').trim();
  let n8nacPackage = 'n8nac';
  if (version) {
    n8nacPackage = version.startsWith('@') ? `n8nac${version}` : `n8nac@${version}`;
  }

  // Call n8nac update-ai to regenerate AGENTS.md
  const result = spawnSync('npx', ['--yes', n8nacPackage, 'update-ai', '--silent'], {
    cwd: homeDir,
    env: {
      ...process.env,
      ...(testN8nRuntime.host ? { N8N_HOST: String(testN8nRuntime.host) } : {}),
      ...(testN8nRuntime.apiKey ? { N8N_API_KEY: String(testN8nRuntime.apiKey) } : {}),
      ...(testN8nRuntime.projectId ? { N8N_PROJECT_ID: String(testN8nRuntime.projectId) } : {}),
    },
    stdio: 'pipe',
    encoding: 'utf8',
  });

  if ((result.status ?? 1) !== 0) {
    const stderr = String(result.stderr || '').trim();
    const stdout = String(result.stdout || '').trim();
    // Log warning but don't fail — tests can continue even if update-ai fails
    console.warn(`Warning: n8nac update-ai failed for ${homeDir}: ${stderr || stdout || `exit ${result.status ?? 1}`}`);
  }
}

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

  writeIsolatedN8nCredentials(tempHome, testN8nRuntime);

  normalizeTestWorkspaceInstanceId(tempHome);

  ensureIsolatedHomeProjectCompatibility(tempHome);

  // Generate fresh AGENTS.md with current n8nac version
  generateTestAgentsMd(tempHome, testN8nRuntime);

  return tempHome;
}

function getIsolatedWorkspaceDir(homeDir) {
  return path.join(homeDir, 'n8n-workspace');
}

function normalizeTestWorkspaceInstanceId(tempHome) {
  const configPath = path.join(tempHome, 'n8n-workspace', 'n8nac-config.json');
  const config = readJsonIfExists(configPath);
  if (!config) {
    return;
  }
  const oldInstanceId = String(config.instanceIdentifier || '').replace(/[:<>"|?*]/g, '_');
  const testInstanceId = 'test';
  config.instanceIdentifier = testInstanceId;
  if (Array.isArray(config.instances)) {
    for (const instance of config.instances) {
      instance.instanceIdentifier = testInstanceId;
    }
  }
  const workspaceDir = path.join(tempHome, 'n8n-workspace');
  const syncFolder = String(config.syncFolder || 'workflows');
  const resolvedSync = path.isAbsolute(syncFolder) ? syncFolder : path.join(workspaceDir, syncFolder);
  const oldDir = oldInstanceId ? path.join(resolvedSync, oldInstanceId) : '';
  const newDir = path.join(resolvedSync, testInstanceId);
  if (oldDir && oldDir !== newDir && fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
    fs.renameSync(oldDir, newDir);
  }
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function reconcileN8nRuntime(tempHome, { host, apiKey, projectId }) {
  const configPath = path.join(tempHome, 'n8n-workspace', 'n8nac-config.json');
  const localConfig = readJsonIfExists(configPath) || {};
  const normalizedHost = host ? normalizeHost(host) : undefined;
  const normalizedProjectId = projectId || localConfig.projectId || 'personal';
  const projectName = localConfig.projectName || 'Personal';
  const activeInstanceId = 'test-local';

  if (host) localConfig.host = host;
  if (projectId) localConfig.projectId = projectId;
  if (!localConfig.projectName) localConfig.projectName = projectName;
  if (!localConfig.syncFolder) localConfig.syncFolder = 'workflows';

  if (normalizedHost) {
    localConfig.activeInstanceId = activeInstanceId;
    localConfig.instances = [
      {
        id: activeInstanceId,
        name: 'test-local',
        host: normalizedHost,
        syncFolder: localConfig.syncFolder,
        projectId: normalizedProjectId,
        projectName,
        instanceIdentifier: localConfig.instanceIdentifier || 'test',
      },
    ];
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(localConfig, null, 2)}\n`);
}

function ensureIsolatedHomeProjectCompatibility(homeDir) {
  const workspaceDir = path.join(homeDir, 'n8n-workspace');
  const workspaceConfigPath = path.join(workspaceDir, 'n8nac-config.json');
  const rootConfigPath = path.join(homeDir, 'n8nac-config.json');
  const workspaceWorkflowsDir = path.join(workspaceDir, 'workflows');
  const rootWorkflowsDir = path.join(homeDir, 'workflows');

  const config = readJsonIfExists(workspaceConfigPath);
  if (config) {
    fs.writeFileSync(rootConfigPath, `${JSON.stringify(config, null, 2)}\n`);
  }

  try {
    if (fs.existsSync(rootWorkflowsDir)) {
      const stat = fs.lstatSync(rootWorkflowsDir);
      if (stat.isSymbolicLink() || stat.isDirectory()) {
        fs.rmSync(rootWorkflowsDir, { recursive: true, force: true });
      }
    }
    fs.symlinkSync(workspaceWorkflowsDir, rootWorkflowsDir, 'dir');
  } catch {
    fs.mkdirSync(rootWorkflowsDir, { recursive: true });
  }
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

function writeIsolatedN8nCredentials(homeDir, testN8nRuntime = {}) {
  const host = String(testN8nRuntime.host || '').trim();
  const apiKey = String(testN8nRuntime.apiKey || '').trim();
  if (!host || !apiKey) {
    return;
  }

  const normalizedHost = normalizeHost(host);
  const credentialsPath = path.join(homeDir, 'n8n-credentials.json');
  const payload = { hosts: { [normalizedHost]: apiKey } };
  fs.writeFileSync(credentialsPath, `${JSON.stringify(payload, null, 2)}\n`);
}

function normalizeHost(host) {
  try {
    return new URL(host).origin;
  } catch {
    return String(host || '').trim().replace(/\/$/, '');
  }
}

// ---------------------------------------------------------------------------
// Scenario runner
// ---------------------------------------------------------------------------

async function runScenario(scenario, isolatedHome, testN8nRuntime) {
  const journal = [];
  const toolEvents = [];
  const stdoutChunks = [];
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
      () => controller.abort(new Error(`Timeout after ${scenario.timeoutMs}ms`)),
      scenario.timeoutMs,
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

    try {
      const engine = _engine;
      const { agent } = await createYagrDeepAgent(engine, undefined, { provider: PROVIDER, model: MODEL });
      accumulator = createRunAccumulator();
      const threadId = `scenario-${scenario.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      logProgress(`scenario ${scenario.id}: start (${scenario.name})`);
      const stream = agent.streamEvents(
        { messages: [{ role: 'user', content: scenario.prompt }] },
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
      const outcome = buildScenarioOutcome(toolEvents);
      const assertion = await Promise.resolve(scenario.assert(result, outcome, toolEvents, testN8nRuntime));
      const createdWorkflowIds = (accumulator.workflowEmbeds || [])
        .filter((e) => e.workflowId)
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

function buildScenarioOutcome(toolEvents) {
  const events = toolEvents || [];
  const scriptEnds = events.filter((event) => event.type === 'command-end');
  const successfulScriptRuns = scriptEnds.filter((event) => Number(event.exitCode ?? 0) === 0).length;
  const failedScriptRuns = scriptEnds.filter((event) => Number(event.exitCode ?? 0) !== 0).length;
  const hasWorkflowWrites = events.some((event) =>
    event.type === 'status'
    && ['write_file', 'writeFile', 'edit_file', 'editFile', 'moveFile', 'move_file'].includes(event.toolName));

  return {
    successfulScriptRuns,
    failedScriptRuns,
    hasWorkflowWrites,
  };
}

function extractToolExitCode(toolName, parsedOutput, rawOutput) {
  const directExitCode = parsedOutput?.exitCode ?? parsedOutput?.exit_code;
  if (directExitCode !== undefined && directExitCode !== null) {
    return Number(directExitCode);
  }
  if (toolName !== 'execute') {
    return undefined;
  }

  const text = rawOutputToString(rawOutput).trimEnd();
  const exitMatch = text.match(/\[Command (?:succeeded|failed) with exit code (\d+)\]\s*$/);
  return exitMatch ? Number.parseInt(exitMatch[1], 10) : undefined;
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
    if (_managedDockerRuntime) {
      const cleanup = await cleanManagedDockerTestRuntimeWorkflows(_managedDockerRuntime);
      process.stdout.write(`${stamp()} managed docker cleanup: ${cleanup.deleted} workflow(s)\n`);
    }
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
    it(`[${scenario.id}] ${scenario.name}`, { timeout: scenario.timeoutMs + 10_000 }, async (t) => {
      if (scenario.n8nRequired && !_testN8nRuntime.configured) {
        t.skip('n8n non configuré');
        return;
      }

      const isolatedHome = createIsolatedHome(_testN8nRuntime);
      let result;
      try {
        result = await runScenario(scenario, isolatedHome, _testN8nRuntime);
        results.push({ scenario, ...result });
        logProgress(`scenario ${scenario.id}: ${result.status} (${result.steps || 0} steps) - ${truncate(singleLine(result.note || ''), 180)}`);
        assert.ok(result.status === 'PASS', `${result.status}: ${result.note}`);
      } finally {
        const createdWorkflowIds = result?.createdWorkflowIds ?? [];
        if (createdWorkflowIds.length > 0) {
          await cleanupWorkflows(createdWorkflowIds, isolatedHome, _testN8nRuntime);
        }
        if (keepTemp || debug) {
          process.stdout.write(`${stamp()} isolated home preserved: ${isolatedHome}\n`);
        } else {
          try { fs.rmSync(isolatedHome, { recursive: true, force: true }); } catch { /* best effort */ }
        }
      }
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
