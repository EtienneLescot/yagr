#!/usr/bin/env node
import process from 'node:process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { config as dotenvConfig } from 'dotenv';
import { N8nApiClient } from 'n8nac';
import {
  cleanManagedDockerTestRuntimeWorkflows,
  ensureManagedDockerTestRuntime,
  stopManagedDockerTestRuntime,
} from './test-managed-n8n-runtime.mjs';

dotenvConfig({ path: '.env', quiet: true, override: true });
dotenvConfig({ path: '.env.test', quiet: true, override: true });

const {
  YAGR_MODEL_PROVIDERS,
  YAGR_SUPPORTED_MODEL_PROVIDERS,
  getDefaultBaseUrlForProvider,
  getDefaultModelForProvider,
  getProviderDisplayName,
  getProviderDefinition,
  isOAuthAccountProvider,
} = await import('../dist/llm/provider-registry.js');
const { prepareProviderRuntime } = await import('../dist/llm/proxy-runtime.js');
const { getProviderTestModelPreferences } = await import('../dist/llm/test-model-policy.js');
const { getYagrSetupStatus } = await import('../dist/setup.js');
const { YagrConfigService } = await import('../dist/config/yagr-config-service.js');
const { YagrN8nConfigService } = await import('../dist/config/n8n-config-service.js');
const { getYagrPaths } = await import('../dist/config/yagr-home.js');
const { createYagrDeepAgent } = await import('../dist/agent-factory.js');
const { createLangChainModel } = await import('../dist/llm/create-langchain-model.js');
const { resolveModelCapabilityProfile } = await import('../dist/llm/model-capabilities.js');
const { createN8nEngineFromWorkspace } = await import('../dist/config/load-n8n-engine-config.js');
const { createRunAccumulator, processStreamEvent } = await import('../dist/gateway/langgraph-events.js');

const DEFAULT_TIMEOUT_MS = toInt(process.env.YAGR_IT_TIMEOUT_MS, 60_000);
const INFERENCE_TIMEOUT_MS = toInt(process.env.YAGR_IT_INFERENCE_TIMEOUT_MS, 75_000);
const MAX_MODEL_LIST_ROWS = toInt(process.env.YAGR_IT_MODEL_SAMPLE_SIZE, 8);

const args = new Set(process.argv.slice(2));
const argv = process.argv.slice(2);
const strict = args.has('--strict');
const json = args.has('--json');
const markdownDisabled = args.has('--no-markdown');
const debug = args.has('--debug') || process.env.YAGR_IT_DEBUG === '1';
const keepTemp = args.has('--keep-temp') || process.env.YAGR_IT_KEEP_TEMP === '1';
const failFast = args.has('--fail-fast') || process.env.YAGR_IT_FAIL_FAST === '1';
const useManagedDocker = args.has('--managed-docker') || process.env.YAGR_IT_USE_MANAGED_DOCKER === '1';
const keepManagedDocker = args.has('--keep-managed-docker') || process.env.YAGR_IT_KEEP_MANAGED_DOCKER === '1';
const heartbeatMs = toInt(process.env.YAGR_IT_HEARTBEAT_MS, 15_000);
const advancedIdleTimeoutMs = toInt(process.env.YAGR_IT_ADVANCED_IDLE_TIMEOUT_MS, 20_000);
const markdownPath = process.env.YAGR_IT_MARKDOWN_PATH || path.join(process.cwd(), 'reports', 'provider-integration-matrix.md');
const advanced = args.has('--advanced') || process.env.YAGR_IT_ADVANCED === '1';
const advancedPrompt = process.env.YAGR_IT_ADVANCED_PROMPT
  || 'Create a minimal n8n workflow with exactly two nodes: a Manual Trigger followed by a Set node that defines status=\"ok\". Do not ask any questions. Save the workflow and push it.';
const advancedTimeoutMs = toInt(process.env.YAGR_IT_ADVANCED_TIMEOUT_MS, 90_000);
const forcedModel = String(process.env.YAGR_IT_FORCE_MODEL || '').trim();
const disabledProviderTests = new Set(
  String(process.env.YAGR_IT_DISABLED_PROVIDERS || 'anthropic-proxy')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean),
);

const providersFromCli = readProvidersFromCli(argv);
const requestedProviders = (providersFromCli || process.env.YAGR_IT_PROVIDERS || '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);
const providers = requestedProviders.length > 0
  ? requestedProviders.map((entry) => normalizeProviderSelector(entry))
  : [...YAGR_SUPPORTED_MODEL_PROVIDERS].filter((provider) => !disabledProviderTests.has(provider));

configureWritableOAuthPaths();

printRunBanner();

const results = [];

let managedDockerRuntime;
if (useManagedDocker) {
  managedDockerRuntime = await ensureManagedDockerTestRuntime();
  process.stdout.write(`${stamp()} managed docker n8n: ${managedDockerRuntime.host}\n`);
}

try {
  for (const provider of providers) {
    if (useManagedDocker) {
      managedDockerRuntime = await ensureManagedDockerTestRuntime();
      logDebug('SETUP', `provider ${provider}: managed docker ready at ${managedDockerRuntime.host}`);
    }
    if (managedDockerRuntime) {
      const cleanup = await cleanManagedDockerTestRuntimeWorkflows(managedDockerRuntime);
      logProgress(`provider ${provider}: cleaned managed docker workflows (${cleanup.deleted})`);
    }
    logProgress(`provider ${provider}: start`);
    const providerResult = await runProvider(provider);
    results.push(providerResult);
    const providerFailed = providerResult.setup.status === 'FAIL'
      || providerResult.modelListing.status === 'FAIL'
      || providerResult.inference.status === 'FAIL'
      || (advanced && providerResult.advancedScenario.status === 'FAIL');
    logProgress(`provider ${provider}: done (setup=${providerResult.setup.status}, listing=${providerResult.modelListing.status}, inference=${providerResult.inference.status}${advanced ? `, advanced=${providerResult.advancedScenario.status}` : ''})`);
    if (providerFailed && failFast) {
      logProgress(`provider ${provider}: fail-fast triggered`);
      break;
    }
  }
} finally {
  if (managedDockerRuntime && !keepManagedDocker) {
    await stopManagedDockerTestRuntime();
    logProgress('managed docker n8n: stopped');
  }
}

printTable(results);
if (json) {
  process.stdout.write(`\n${JSON.stringify(results, null, 2)}\n`);
}
if (!markdownDisabled) {
  writeMarkdownReport(results, markdownPath);
  process.stdout.write(`Markdown report: ${markdownPath}\n`);
}

const failed = results.filter((row) =>
  row.setup.status === 'FAIL'
  || row.modelListing.status === 'FAIL'
  || row.inference.status === 'FAIL'
  || (advanced && row.advancedScenario.status === 'FAIL'));
if (strict && failed.length > 0) {
  process.exitCode = 1;
}

async function runProvider(provider) {
  if (disabledProviderTests.has(provider)) {
    const note = provider === 'anthropic-proxy'
      ? 'Provider test disabled: anthropic-proxy currently requires a dedicated setup token that is not configured for this machine.'
      : 'Provider test disabled by YAGR_IT_DISABLED_PROVIDERS.';
    return {
      provider,
      providerLabel: getProviderDisplayName(provider),
      chosenModel: getDefaultModelForProvider(provider),
      toolingLevel: 'unknown',
      setup: serializeStep({ status: 'SKIP', note }),
      modelListing: serializeStep({ status: 'SKIP', note }),
      inference: serializeStep({ status: 'SKIP', note }),
      advancedScenario: serializeStep({ status: 'SKIP', note }),
    };
  }

  const definition = getProviderDefinition(provider);
  const configuredApiKey = getProviderApiKey(provider);
  const configuredBaseUrl = getProviderBaseUrl(provider);

  const setup = await runStep(provider, 'setup', async () => {
    if (!isOAuthAccountProvider(provider)) {
      if (definition.requiresApiKey && !configuredApiKey) {
        return {
          status: 'SKIP',
          note: 'Missing API key in environment for this provider.',
        };
      }
      return {
        status: 'PASS',
        note: definition.requiresApiKey ? 'API key detected in environment.' : 'No interactive setup required.',
      };
    }

    const prepared = await prepareProviderRuntime(provider, {
      apiKey: configuredApiKey,
      baseUrl: configuredBaseUrl,
    });

    if (!prepared.ready || !prepared.runtime) {
      const reason = prepared.reason || 'Runtime preparation returned not-ready.';
      const missingCredential = /no .*credential|api key|sign in|oauth/i.test(reason);
      const credentialWarning = missingCredential ? getProviderCredentialWarning(provider) : '';
      return {
        status: missingCredential ? 'SKIP' : 'FAIL',
        note: credentialWarning ? `${reason} ${credentialWarning}` : reason,
      };
    }

    return {
      status: 'PASS',
      note: summarizeModels(prepared.runtime.models),
      runtime: prepared.runtime,
    };
  }, DEFAULT_TIMEOUT_MS);

  const setupRuntime = setup.runtime;

  const modelListing = await runStep(provider, 'model-listing', async () => {
    if (setup.status === 'SKIP') {
      return { status: 'SKIP', note: 'Skipped because setup is not available.' };
    }

    const runtimeModels = uniqueSorted(setupRuntime?.models || []);
    if (runtimeModels.length > 0) {
      return {
        status: 'PASS',
        note: summarizeModels(runtimeModels),
        models: runtimeModels,
      };
    }

    const apiKey = setupRuntime?.apiKey || configuredApiKey;
    const baseUrl = setupRuntime?.baseUrl || configuredBaseUrl || getDefaultBaseUrlForProvider(provider);
    if (!getProviderDefinition(provider).modelDiscovery) {
      return {
        status: 'SKIP',
        note: 'Provider has no public model listing endpoint configured.',
      };
    }

    const discoveredResult = await discoverModelsVerbose(provider, apiKey, baseUrl);
    if (!discoveredResult.ok) {
      return {
        status: 'FAIL',
        note: discoveredResult.error,
      };
    }
    const discovered = uniqueSorted(discoveredResult.models);
    if (discovered.length === 0) {
      return {
        status: 'FAIL',
        note: 'No models returned by runtime or discovery endpoint.',
      };
    }

    return {
      status: 'PASS',
      note: summarizeModels(discovered),
      models: discovered,
    };
  }, DEFAULT_TIMEOUT_MS);

  const chosenModel = chooseModel(setupRuntime?.models, modelListing.models, provider);
  const toolingLevel = resolveModelCapabilityProfile({ provider, model: chosenModel }).toolCalling;

  const inference = await runStep(provider, 'inference', async () => {
    if (setup.status === 'SKIP') {
      return { status: 'SKIP', note: 'Skipped because setup is not available.' };
    }

    const model = await createLangChainModel({
      provider,
      model: chosenModel,
      apiKey: setupRuntime?.apiKey || configuredApiKey,
      baseUrl: setupRuntime?.baseUrl || configuredBaseUrl,
    });

    let response;
    try {
      response = await withTimeout(
        model.invoke([{ role: 'user', content: 'Reply with exactly: OK' }]),
        INFERENCE_TIMEOUT_MS,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isTransientRateLimit(message)) {
        return {
          status: 'SKIP',
          note: `Transient provider rate limit: ${truncate(message, 180)}`,
        };
      }
      throw error;
    }

    const text = String(response?.content || '').trim();
    if (!text) {
      return {
        status: 'FAIL',
        note: 'Empty text response.',
      };
    }

    return {
      status: 'PASS',
      note: `Model ${chosenModel} responded (${Math.min(text.length, 60)} chars).`,
    };
  }, INFERENCE_TIMEOUT_MS + 5_000);

  const advancedScenario = await runStep(provider, 'advanced-scenario', async () => {
    if (!advanced) {
      return {
        status: 'SKIP',
        note: 'Advanced scenario disabled (use --advanced or YAGR_IT_ADVANCED=1).',
      };
    }

    const testN8nRuntime = resolveTestN8nRuntime();
    const setupStatus = getYagrSetupStatus(new YagrConfigService(), new YagrN8nConfigService());
    if (!setupStatus.n8nConfigured && !testN8nRuntime.configured) {
      return {
        status: 'SKIP',
        note: 'n8n is not configured for this workspace.',
      };
    }

    const n8nAvailability = await checkTestN8nAvailability(testN8nRuntime);
    if (!n8nAvailability.ok) {
      return {
        status: 'FAIL',
        note: n8nAvailability.error,
      };
    }

    if (!setupStatus.llmConfigured && setup.status !== 'PASS') {
      return {
        status: 'SKIP',
        note: 'LLM setup is not configured for this workspace.',
      };
    }

    const runAdvanced = async () => runYagrAdvancedScenario({ provider, model: chosenModel, prompt: advancedPrompt, timeoutMs: advancedTimeoutMs });
    let result = await runAdvanced();

    // Retry once on infrastructure errors (socket hang up, connection refused) by
    // restarting the managed Docker runtime before the retry.
    if (isInfrastructureError(result.error || '') && useManagedDocker) {
      process.stdout.write(`${stamp()} [infra-retry] ${provider}: infrastructure error detected ("${result.error}"), restarting Docker and retrying...\n`);
      managedDockerRuntime = await ensureManagedDockerTestRuntime();
      result = await runAdvanced();
    }

    const checklistNote = formatAdvancedChecklistNote(result.checklist);
    if (result.ok) {
      return {
        status: 'PASS',
        note: checklistNote
          ? `CLI scenario succeeded with model ${chosenModel}. ${checklistNote}`
          : `CLI scenario succeeded with model ${chosenModel}.`,
        response: result.assistantResponse || '',
        checklist: result.checklist,
      };
    }
    if (isTransientRateLimit(result.error || '')) {
      return {
        status: 'SKIP',
        note: `Transient provider rate limit: ${truncate(result.error || '', 180)}`,
      };
    }
    return {
      status: 'FAIL',
      note: checklistNote ? `${result.error} ${checklistNote}` : result.error,
      response: result.assistantResponse || '',
      checklist: result.checklist,
    };
  }, advancedTimeoutMs + 5_000);

  return {
    provider,
    providerLabel: getProviderDisplayName(provider),
    chosenModel,
    toolingLevel,
    setup: serializeStep(setup),
    modelListing: serializeStep(modelListing),
    inference: serializeStep(inference),
    advancedScenario: serializeStep(advancedScenario),
  };
}

async function runStep(provider, stepName, fn, timeoutMs) {
  const startedAt = Date.now();
  logProgress(`${provider}:${stepName}: start (timeout=${timeoutMs}ms)`);
  try {
    const result = await withTimeout(fn(), timeoutMs);
    logProgress(`${provider}:${stepName}: ${result.status} in ${Date.now() - startedAt}ms${result.note ? ` - ${truncate(singleLine(result.note), 160)}` : ''}`);
    return result;
  } catch (error) {
    const failed = {
      status: 'FAIL',
      note: error instanceof Error ? error.message : String(error),
    };
    logProgress(`${provider}:${stepName}: FAIL in ${Date.now() - startedAt}ms - ${truncate(singleLine(failed.note), 160)}`);
    return failed;
  }
}

function chooseModel(setupModels, discoveredModels, provider) {
  const fromSetup = uniqueSorted(setupModels || []);
  const fromDiscovery = uniqueSorted(discoveredModels || []);
  const candidates = uniqueSorted([...fromSetup, ...fromDiscovery]);
  if (forcedModel) {
    return forcedModel;
  }
  const preferred = getProviderTestModelPreferences(provider);
  for (const model of preferred) {
    if (candidates.includes(model)) {
      return model;
    }
  }

  const providerDefault = getDefaultModelForProvider(provider);
  if (candidates.includes(providerDefault)) {
    return providerDefault;
  }

  return candidates[0] || providerDefault;
}

function serializeStep(step) {
  return {
    status: step.status,
    note: step.note || '',
    response: step.response || '',
    checklist: step.checklist,
  };
}

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

function getProviderBaseUrl(provider) {
  const envKey = `YAGR_${provider.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_BASE_URL`;
  return process.env[envKey] || getDefaultBaseUrlForProvider(provider);
}

function resolveTestN8nRuntime() {
  if (managedDockerRuntime) {
    return managedDockerRuntime;
  }
  const configuredHost = String(process.env.N8N_HOST || process.env.YAGR_IT_N8N_HOST || '').trim();
  const configuredApiKey = String(process.env.N8N_API_KEY || process.env.YAGR_IT_N8N_API_KEY || '').trim();
  const configuredProjectId = String(process.env.N8N_PROJECT_ID || process.env.YAGR_IT_N8N_PROJECT_ID || '').trim();
  const host = configuredHost;
  const apiKey = configuredApiKey;
  const projectId = configuredProjectId;

  return {
    host,
    apiKey,
    projectId,
    configured: Boolean(host && apiKey),
  };
}

async function checkTestN8nAvailability(testN8nRuntime) {
  const host = String(testN8nRuntime?.host || '').trim();
  if (!host) {
    return { ok: false, error: 'n8n host is not configured for advanced tests.' };
  }

  const baseUrl = host.replace(/\/+$/, '');
  try {
    const healthResponse = await fetch(`${baseUrl}/healthz`);
    if (!healthResponse.ok) {
      return { ok: false, error: `n8n health check failed with HTTP ${healthResponse.status} for ${baseUrl}.` };
    }
  } catch (error) {
    return {
      ok: false,
      error: `n8n is unreachable at ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!String(testN8nRuntime?.apiKey || '').trim()) {
    return { ok: false, error: `n8n API key is missing for ${baseUrl}.` };
  }

  return { ok: true };
}

function configureWritableOAuthPaths() {
  const base = path.join(os.tmpdir(), 'yagr-provider-matrix');
  const sourcePaths = getYagrPaths();
  const defaultCodexAuthPath = path.join(os.homedir(), '.codex', 'auth.json');

  process.env.YAGR_CODEX_AUTH_PATH ||= path.join(base, 'codex-auth.json');
  process.env.YAGR_COPILOT_SESSION_PATH ||= path.join(base, 'copilot-session.json');
  process.env.YAGR_COPILOT_TOKEN_CACHE_PATH ||= path.join(base, 'copilot-token-cache.json');
  process.env.YAGR_GH_HOSTS_PATH ||= path.join(os.homedir(), '.config', 'gh', 'hosts.yml');

  copyIfExists(defaultCodexAuthPath, process.env.YAGR_CODEX_AUTH_PATH);
  copyIfExists(path.join(sourcePaths.accountAuthDir, 'copilot-oauth.json'), process.env.YAGR_COPILOT_SESSION_PATH);
  copyIfExists(path.join(sourcePaths.accountAuthDir, 'copilot-runtime-token.json'), process.env.YAGR_COPILOT_TOKEN_CACHE_PATH);
}

function getProviderCredentialWarning(provider) {
  if (provider === 'openai-proxy') {
    const authPath = process.env.YAGR_CODEX_AUTH_PATH || path.join(os.homedir(), '.codex', 'auth.json');
    return `Missing OpenAI OAuth credentials. Expected a Codex auth file at ${authPath}. Run yagr llm setup for OpenAI on this machine before running provider tests.`;
  }

  if (provider === 'copilot-proxy') {
    const sessionPath = process.env.YAGR_COPILOT_SESSION_PATH || path.join(getYagrPaths().accountAuthDir, 'copilot-oauth.json');
    const ghHostsPath = process.env.YAGR_GH_HOSTS_PATH || path.join(os.homedir(), '.config', 'gh', 'hosts.yml');
    return `Missing GitHub/Copilot OAuth credentials. Expected a Yagr Copilot session at ${sessionPath} or a GitHub CLI session at ${ghHostsPath}. Run yagr llm setup for Copilot or gh auth login on this machine before running provider tests.`;
  }

  if (provider === 'anthropic-proxy') {
    return 'anthropic-proxy is currently disabled for provider tests until a dedicated setup token is configured.';
  }

  return '';
}

async function discoverModelsVerbose(provider, apiKey, baseUrl) {
  const definition = getProviderDefinition(provider);
  const discovery = definition.modelDiscovery;
  if (!discovery) {
    return { ok: true, models: [] };
  }

  const url = discovery.buildUrl(baseUrl || getDefaultBaseUrlForProvider(provider));
  if (!url) {
    return { ok: true, models: [] };
  }

  if ((discovery.authMode === 'bearer-required' || discovery.authMode === 'x-api-key-required') && !apiKey) {
    return { ok: false, error: 'Missing API key for model discovery.' };
  }

  const headers = { 'Content-Type': 'application/json' };
  if ((discovery.authMode === 'bearer-required' || discovery.authMode === 'bearer-optional') && apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  if (discovery.authMode === 'x-api-key-required' && apiKey) {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  }

  let response;
  try {
    response = await fetch(url, { headers });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const shortBody = truncate(body.replace(/\s+/g, ' ').trim(), 140);
    return {
      ok: false,
      error: `HTTP ${response.status}${shortBody ? `: ${shortBody}` : ''}`,
    };
  }

  const payload = await response.json();
  return {
    ok: true,
    models: discovery.mapResponse(payload),
  };
}

function summarizeModels(models) {
  const sorted = uniqueSorted(models || []);
  if (sorted.length === 0) {
    return '0 models';
  }
  const sample = sorted.slice(0, MAX_MODEL_LIST_ROWS).join(', ');
  if (sorted.length <= MAX_MODEL_LIST_ROWS) {
    return `${sorted.length} models: ${sample}`;
  }
  return `${sorted.length} models: ${sample} (+${sorted.length - MAX_MODEL_LIST_ROWS} more)`;
}

function uniqueSorted(values) {
  return [...new Set((values || []).map((value) => String(value).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);
    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function toInt(input, fallback) {
  const value = Number.parseInt(String(input ?? ''), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function printTable(rows) {
  const headers = advanced
    ? ['Provider', 'Model', 'Tooling', 'Setup', 'Model Listing', 'Inference', 'Advanced Scenario']
    : ['Provider', 'Model', 'Tooling', 'Setup', 'Model Listing', 'Inference'];
  const renderedRows = rows.map((row) => ([
    `${row.providerLabel} (${row.provider})`,
    truncate(row.chosenModel || '', 38),
    row.toolingLevel || '',
    formatCell(row.setup),
    formatCell(row.modelListing),
    formatCell(row.inference),
    ...(advanced ? [formatCell(row.advancedScenario)] : []),
  ]));

  const widths = headers.map((header, idx) =>
    Math.max(header.length, ...renderedRows.map((row) => row[idx].length)));

  const sep = `+-${widths.map((width) => '-'.repeat(width)).join('-+-')}-+`;
  process.stdout.write(`${sep}\n`);
  process.stdout.write(`| ${headers.map((header, idx) => header.padEnd(widths[idx], ' ')).join(' | ')} |\n`);
  process.stdout.write(`${sep}\n`);
  for (const row of renderedRows) {
    process.stdout.write(`| ${row.map((cell, idx) => cell.padEnd(widths[idx], ' ')).join(' | ')} |\n`);
  }
  process.stdout.write(`${sep}\n`);
}

function formatCell(step) {
  return `${step.status} - ${truncate(step.note || '', 120)}`;
}

function truncate(text, max) {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}…`;
}

function writeMarkdownReport(rows, outputPath) {
  const statuses = ['PASS', 'FAIL', 'SKIP'];
  const totals = statuses.reduce((acc, status) => {
    acc.setup[status] = rows.filter((row) => row.setup.status === status).length;
    acc.modelListing[status] = rows.filter((row) => row.modelListing.status === status).length;
    acc.inference[status] = rows.filter((row) => row.inference.status === status).length;
    return acc;
  }, {
    setup: {},
    modelListing: {},
    inference: {},
  });

  const lines = [
    '# Provider Integration Matrix',
    '',
    `- Generated at: ${new Date().toISOString()}`,
    `- Providers: ${rows.map((row) => `\`${row.providerLabel} (${row.provider})\``).join(', ')}`,
    `- Timeouts: setup/model=${DEFAULT_TIMEOUT_MS}ms, inference=${INFERENCE_TIMEOUT_MS}ms`,
    `- Advanced scenario: ${advanced ? `enabled (timeout=${advancedTimeoutMs}ms)` : 'disabled'}`,
    '',
    '## Summary',
    '',
    '| Step | PASS | FAIL | SKIP |',
    '| --- | ---: | ---: | ---: |',
    `| setup | ${totals.setup.PASS ?? 0} | ${totals.setup.FAIL ?? 0} | ${totals.setup.SKIP ?? 0} |`,
    `| model-listing | ${totals.modelListing.PASS ?? 0} | ${totals.modelListing.FAIL ?? 0} | ${totals.modelListing.SKIP ?? 0} |`,
    `| inference | ${totals.inference.PASS ?? 0} | ${totals.inference.FAIL ?? 0} | ${totals.inference.SKIP ?? 0} |`,
    ...(advanced ? [`| advanced-scenario | ${rows.filter((r) => r.advancedScenario.status === 'PASS').length} | ${rows.filter((r) => r.advancedScenario.status === 'FAIL').length} | ${rows.filter((r) => r.advancedScenario.status === 'SKIP').length} |`] : []),
    '',
    '## Provider Overview',
    '',
    ...(advanced
      ? ['| Provider | Model | Tooling | Setup | Model Listing | Inference | Advanced Scenario |', '| --- | --- | --- | --- | --- | --- | --- |']
      : ['| Provider | Model | Tooling | Setup | Model Listing | Inference |', '| --- | --- | --- | --- | --- | --- |']),
    ...rows.map((row) =>
      advanced
        ? `| \`${escapeMd(`${row.providerLabel} (${row.provider})`)}\` | \`${escapeMd(row.chosenModel || '')}\` | \`${escapeMd(row.toolingLevel || '')}\` | ${formatMarkdownCell(row.setup)} | ${formatMarkdownCell(row.modelListing)} | ${formatMarkdownCell(row.inference)} | ${formatMarkdownCell(row.advancedScenario)} |`
        : `| \`${escapeMd(`${row.providerLabel} (${row.provider})`)}\` | \`${escapeMd(row.chosenModel || '')}\` | \`${escapeMd(row.toolingLevel || '')}\` | ${formatMarkdownCell(row.setup)} | ${formatMarkdownCell(row.modelListing)} | ${formatMarkdownCell(row.inference)} |`),
    '',
    '## Detailed Results',
    '',
    ...rows.flatMap((row) => renderMarkdownProviderSection(row)),
    '',
  ];

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, lines.join('\n'));
}

function formatMarkdownCell(step) {
  return `**${step.status}**<br>${escapeMd(step.note || '')}`;
}

function renderMarkdownProviderSection(row) {
  const lines = [
    `### ${row.providerLabel} (${row.provider})`,
    '',
    `- Model: \`${row.chosenModel || ''}\``,
    `- Tooling level: \`${row.toolingLevel || ''}\``,
    `- Setup: **${row.setup.status}**`,
    `- Model listing: **${row.modelListing.status}**`,
    `- Inference: **${row.inference.status}**`,
  ];

  if (advanced) {
    lines.push(`- Advanced scenario: **${row.advancedScenario.status}**`);
  }

  lines.push('');
  lines.push('**Notes**');
  lines.push('');
  lines.push(`- Setup: ${row.setup.note || 'n/a'}`);
  lines.push(`- Model listing: ${row.modelListing.note || 'n/a'}`);
  lines.push(`- Inference: ${row.inference.note || 'n/a'}`);
  if (advanced) {
    lines.push(`- Advanced scenario: ${row.advancedScenario.note || 'n/a'}`);
    if (row.advancedScenario.checklist) {
      lines.push(`- Advanced blocking actions: ${row.advancedScenario.checklist.blockingRequiredActionTitles?.join(', ') || 'none'}`);
      lines.push(`- Advanced follow-ups: ${row.advancedScenario.checklist.followUpRequiredActionTitles?.join(', ') || 'none'}`);
    }
  }

  if (advanced && row.advancedScenario.response) {
    lines.push('');
    lines.push('**Advanced Final Response**');
    lines.push('');
    lines.push('```text');
    lines.push(row.advancedScenario.response.trim());
    lines.push('```');
  }

  lines.push('');
  return lines;
}

function escapeMd(text) {
  return String(text).replace(/\|/g, '\\|');
}

function readProvidersFromCli(rawArgv) {
  for (let i = 0; i < rawArgv.length; i += 1) {
    const arg = rawArgv[i];
    if (arg === '--providers' || arg === '--provider') {
      return rawArgv[i + 1] || '';
    }
  }
  return '';
}

function normalizeProviderSelector(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const aliases = {
    'claude-api': 'anthropic',
    'claude-token': 'anthropic-proxy',
    'openai-oauth': 'openai-proxy',
    'github-oauth': 'copilot-proxy',
    'copilot-oauth': 'copilot-proxy',
  };

  const resolved = aliases[normalized] || normalized;
  if (!YAGR_MODEL_PROVIDERS.includes(resolved)) {
    throw new Error(`Unknown provider selector "${value}". Known providers: ${YAGR_MODEL_PROVIDERS.join(', ')}`);
  }
  return resolved;
}

async function runYagrAdvancedScenario({
  provider,
  model,
  prompt,
  timeoutMs,
}) {
  return await runYagrAdvancedScenarioAttempt({
    provider,
    model,
    prompt,
    timeoutMs,
  });
}

async function runYagrAdvancedScenarioAttempt({
  provider,
  model,
  prompt,
  timeoutMs,
}) {
  const testN8nRuntime = resolveTestN8nRuntime();
  const isolatedHome = createAdvancedScenarioHome(provider, model, testN8nRuntime);
  const workspaceScanDir = path.join(isolatedHome, 'n8n-workspace');
  const beforeSnapshot = snapshotWorkflowFiles(workspaceScanDir);
  const beforeRemoteSnapshot = await listRemoteWorkflows();
  const beforeRemoteDetails = await getRemoteWorkflowDetails(beforeRemoteSnapshot);
  const effectivePrompt = buildAdvancedScenarioPrompt(prompt, provider, isolatedHome);
  const workflowDir = resolveActiveWorkflowDir(isolatedHome);

  if (debug) {
    logDebug(provider, `isolated home: ${isolatedHome}`);
    logDebug(provider, `active workflow dir: ${workflowDir || '(unknown)'}`);
    logDebug(provider, `prompt: ${truncate(singleLine(effectivePrompt), 220)}`);
  }

  try {
    const execution = await runAdvancedAgentInProcess({
      provider,
      model,
      prompt: effectivePrompt,
      isolatedHome,
      timeoutMs,
      testN8nRuntime,
    });
    const afterSnapshot = snapshotWorkflowFiles(workspaceScanDir);
    const changedWorkflows = diffWorkflowSnapshots(beforeSnapshot, afterSnapshot);
    const createdRemoteWorkflows = await getCreatedRemoteWorkflows(beforeRemoteSnapshot);
    const checklist = buildAdvancedChecklist({
      toolEvents: execution.toolEvents,
      requiredActions: execution.requiredActions,
      workflowEmbeds: execution.workflowEmbeds,
      changedWorkflows,
      createdRemoteWorkflows,
    });
    const validation = await validateAdvancedScenarioResult({
      stdout: execution.stdout,
      stderr: execution.stderr,
      prompt,
      workflowDir,
      beforeSnapshot,
      afterSnapshot,
      createdRemoteWorkflows,
      checklist,
    });

    if (execution.timedOut) {
      if (validation.ok) {
        return { ok: true, checklist, assistantResponse: normalizeAssistantResponse(execution.stdout) };
      }
      const logPath = writeAdvancedFailureLog(provider, {
        code: null,
        stdout: execution.stdout,
        stderr: execution.stderr,
        prompt: effectivePrompt,
        model,
        timedOut: true,
        checklist,
        assistantResponse: normalizeAssistantResponse(execution.stdout),
        journal: execution.journal,
        toolEvents: execution.toolEvents,
      });
      return { ok: false, error: `${validation.ok ? `Timeout after ${timeoutMs}ms` : validation.error} (log: ${logPath})`, checklist, assistantResponse: normalizeAssistantResponse(execution.stdout) };
    }

    if (execution.error) {
      const logPath = writeAdvancedFailureLog(provider, {
        code: 1,
        stdout: execution.stdout,
        stderr: execution.stderr,
        prompt: effectivePrompt,
        model,
        checklist,
        assistantResponse: normalizeAssistantResponse(execution.stdout),
        journal: execution.journal,
        toolEvents: execution.toolEvents,
      });
      return { ok: false, error: `${execution.error} (log: ${logPath})`, checklist, assistantResponse: normalizeAssistantResponse(execution.stdout) };
    }

    if (!validation.ok) {
      const logPath = writeAdvancedFailureLog(provider, {
        code: 0,
        stdout: execution.stdout,
        stderr: execution.stderr,
        prompt: effectivePrompt,
        model,
        checklist,
        assistantResponse: normalizeAssistantResponse(execution.stdout),
        journal: execution.journal,
        toolEvents: execution.toolEvents,
      });
      return { ok: false, error: `${validation.error} (log: ${logPath})`, checklist, assistantResponse: normalizeAssistantResponse(execution.stdout) };
    }

    return { ok: true, checklist, assistantResponse: normalizeAssistantResponse(execution.stdout) };
  } finally {
    await cleanupRemoteWorkflows(beforeRemoteSnapshot, beforeRemoteDetails);
    if (keepTemp || debug) {
      logProgress(`${provider}: preserving isolated home at ${isolatedHome}`);
    } else {
      cleanupAdvancedScenarioHome(isolatedHome);
    }
  }
}

async function validateAdvancedScenarioResult({
  stdout,
  stderr,
  prompt,
  workflowDir,
  beforeSnapshot,
  afterSnapshot,
  createdRemoteWorkflows,
  checklist,
}) {
  const merged = `${stdout}\n${stderr}`;
  const normalized = merged.replace(/\s+/g, ' ').trim();

  const blockerPatterns = [
    /need your n8n api key/i,
    /please send:\s*-?\s*`?n8n_api_key`?/i,
    /i(?:’|'| a)?m blocked on .*api key/i,
    /i do not have access to .*n8nac/i,
    /unable to run workspace commands/i,
    /unable to use the required n8nac tools/i,
  ];

  if (blockerPatterns.some((pattern) => pattern.test(normalized))) {
    return {
      ok: false,
      error: `CLI scenario exited cleanly but the agent reported a blocker instead of executing workflow tools: ${truncate(normalized, 220)}`,
    };
  }

  const hasFinalSuccessSignal = Boolean(
    checklist?.hasVerifiedPushSuccess
    || checklist?.hasWorkflowEmbed
    || checklist?.hasWorkflowPresentation
    || checklist?.hasWorkflowEmbedUrl
    || (checklist?.remoteWorkflowCount ?? 0) > 0
    || (
      checklist?.hasPush
      && (checklist?.hasVerify || checklist?.hasValidate)
      && (checklist?.successfulScriptRuns ?? 0) > 0
    )
  );

  if ((checklist?.failedScriptRuns ?? 0) > 0 && !hasFinalSuccessSignal) {
    return {
      ok: false,
      error: `CLI scenario executed failing workflow commands without creating any remote workflow: ${truncate(normalized, 220)}`,
    };
  }

  if (
    checklist?.usedN8nac
    && (
      checklist?.hasVerifiedPushSuccess
      || (
        checklist?.hasPush
        && (checklist?.hasVerify || checklist?.hasValidate)
        && (
          (checklist?.successfulScriptRuns ?? 0) > 0
          || (checklist?.remoteWorkflowCount ?? 0) > 0
          || checklist?.hasWorkflowEmbed
          || checklist?.hasWorkflowPresentation
        )
      )
    )
  ) {
    // Workflow was created and pushed — embed is optional (nice-to-have, not required for provider tests)
    return { ok: true };
  }

  const changedWorkflows = diffWorkflowSnapshots(beforeSnapshot, afterSnapshot);
  const remotePromptValidation = validateRemoteWorkflowsMatchPrompt(prompt, createdRemoteWorkflows);
  if (
    changedWorkflows.length === 0
    && !remotePromptValidation.ok
    && !(checklist?.usedN8nac && (checklist?.hasPush || checklist?.hasVerify))
  ) {
    return {
      ok: false,
      error: `CLI scenario exited cleanly but created or modified no .workflow.ts file in ${workflowDir || 'the active workflow directory'}: ${truncate(normalized, 220)}`,
    };
  }

  const promptValidation = validateWorkflowMatchesPrompt(prompt, changedWorkflows);
  if (!promptValidation.ok && !remotePromptValidation.ok) {
    return {
      ok: false,
      error: remotePromptValidation.error || promptValidation.error,
    };
  }

  if (!checklist?.hasPush) {
    return {
      ok: false,
      error: `CLI scenario created a local workflow file but did not push it to the remote n8n instance: ${truncate(normalized, 220)}`,
    };
  }

  return { ok: true };
}

async function runAdvancedAgentInProcess({
  provider,
  model,
  prompt,
  isolatedHome,
  timeoutMs,
  testN8nRuntime,
}) {
  const stdoutChunks = [];
  const stderrChunks = [];
  const journal = [];
  const toolEvents = [];
  const envOverrides = {
    YAGR_HOME: isolatedHome,
    YAGR_LAUNCH_CWD: isolatedHome,
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
    const timer = setTimeout(() => controller.abort(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);
    let idleTimer;
    let heartbeat;
    const activeToolCommands = new Map();
    let lastActivityAt = Date.now();
    let lastActivityLabel = 'agent start';
    let accumulator = createRunAccumulator();

    const noteActivity = (label) => {
      lastActivityAt = Date.now();
      lastActivityLabel = label;
      if (advancedIdleTimeoutMs > 0) {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          controller.abort(new Error(`Idle timeout after ${advancedIdleTimeoutMs}ms without meaningful progress (last activity: ${label})`));
        }, advancedIdleTimeoutMs);
      }
    };

    noteActivity('agent start');

    if (debug) {
      heartbeat = setInterval(() => {
        const idleMs = Date.now() - lastActivityAt;
        if (idleMs >= heartbeatMs) {
          logDebug(provider, `heartbeat: still running (${Math.round(idleMs / 1000)}s idle since ${lastActivityLabel})`);
          lastActivityAt = Date.now();
        }
      }, heartbeatMs);
    }

    try {
      const engine = await createN8nEngineFromWorkspace();
      const { agent } = await createYagrDeepAgent(engine, undefined, { provider, model });
      accumulator = createRunAccumulator();
      const threadId = `matrix-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const stream = agent.streamEvents(
        { messages: [{ role: 'user', content: prompt }] },
        { configurable: { thread_id: threadId }, version: 'v2', signal: controller.signal },
      );

      for await (const event of stream) {
        noteActivity(event.event || event.name || 'stream event');
        await processStreamEvent(event, accumulator, {
          onTextDelta: async (delta) => {
            stdoutChunks.push(delta);
            if (debug) {
              logDebug(provider, `assistant: ${truncate(singleLine(delta), 160)}`);
            }
          },
          onUserVisibleUpdate: async (update) => {
            stderrChunks.push(`[update] ${update.title}${update.detail ? `: ${update.detail}` : ''}`);
            if (debug) {
              logDebug(provider, `update: ${update.title}${update.detail ? ` | ${singleLine(update.detail)}` : ''}`);
            }
          },
        });

        // Collect tool events from stream for checklist analysis
        if (event.event === 'on_tool_start') {
          const rawInput = event.data?.input;
          const inner = rawInput?.input;
          let parsedInput;
          if (typeof inner === 'string') { try { parsedInput = JSON.parse(inner); } catch { parsedInput = rawInput; } }
          else { parsedInput = inner ?? rawInput; }
          const toolName = event.name;
          const cmd = String(parsedInput?.command || parsedInput?.cmd || '');
          const bypassReason = detectForbiddenN8nBypass(toolName, parsedInput, cmd);
          if (bypassReason) {
            throw new Error(bypassReason);
          }
          if (cmd) {
            activeToolCommands.set(toolName, cmd);
            toolEvents.push({ type: 'command-start', toolName, command: cmd });
            stderrChunks.push(`[tool:${toolName}] START ${cmd}`);
            if (debug) {
              logDebug(provider, `tool ${toolName} start: ${truncate(singleLine(cmd), 200)}`);
            }
          } else {
            toolEvents.push({ type: 'status', toolName, message: `start:${JSON.stringify(parsedInput ?? {}).slice(0, 120)}` });
            if (debug) {
              logDebug(provider, `tool ${toolName} start`);
            }
          }
          // Track script/write calls for analysis
          journal.push({ type: 'tool-start', toolName, input: parsedInput });
        } else if (event.event === 'on_tool_end') {
          const toolName = event.name;
          const output = event.data?.output;
          // Parse tool output
          let parsedOutput;
          if (typeof output === 'string') { try { parsedOutput = JSON.parse(output); } catch { parsedOutput = { text: output }; } }
          else { parsedOutput = output; }
          const outputText = [parsedOutput?.stdout, parsedOutput?.stderr, parsedOutput?.text, parsedOutput?.message]
            .map((value) => String(value || '').trim())
            .filter(Boolean)
            .join(' | ');
          const exitCode = parsedOutput?.exitCode ?? parsedOutput?.exit_code ?? extractCommandExitCode(outputText);
          const completedCommand = String(activeToolCommands.get(toolName) || '');
          activeToolCommands.delete(toolName);
          if (exitCode !== undefined) {
            toolEvents.push({ type: 'command-end', toolName, command: completedCommand, exitCode: Number(exitCode), timedOut: false });
            stderrChunks.push(`[tool:${toolName}] END exit=${exitCode}`);
            if (debug) {
              logDebug(provider, `tool ${toolName} end: exit=${exitCode}`);
            }
          }
          const statusMsg = parsedOutput?.message || parsedOutput?.status;
          if (statusMsg) {
            toolEvents.push({ type: 'status', toolName, message: String(statusMsg) });
            stderrChunks.push(`[tool:${toolName}] status: ${statusMsg}`);
            if (debug) {
              logDebug(provider, `tool ${toolName} status: ${truncate(singleLine(String(statusMsg)), 200)}`);
            }
          }
          if (
            toolName === 'presentWorkflowResult'
            && parsedOutput
            && (
              parsedOutput.__type === 'workflow_embed'
              || parsedOutput.kind === 'workflow'
              || parsedOutput.workflowId
              || parsedOutput.url
            )
          ) {
            toolEvents.push({
              type: 'status',
              toolName,
              message: `workflow_embed:${parsedOutput.workflowId || parsedOutput.url || 'ok'}`,
            });
          }
          if (debug && outputText) {
            logDebug(provider, `tool ${toolName} output: ${truncate(singleLine(outputText), 220)}`);
          }
          journal.push({ type: 'tool-end', toolName, output: parsedOutput });

          if (hasObservedAdvancedSuccess(toolEvents, accumulator.workflowEmbeds)) {
            if (debug) {
              logDebug(provider, 'advanced scenario success observed; stopping stream early');
            }
            break;
          }
        }
      }

      return {
        stdout: stdoutChunks.join(''),
        stderr: stderrChunks.join('\n'),
        journal,
        toolEvents,
        requiredActions: accumulator.requiredActions,
        workflowEmbeds: accumulator.workflowEmbeds,
        timedOut: false,
        error: '',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        stdout: stdoutChunks.join(''),
        stderr: `${stderrChunks.join('\n')}\n${message}`.trim(),
        journal,
        toolEvents,
        requiredActions: accumulator?.requiredActions ?? [],
        workflowEmbeds: accumulator?.workflowEmbeds ?? [],
        timedOut: /timeout after/i.test(message),
        error: message,
      };
    } finally {
      try {
        process.chdir(previousCwd);
      } catch {
        // Best effort restore only.
      }
      clearTimeout(timer);
      clearTimeout(idleTimer);
      if (heartbeat) {
        clearInterval(heartbeat);
      }
    }
  });
}

function printRunBanner() {
  process.stdout.write(`${stamp()} provider matrix start\n`);
  process.stdout.write(`${stamp()} providers: ${providers.join(', ')}\n`);
  process.stdout.write(`${stamp()} advanced: ${advanced ? 'on' : 'off'} | debug: ${debug ? 'on' : 'off'} | keep-temp: ${(keepTemp || debug) ? 'on' : 'off'}\n`);
  if (advanced) {
    process.stdout.write(`${stamp()} advanced timeouts: total=${advancedTimeoutMs}ms idle=${advancedIdleTimeoutMs}ms\n`);
  }
}

function logProgress(message) {
  process.stdout.write(`${stamp()} ${message}\n`);
}

function logDebug(provider, message) {
  process.stdout.write(`${stamp()} [debug:${provider}] ${message}\n`);
}

function stamp() {
  return `[${new Date().toISOString().slice(11, 19)}]`;
}

function singleLine(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function extractCommandExitCode(text) {
  const normalized = String(text || '');
  const failedMatch = normalized.match(/\[Command failed with exit code (\d+)\]|Exit code:\s*(\d+)/i);
  if (failedMatch) {
    return Number(failedMatch[1] || failedMatch[2]);
  }
  const successMatch = normalized.match(/\[Command succeeded with exit code (\d+)\]/i);
  if (successMatch) {
    return Number(successMatch[1]);
  }
  return undefined;
}

function hasObservedAdvancedSuccess(toolEvents, workflowEmbeds) {
  const embeds = Array.isArray(workflowEmbeds) ? workflowEmbeds : [];
  const allEvents = Array.isArray(toolEvents) ? toolEvents : [];
  const hasWorkflowPresentation = allEvents.some((event) =>
    event.type === 'status'
    && event.toolName === 'presentWorkflowResult'
    && String(event.message || '').startsWith('workflow_embed:'),
  );

  const successfulCommands = allEvents.filter((event) =>
    event.type === 'command-end'
    && Number(event.exitCode ?? 1) === 0);

  const hasVerifiedPushSuccess = successfulCommands.some((event) => {
    const command = String(event.command || '').toLowerCase();
    return isN8nacCommand(command) && command.includes('push') && command.includes('--verify');
  });

  if (hasVerifiedPushSuccess) {
    return true;
  }

  // Also detect shell-based presentWorkflowResult (yagr presentWorkflowResult --workflow-id ...) as a success signal
  const hasShellPresentWorkflowResult = successfulCommands.some((event) => {
    const command = String(event.command || '').toLowerCase();
    return command.includes('presentworkflowresult');
  });

  if (hasShellPresentWorkflowResult) {
    const hasSuccessfulPushForShell = successfulCommands.some((event) => {
      const command = String(event.command || '').toLowerCase();
      return isN8nacCommand(command) && command.includes('push');
    });
    if (hasSuccessfulPushForShell) return true;
  }

  if (embeds.length === 0 && !hasWorkflowPresentation) {
    return false;
  }

  const hasSuccessfulPush = successfulCommands.some((event) => {
    const command = String(event.command || '').toLowerCase();
    return isN8nacCommand(command) && command.includes('push');
  });

  return hasSuccessfulPush;
}

function detectForbiddenN8nBypass(toolName, parsedInput, commandText) {
  const requestUrl = String(parsedInput?.url || parsedInput?.endpoint || '').toLowerCase();
  const normalizedCommand = String(commandText || '').toLowerCase();
  const touchesWorkflowApi = requestUrl.includes('/api/v1/workflows') || normalizedCommand.includes('/api/v1/workflows');

  if (!touchesWorkflowApi) {
    return '';
  }

  if (toolName === 'httpRequest' || toolName === 'http_request') {
    return `Forbidden direct n8n API bypass detected via ${toolName}; provider tests must go through n8nac only.`;
  }

  if (toolName === 'execute' && normalizedCommand.includes('curl')) {
    return 'Forbidden direct n8n API bypass detected via curl; provider tests must go through n8nac only.';
  }

  return '';
}

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
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function buildAdvancedChecklist({
  toolEvents,
  requiredActions,
  workflowEmbeds,
  changedWorkflows,
  createdRemoteWorkflows,
}) {
  // Split required actions into blocking vs follow-up
  const blockingRequiredActions = (requiredActions || []).filter((a) => a.blocking !== false);
  const followUpRequiredActions = (requiredActions || []).filter((a) => a.blocking === false);

  const allEvents = (toolEvents || []);
  // Legacy path: command-start events from direct n8nac tool invocations
  const commandStarts = allEvents.filter((event) => event.type === 'command-start' && event.toolName === 'n8nac');
  const commandEnds = allEvents.filter((event) => event.type === 'command-end' && event.toolName === 'n8nac');
  // New path: runScript / execute status messages containing n8nac subcommands
  const scriptMessages = allEvents
    .filter((event) => (event.type === 'status' || event.type === 'result') && (event.toolName === 'runScript' || event.toolName === 'execute' || event.toolName === 'run_script'))
    .map((event) => String(event.message || '').toLowerCase());
  const usedN8nacViaScript = scriptMessages.some((msg) => isN8nacCommand(msg));
  // Also detect n8nac calls from command-start events on execute/run_script tools
  const executeCommands = allEvents
    .filter((event) => event.type === 'command-start' && (event.toolName === 'execute' || event.toolName === 'run_script' || event.toolName === 'runScript'))
    .map((event) => String(event.command || '').toLowerCase());
  const hasPush = commandStarts.some((event) => String(event.command || '').includes('push'))
    || scriptMessages.some((msg) => isN8nacCommand(msg) && msg.includes('push'))
    || executeCommands.some((cmd) => isN8nacCommand(cmd) && cmd.includes('push'));
  const hasVerify = commandStarts.some((event) => String(event.command || '').includes('verify'))
    || scriptMessages.some((msg) => isN8nacCommand(msg) && msg.includes('verify'))
    || executeCommands.some((cmd) => isN8nacCommand(cmd) && cmd.includes('verify'))
    || executeCommands.some((cmd) => isN8nacCommand(cmd) && cmd.includes('push') && cmd.includes('--verify'));
  const hasWorkflowPresentation = allEvents.some((event) =>
    event.type === 'status'
    && event.toolName === 'presentWorkflowResult'
    && String(event.message || '').startsWith('workflow_embed:'),
  );

  // Workflow embeds come from accumulator.workflowEmbeds (WorkflowEmbedPayload[])
  const embeds = workflowEmbeds || [];
  const actionNames = [
    ...(hasPush ? ['push'] : []),
    ...(hasVerify ? ['verify'] : []),
  ];

  // Count script runs from tool-end events
  const scriptEnds = allEvents.filter((event) => event.type === 'command-end' && (event.toolName === 'execute' || event.toolName === 'run_script' || event.toolName === 'runScript'));
  const successfulScriptRuns = scriptEnds.filter((e) => Number(e.exitCode ?? 0) === 0).length;
  const failedScriptRuns = scriptEnds.filter((e) => Number(e.exitCode ?? 0) !== 0).length;
  const hasVerifiedPushSuccess = scriptEnds.some((event) => {
    const command = String(event.command || '').toLowerCase();
    return Number(event.exitCode ?? 1) === 0
      && isN8nacCommand(command)
      && command.includes('push')
      && command.includes('--verify');
  });

  // Detect workflow file writes from tool-start events (write_file / writeFile / edit_file)
  const writeEvents = allEvents.filter((event) => event.type === 'status' && (event.toolName === 'write_file' || event.toolName === 'writeFile' || event.toolName === 'edit_file' || event.toolName === 'editFile'));
  const wroteWorkflowFile = writeEvents.length > 0 || (changedWorkflows || []).length > 0;

  return {
    usedN8nac: commandStarts.length > 0 || usedN8nacViaScript || executeCommands.some((cmd) => isN8nacCommand(cmd)),
    hasPush,
    hasVerify,
    actionNames,
    scriptRunCount: successfulScriptRuns + failedScriptRuns,
    commandStartCount: commandStarts.length,
    commandEndCount: commandEnds.length,
    successfulScriptRuns,
    failedScriptRuns,
    hasVerifiedPushSuccess,
    hasWorkflowEmbed: embeds.length > 0,
    hasWorkflowPresentation,
    hasWorkflowEmbedUrl: embeds.some((embed) => Boolean(String(embed.url || '').trim())),
    hasWorkflowEmbedDiagram: embeds.some((embed) => Boolean(String(embed.diagram || '').trim())),
    wroteWorkflowFile,
    changedWorkflowFileCount: (changedWorkflows || []).length,
    remoteWorkflowCount: Array.isArray(createdRemoteWorkflows) ? createdRemoteWorkflows.length : 0,
    blockingRequiredActionCount: blockingRequiredActions.length,
    followUpRequiredActionCount: followUpRequiredActions.length,
    blockingRequiredActionTitles: blockingRequiredActions.map((action) => action.title),
    followUpRequiredActionTitles: followUpRequiredActions.map((action) => action.title),
  };
}

function isN8nacCommand(text) {
  const normalized = String(text || '').toLowerCase();
  return normalized.includes('n8nac') || normalized.includes('/packages/cli/dist/index.js');
}

function resolveActiveWorkflowDir(yagrHome = getYagrPaths().homeDir) {
  try {
    const configPath = path.join(yagrHome, 'n8n-workspace', 'n8nac-config.json');
    if (!fs.existsSync(configPath)) {
      return '';
    }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const instanceIdentifier = String(config.instanceIdentifier || '').trim();
    const projectName = String(config.projectName || '').trim();
    const syncFolder = String(config.syncFolder || '').trim() || 'workflows';
    if (!instanceIdentifier || !projectName) {
      return '';
    }
    const workspaceDir = path.join(yagrHome, 'n8n-workspace');
    const resolvedSyncFolder = path.isAbsolute(syncFolder)
      ? syncFolder
      : path.join(workspaceDir, syncFolder);
    const projectSlug = String(projectName)
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[-\s]+/g, '-');
    return path.join(resolvedSyncFolder, instanceIdentifier, projectSlug);
  } catch {
    return '';
  }
}

function buildAdvancedScenarioPrompt(prompt, provider, isolatedHome) {
  const marker = `yagr-it-${provider.replace(/[^a-z0-9]+/gi, '-')}-${Date.now()}`;
  const workspaceContext = buildWorkspaceContext(isolatedHome);
  return `${prompt}\n\nTest constraints:\n- Create a new workflow.\n- Give it a unique name starting with "${marker}".\n- Do not update an existing workflow.\n- Do not ask any questions or wait for confirmation.\n- Only finish when the workflow is saved and pushed.${workspaceContext ? `\n\nWorkspace state:\n${workspaceContext}` : ''}`;
}

function buildWorkspaceContext(isolatedHome) {
  if (!isolatedHome) return '';
  try {
    const configPath = path.join(isolatedHome, 'n8n-workspace', 'n8nac-config.json');
    if (!fs.existsSync(configPath)) return '';
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const activeId = config.activeInstanceId;
    const instance = (config.instances || []).find((i) => i.id === activeId);
    if (!instance) return '';
    return `- \`n8nac-config.json\` is present and verified (host: ${instance.host}, project: ${instance.projectName}). Use \`npx --yes n8nac@next\` for all n8n operations. Paths reported by \`n8nac\` are workspace-relative; keep them relative to the current n8n workspace and do not prefix them with \`/\`.`;
  } catch {
    return '';
  }
}

/**
 * Regenerate AGENTS.md in an isolated test home using n8nac update-ai.
 * This ensures each test environment has fresh, up-to-date instructions.
 */
function seedHomeAgentsMd(homeDir) {
  // Mirrors ensureHomeInstructionsSeeded from src/config/yagr-home.ts:
  // seed homeDir/AGENTS.md from the bundled YAGENTS.md template if not already present.
  const destPath = path.join(homeDir, 'AGENTS.md');
  if (fs.existsSync(destPath)) {
    return;
  }

  const launchDir = process.env.YAGR_LAUNCH_CWD || process.cwd();
  const candidates = [
    path.join(launchDir, 'node_modules', '@yagr', 'manager-tooling', 'YAGENTS.md'),
    path.join(launchDir, 'src', 'manager-tooling', 'YAGENTS.md'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        const content = fs.readFileSync(candidate, 'utf8').trim();
        if (content) {
          fs.writeFileSync(destPath, `${content}\n`);
        }
      } catch {
        // Best effort only.
      }
      return;
    }
  }
}

function generateTestAgentsMd(homeDir, testN8nRuntime = {}) {
  // Resolve n8nac package based on YAGR_N8NAC_VERSION
  const version = String(process.env.YAGR_N8NAC_VERSION || '').trim();
  let n8nacPackage = 'n8nac@next';
  if (version) {
    n8nacPackage = version.startsWith('@') ? `n8nac${version}` : `n8nac@${version}`;
  }

  const sharedEnv = {
    ...process.env,
    ...(testN8nRuntime.host ? { N8N_HOST: String(testN8nRuntime.host) } : {}),
    ...(testN8nRuntime.apiKey ? { N8N_API_KEY: String(testN8nRuntime.apiKey) } : {}),
    ...(testN8nRuntime.projectId ? { N8N_PROJECT_ID: String(testN8nRuntime.projectId) } : {}),
  };

  // Ensure n8nac's global Conf store has the correct API key for this host.
  // When the managed docker runtime is re-bootstrapped, a new key is generated and stored
  // in Yagr's n8n-credentials.json, but n8nac's own globalStore may have a stale key.
  // Running init-auth here updates the Conf store so n8nac can authenticate correctly.
  if (testN8nRuntime.host && testN8nRuntime.apiKey) {
    spawnSync(
      'npx',
      ['--yes', n8nacPackage, 'init-auth', '--host', String(testN8nRuntime.host), '--api-key', String(testN8nRuntime.apiKey)],
      {
        cwd: path.join(homeDir, 'n8n-workspace'),
        env: sharedEnv,
        stdio: 'pipe',
        encoding: 'utf8',
      },
    );
  }

  // Call n8nac update-ai to regenerate AGENTS.md in the n8n-workspace directory
  const result = spawnSync('npx', ['--yes', n8nacPackage, 'update-ai', '--silent'], {
    cwd: path.join(homeDir, 'n8n-workspace'),
    env: sharedEnv,
    stdio: 'pipe',
    encoding: 'utf8',
  });

  if ((result.status ?? 1) !== 0) {
    const stderr = String(result.stderr || '').trim();
    const stdout = String(result.stdout || '').trim();
    // Log warning but don't fail — tests can continue even if update-ai fails
    if (debug) {
      logDebug('SETUP', `Warning: n8nac update-ai failed for ${homeDir}: ${stderr || stdout || `exit ${result.status ?? 1}`}`);
    }
  }
}

/**
 * After n8nac update-ai rewrites n8nac-config.json with the real instanceIdentifier,
 * ensure the correct workflow directory exists and remove the provisional 'test/' scaffold.
 */
function reconcileWorkflowDirs(n8nWorkspaceDir) {
  const configPath = path.join(n8nWorkspaceDir, 'n8nac-config.json');
  if (!fs.existsSync(configPath)) return;
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const workflowDir = config.workflowDir;
    if (workflowDir) {
      fs.mkdirSync(path.join(n8nWorkspaceDir, workflowDir), { recursive: true });
    }
    // Remove the provisional 'test/' directory created by initializeTestN8nConfig if it still exists
    const provisionalDir = path.join(n8nWorkspaceDir, 'workflows', 'test');
    if (fs.existsSync(provisionalDir) && workflowDir && !workflowDir.startsWith('workflows/test')) {
      fs.rmSync(provisionalDir, { recursive: true, force: true });
    }
  } catch {
    // best effort
  }
}

function createAdvancedScenarioHome(provider, model, testN8nRuntime = {}) {
  const baseDir = path.join(os.tmpdir(), 'yagr-provider-advanced');
  fs.mkdirSync(baseDir, { recursive: true });
  const tempHome = fs.mkdtempSync(path.join(baseDir, `${provider.replace(/[^a-z0-9]+/gi, '-')}-`));

  // Create isolated Yagr home structure from scratch
  const n8nWorkspaceDir = path.join(tempHome, 'n8n-workspace');
  fs.mkdirSync(n8nWorkspaceDir, { recursive: true });

  // Write Yagr config
  writeIsolatedYagrConfig(tempHome, provider, model);

  // Initialize n8nac config from scratch with test instance
  initializeTestN8nConfig(n8nWorkspaceDir, testN8nRuntime);
  ensureIsolatedHomeProjectCompatibility(tempHome);

  // Persist credentials inside the isolated YAGR_HOME so runtime/config resolution is self-contained.
  writeIsolatedN8nCredentials(tempHome, testN8nRuntime);

  // Seed homeDir/AGENTS.md from the bundled YAGENTS.md template (mirrors ensureHomeInstructionsSeeded in production).
  seedHomeAgentsMd(tempHome);

  // Generate fresh n8n-workspace/AGENTS.md with current n8nac version (mirrors refreshAiContext in production).
  generateTestAgentsMd(tempHome, testN8nRuntime);

  // After generateTestAgentsMd, n8nac update-ai may have rewritten n8nac-config.json with the real
  // instanceIdentifier (e.g. '127_0_0_1:5678_yagr_l'). Ensure the correct workflow directory exists
  // and remove the provisional 'test/' scaffold created by initializeTestN8nConfig.
  reconcileWorkflowDirs(n8nWorkspaceDir);

  return tempHome;
}

function getIsolatedWorkspaceDir(homeDir) {
  return path.join(homeDir, 'n8n-workspace');
}

function initializeTestN8nConfig(n8nWorkspaceDir, testN8nRuntime = {}) {
  const configPath = path.join(n8nWorkspaceDir, 'n8nac-config.json');
  const host = String(testN8nRuntime.host || '').trim() || 'http://127.0.0.1:5678';
  const projectId = String(testN8nRuntime.projectId || '').trim() || 'personal';
  const projectName = projectId === 'personal' ? 'Personal' : projectId;

  const config = {
    version: 2,
    activeInstanceId: 'test-local',
    instances: [
      {
        id: 'test-local',
        name: 'test-local',
        host,
        syncFolder: 'workflows',
        projectId,
        projectName,
        instanceIdentifier: 'test',
        verification: {
          status: 'verified',
          normalizedHost: host,
          userId: 'test-user',
          userName: 'test-user',
          userEmail: 'test@local.yagr',
          lastCheckedAt: new Date().toISOString(),
        },
      },
    ],
    host,
    syncFolder: 'workflows',
    projectId,
    projectName,
    instanceIdentifier: 'test',
  };

  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  // Create the workflow directory structure
  const workflowDir = path.join(n8nWorkspaceDir, 'workflows', 'test', projectId.toLowerCase().replace(/\s+/g, '-'));
  fs.mkdirSync(workflowDir, { recursive: true });
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

function cleanupAdvancedScenarioHome(tempHome) {
  try {
    fs.rmSync(tempHome, { recursive: true, force: true });
  } catch {
    // Best effort cleanup only.
  }
}

function writeIsolatedYagrConfig(tempHome, provider, model) {
  const configPath = path.join(tempHome, 'yagr-config.json');
  const baseUrl = getProviderBaseUrl(provider);
  const localConfig = {
    provider,
    model,
    ...(baseUrl ? { baseUrl } : {}),
  };

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(localConfig, null, 2)}\n`);
}

function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function copyIfExists(source, destination) {
  if (!source || !fs.existsSync(source)) {
    return;
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

async function listRemoteWorkflows() {
  const runtime = resolveTestN8nRuntime();
  const host = runtime.host;
  const projectId = runtime.projectId;
  if (!host || !projectId) {
    return [];
  }

  const apiKey = runtime.apiKey;
  if (!apiKey) {
    return [];
  }

  const client = new N8nApiClient({ host, apiKey });
  const workflows = await client.getAllWorkflows(projectId);
  return workflows.map((workflow) => ({
    id: String(workflow.id),
    name: String(workflow.name || ''),
  }));
}

async function cleanupRemoteWorkflows(beforeSnapshot, beforeDetails = new Map()) {
  const runtime = resolveTestN8nRuntime();
  const host = runtime.host;
  if (!host) {
    return;
  }

  const apiKey = runtime.apiKey;
  if (!apiKey) {
    return;
  }

  const beforeIds = new Set((beforeSnapshot || []).map((workflow) => workflow.id));
  const client = new N8nApiClient({ host, apiKey });
  let afterSnapshot = [];
  try {
    afterSnapshot = await listRemoteWorkflows();
  } catch {
    return;
  }

  const createdWorkflows = afterSnapshot.filter((workflow) => !beforeIds.has(workflow.id));
  await Promise.allSettled(createdWorkflows.map(async (workflow) => {
    await client.deleteWorkflow(workflow.id);
  }));

  const survivingSnapshot = await listRemoteWorkflows();
  const survivingIds = survivingSnapshot
    .filter((workflow) => beforeIds.has(workflow.id))
    .map((workflow) => workflow.id);

  const survivingDetails = await getRemoteWorkflowDetails(survivingIds.map((id) => ({ id })));
  const modifiedWorkflowIds = survivingIds.filter((workflowId) => {
    const before = beforeDetails.get(workflowId);
    const after = survivingDetails.get(workflowId);
    if (!before || !after) {
      return false;
    }
    return serializeWorkflowForComparison(before) !== serializeWorkflowForComparison(after);
  });

  await Promise.allSettled(modifiedWorkflowIds.map(async (workflowId) => {
    const previous = beforeDetails.get(workflowId);
    if (!previous) {
      return;
    }

    const restored = await client.updateWorkflow(workflowId, buildWorkflowRestorePayload(previous));
    if (Array.isArray(previous.tags)) {
      await client.updateWorkflowTags(workflowId, previous.tags);
    }
    if (typeof previous.active === 'boolean') {
      await client.activateWorkflow(workflowId, previous.active);
    } else if (typeof restored?.active === 'boolean') {
      await client.activateWorkflow(workflowId, Boolean(restored.active));
    }
  }));
}

async function getRemoteWorkflowDetails(workflows) {
  const runtime = resolveTestN8nRuntime();
  const host = runtime.host;
  if (!host) {
    return new Map();
  }

  const apiKey = runtime.apiKey;
  if (!apiKey) {
    return new Map();
  }

  const client = new N8nApiClient({ host, apiKey });
  const ids = [...new Set((workflows || []).map((workflow) => String(workflow?.id || '')).filter(Boolean))];
  const detailed = await Promise.allSettled(ids.map(async (id) => [id, await client.getWorkflow(id)]));

  return new Map(
    detailed
      .filter((entry) => entry.status === 'fulfilled' && entry.value[1])
      .map((entry) => entry.value),
  );
}

function buildWorkflowRestorePayload(workflow) {
  const settings = { ...(workflow.settings || {}) };
  const allowedSettings = [
    'errorWorkflow',
    'timezone',
    'saveManualExecutions',
    'saveDataErrorExecution',
    'saveExecutionProgress',
    'executionOrder',
  ];

  const filteredSettings = {};
  for (const key of allowedSettings) {
    if (settings[key] !== undefined) {
      filteredSettings[key] = settings[key];
    }
  }

  if (!filteredSettings.executionOrder) {
    filteredSettings.executionOrder = 'v1';
  }

  return {
    name: workflow.name,
    nodes: workflow.nodes || [],
    connections: workflow.connections || {},
    settings: filteredSettings,
    staticData: workflow.staticData,
    triggerCount: workflow.triggerCount,
  };
}

function serializeWorkflowForComparison(workflow) {
  const settings = { ...(workflow.settings || {}) };
  delete settings.executionUrl;
  delete settings.availableInMCP;
  delete settings.callerPolicy;
  delete settings.saveDataErrorExecution;
  delete settings.saveManualExecutions;
  delete settings.saveExecutionProgress;
  delete settings.trialStartedAt;

  return JSON.stringify({
    name: workflow.name,
    nodes: workflow.nodes || [],
    connections: workflow.connections || {},
    settings,
    active: Boolean(workflow.active),
    tags: Array.isArray(workflow.tags)
      ? workflow.tags.map((tag) => ({ id: tag.id, name: tag.name })).sort((a, b) => String(a.id).localeCompare(String(b.id)))
      : [],
  });
}

function snapshotWorkflowFiles(baseDir) {
  if (!baseDir || !fs.existsSync(baseDir)) {
    return new Map();
  }

  const entries = new Map();
  const scan = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.workflow.ts')) {
        const content = fs.readFileSync(fullPath, 'utf8');
        entries.set(fullPath, {
          content,
          mtimeMs: fs.statSync(fullPath).mtimeMs,
        });
      }
    }
  };
  scan(baseDir);
  return entries;
}

function diffWorkflowSnapshots(beforeSnapshot, afterSnapshot) {
  const changed = [];
  for (const [filePath, after] of afterSnapshot.entries()) {
    const before = beforeSnapshot.get(filePath);
    if (!before || before.content !== after.content || before.mtimeMs !== after.mtimeMs) {
      changed.push({
        filePath,
        content: after.content,
      });
    }
  }
  return changed;
}

function validateWorkflowMatchesPrompt(prompt, changedWorkflows) {
  const normalizedPrompt = String(prompt || '').toLowerCase();
  if (!normalizedPrompt.includes('manual trigger') || !normalizedPrompt.includes('status="ok"')) {
    return { ok: true };
  }

  const matchingWorkflow = changedWorkflows.find(({ content }) => {
    const normalizedContent = String(content || '').toLowerCase();
    const hasManualTrigger = normalizedContent.includes('manualtrigger');
    const hasSetNode = normalizedContent.includes('set');
    const hasStatusOk = normalizedContent.includes('status') && normalizedContent.includes('ok');
    return hasManualTrigger && hasSetNode && hasStatusOk;
  });

  if (matchingWorkflow) {
    return { ok: true };
  }

  const createdFiles = changedWorkflows.map(({ filePath }) => path.basename(filePath)).join(', ');
  return {
    ok: false,
    error: `CLI scenario created or modified workflow files but none matched the requested shape (expected Manual Trigger + Set status=\"ok\"). Files: ${createdFiles || 'none'}`,
  };
}

function validateRemoteWorkflowsMatchPrompt(prompt, workflows) {
  if (!Array.isArray(workflows) || workflows.length === 0) {
    return {
      ok: false,
      error: 'No remote workflow was created during the advanced scenario.',
    };
  }

  const normalizedPrompt = String(prompt || '').toLowerCase();
  if (!normalizedPrompt.includes('manual trigger') || !normalizedPrompt.includes('status="ok"')) {
    return { ok: true };
  }

  const matchingWorkflow = workflows.find((workflow) => {
    const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
    const hasManualTrigger = nodes.some((node) => String(node?.type || '').toLowerCase().includes('manualtrigger'));
    const setNode = nodes.find((node) => String(node?.type || '').toLowerCase().includes('set'));
    const setPayload = JSON.stringify(setNode?.parameters || {}).toLowerCase();
    const hasStatusOk = setPayload.includes('status') && setPayload.includes('ok');
    return hasManualTrigger && Boolean(setNode) && hasStatusOk;
  });

  if (matchingWorkflow) {
    return { ok: true };
  }

  return {
    ok: false,
    error: `CLI scenario created remote workflows but none matched the requested shape (expected Manual Trigger + Set status=\"ok\"). Remote workflows: ${workflows.map((workflow) => workflow.name || workflow.id).join(', ') || 'none'}`,
  };
}

async function getCreatedRemoteWorkflows(beforeSnapshot) {
  const runtime = resolveTestN8nRuntime();
  const host = runtime.host;
  if (!host) {
    return [];
  }

  const apiKey = runtime.apiKey;
  if (!apiKey) {
    return [];
  }

  const client = new N8nApiClient({ host, apiKey });
  const beforeIds = new Set((beforeSnapshot || []).map((workflow) => workflow.id));
  const afterSnapshot = await listRemoteWorkflows();
  const createdWorkflows = afterSnapshot.filter((workflow) => !beforeIds.has(workflow.id));
  const detailed = await Promise.allSettled(createdWorkflows.map(async (workflow) => await client.getWorkflow(workflow.id)));

  return detailed
    .filter((entry) => entry.status === 'fulfilled')
    .map((entry) => entry.value);
}

function isTransientRateLimit(message) {
  const normalized = String(message || '').toLowerCase();
  return (
    normalized.includes('rate limit')
    || normalized.includes('resource_exhausted')
    || normalized.includes('too many requests')
    || normalized.includes('http 429')
    || normalized.includes('status code 429')
  );
}

function isInfrastructureError(message) {
  const normalized = String(message || '').toLowerCase();
  return (
    normalized.includes('socket hang up')
    || normalized.includes('econnrefused')
    || normalized.includes('econnreset')
    || normalized.includes('enotfound')
  );
}

function normalizeAssistantResponse(text) {
  return String(text || '').trim();
}

function compactText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function formatAdvancedChecklistNote(checklist) {
  if (!checklist) {
    return '';
  }

  const parts = [
    `checklist: n8nac=${checklist.usedN8nac ? 'yes' : 'no'}`,
    `actions=${checklist.actionNames.length > 0 ? checklist.actionNames.join('/') : 'none'}`,
    `push=${checklist.hasPush ? 'yes' : 'no'}`,
    `verify=${checklist.hasVerify ? 'yes' : 'no'}`,
    `embed=${checklist.hasWorkflowEmbed ? 'yes' : 'no'}`,
    `embedUrl=${checklist.hasWorkflowEmbedUrl ? 'yes' : 'no'}`,
    `embedDiagram=${checklist.hasWorkflowEmbedDiagram ? 'yes' : 'no'}`,
    `workflowFile=${checklist.wroteWorkflowFile ? 'yes' : 'no'}`,
    `remoteCreated=${checklist.remoteWorkflowCount}`,
    `blockingActions=${checklist.blockingRequiredActionCount}`,
    `followUps=${checklist.followUpRequiredActionCount}`,
  ];
  return parts.join(', ');
}

function writeAdvancedFailureLog(provider, payload) {
  try {
    const dir = path.join(process.cwd(), 'reports', 'provider-advanced-logs');
    fs.mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(dir, `${provider}-${ts}.log`);
    fs.writeFileSync(filePath, [
      `provider=${provider}`,
      `timestamp=${new Date().toISOString()}`,
      `model=${payload.model}`,
      `prompt=${payload.prompt}`,
      `exitCode=${payload.code}`,
      `timedOut=${payload.timedOut ? 'true' : 'false'}`,
      payload.checklist ? `checklist=${JSON.stringify(payload.checklist)}` : '',
      payload.assistantResponse ? `assistantResponse=${payload.assistantResponse}` : '',
      '',
      '--- stdout ---',
      payload.stdout || '',
      '',
      '--- stderr ---',
      payload.stderr || '',
      payload.toolEvents ? `\n--- tool-events ---\n${JSON.stringify(payload.toolEvents, null, 2)}` : '',
      payload.journal ? `\n--- journal ---\n${JSON.stringify(payload.journal, null, 2)}` : '',
      '',
    ].join('\n'));
    return filePath;
  } catch {
    return '';
  }
}
