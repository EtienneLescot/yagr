#!/usr/bin/env node
import process from 'node:process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { config as dotenvConfig } from 'dotenv';
import { N8nApiClient } from 'n8nac';

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
const { createLanguageModel } = await import('../dist/llm/create-language-model.js');
const { getProviderTestModelPreferences } = await import('../dist/llm/test-model-policy.js');
const { getYagrSetupStatus } = await import('../dist/setup.js');
const { YagrConfigService } = await import('../dist/config/yagr-config-service.js');
const { YagrN8nConfigService } = await import('../dist/config/n8n-config-service.js');
const { getYagrPaths } = await import('../dist/config/yagr-home.js');
const { YagrAgent } = await import('../dist/agent.js');
const { createN8nEngineFromWorkspace } = await import('../dist/config/load-n8n-engine-config.js');
const { analyzeRunOutcome, formatObservedAction } = await import('../dist/runtime/outcome.js');

const DEFAULT_TIMEOUT_MS = toInt(process.env.YAGR_IT_TIMEOUT_MS, 60_000);
const INFERENCE_TIMEOUT_MS = toInt(process.env.YAGR_IT_INFERENCE_TIMEOUT_MS, 75_000);
const MAX_MODEL_LIST_ROWS = toInt(process.env.YAGR_IT_MODEL_SAMPLE_SIZE, 8);

const args = new Set(process.argv.slice(2));
const argv = process.argv.slice(2);
const strict = args.has('--strict');
const json = args.has('--json');
const markdownDisabled = args.has('--no-markdown');
const markdownPath = process.env.YAGR_IT_MARKDOWN_PATH || path.join(process.cwd(), 'reports', 'provider-integration-matrix.md');
const advanced = args.has('--advanced') || process.env.YAGR_IT_ADVANCED === '1';
const advancedPrompt = process.env.YAGR_IT_ADVANCED_PROMPT
  || 'Crée immédiatement un workflow n8n minimal avec exactement deux noeuds: un Manual Trigger puis un Set qui définit status=\"ok\". Ne me pose aucune question. Utilise les outils n8n disponibles, enregistre le workflow et pousse-le.';
const advancedTimeoutMs = toInt(process.env.YAGR_IT_ADVANCED_TIMEOUT_MS, 120_000);
const forcedModel = String(process.env.YAGR_IT_FORCE_MODEL || '').trim();

const providersFromCli = readProvidersFromCli(argv);
const requestedProviders = (providersFromCli || process.env.YAGR_IT_PROVIDERS || '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);
const providers = requestedProviders.length > 0
  ? requestedProviders.map((entry) => normalizeProviderSelector(entry))
  : [...YAGR_SUPPORTED_MODEL_PROVIDERS];

configureWritableOAuthPaths();

const results = [];

for (const provider of providers) {
  const providerResult = await runProvider(provider);
  results.push(providerResult);
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
  const definition = getProviderDefinition(provider);
  const configuredApiKey = getProviderApiKey(provider);
  const configuredBaseUrl = getProviderBaseUrl(provider);

  const setup = await runStep(async () => {
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
      return {
        status: missingCredential ? 'SKIP' : 'FAIL',
        note: reason,
      };
    }

    return {
      status: 'PASS',
      note: summarizeModels(prepared.runtime.models),
      runtime: prepared.runtime,
    };
  }, DEFAULT_TIMEOUT_MS);

  const setupRuntime = setup.runtime;

  const modelListing = await runStep(async () => {
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

  const inference = await runStep(async () => {
    if (setup.status === 'SKIP') {
      return { status: 'SKIP', note: 'Skipped because setup is not available.' };
    }

    const chosenModel = chooseModel(setupRuntime?.models, modelListing.models, provider);
    const model = createLanguageModel({
      provider,
      model: chosenModel,
      apiKey: setupRuntime?.apiKey || configuredApiKey,
      baseUrl: setupRuntime?.baseUrl || configuredBaseUrl,
    });

    let response;
    try {
      response = await withTimeout(model.doGenerate({
        inputFormat: 'prompt',
        mode: { type: 'regular' },
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Reply with exactly: OK' }] }],
      }), INFERENCE_TIMEOUT_MS);
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

    const text = String(response?.text || '').trim();
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

  const advancedScenario = await runStep(async () => {
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

    if (!setupStatus.llmConfigured && setup.status !== 'PASS') {
      return {
        status: 'SKIP',
        note: 'LLM setup is not configured for this workspace.',
      };
    }

    const chosenModel = chooseModel(setupRuntime?.models, modelListing.models, provider);
    const result = await runYagrAdvancedScenario({ provider, model: chosenModel, prompt: advancedPrompt, timeoutMs: advancedTimeoutMs });
    const checklistNote = formatAdvancedChecklistNote(result.checklist);
    if (result.ok) {
      return {
        status: 'PASS',
        note: checklistNote
          ? `CLI scenario succeeded with model ${chosenModel}. ${checklistNote}`
          : `CLI scenario succeeded with model ${chosenModel}.`,
        response: result.assistantResponse || '',
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
    };
  }, advancedTimeoutMs + 5_000);

  return {
    provider,
    providerLabel: getProviderDisplayName(provider),
    setup: serializeStep(setup),
    modelListing: serializeStep(modelListing),
    inference: serializeStep(inference),
    advancedScenario: serializeStep(advancedScenario),
  };
}

async function runStep(fn, timeoutMs) {
  try {
    return await withTimeout(fn(), timeoutMs);
  } catch (error) {
    return {
      status: 'FAIL',
      note: error instanceof Error ? error.message : String(error),
    };
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
    groq: process.env.GROQ_API_KEY || process.env.GROQ_LLM_API_KEY,
    mistral: process.env.MISTRAL_API_KEY || process.env.MISTRAL_LLM_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_LLM_API_KEY,
    'openai-proxy': process.env.YAGR_OPENAI_PROXY_TOKEN,
    'anthropic-proxy': process.env.YAGR_ANTHROPIC_SETUP_TOKEN,
    'google-proxy': process.env.YAGR_GEMINI_ACCESS_TOKEN,
    'copilot-proxy': process.env.YAGR_COPILOT_TOKEN,
  };
  return byProvider[provider];
}

function getProviderBaseUrl(provider) {
  const envKey = `YAGR_${provider.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_BASE_URL`;
  return process.env[envKey] || getDefaultBaseUrlForProvider(provider);
}

function resolveTestN8nRuntime() {
  const configuredHost = String(process.env.N8N_HOST || process.env.YAGR_IT_N8N_HOST || '').trim();
  const configuredApiKey = String(process.env.N8N_API_KEY || process.env.YAGR_IT_N8N_API_KEY || '').trim();
  const configuredProjectId = String(process.env.N8N_PROJECT_ID || process.env.YAGR_IT_N8N_PROJECT_ID || '').trim();
  const configService = new YagrN8nConfigService();
  const localConfig = configService.getLocalConfig();
  const fallbackHost = String(localConfig.host || '').trim();
  const host = configuredHost || fallbackHost;
  const apiKey = configuredApiKey || (host ? String(configService.getApiKey(host) || '').trim() : '');
  const projectId = configuredProjectId || String(localConfig.projectId || '').trim();

  return {
    host,
    apiKey,
    projectId,
    configured: Boolean(host && apiKey),
  };
}

function configureWritableOAuthPaths() {
  const base = path.join(os.tmpdir(), 'yagr-provider-matrix');
  const sourcePaths = getYagrPaths();

  process.env.YAGR_GEMINI_SESSION_PATH ||= path.join(base, 'gemini-session.json');
  process.env.YAGR_GEMINI_AUTH_PATH ||= path.join(base, 'gemini-oauth-creds.json');
  process.env.YAGR_GEMINI_SETTINGS_PATH ||= path.join(base, 'gemini-settings.json');
  process.env.YAGR_COPILOT_SESSION_PATH ||= path.join(base, 'copilot-session.json');
  process.env.YAGR_COPILOT_TOKEN_CACHE_PATH ||= path.join(base, 'copilot-token-cache.json');
  process.env.YAGR_GH_HOSTS_PATH ||= path.join(os.homedir(), '.config', 'gh', 'hosts.yml');

  copyIfExists(path.join(sourcePaths.accountAuthDir, 'gemini-oauth.json'), process.env.YAGR_GEMINI_SESSION_PATH);
  copyIfExists(path.join(os.homedir(), '.gemini', 'oauth_creds.json'), process.env.YAGR_GEMINI_AUTH_PATH);
  copyIfExists(path.join(os.homedir(), '.gemini', 'settings.json'), process.env.YAGR_GEMINI_SETTINGS_PATH);
  copyIfExists(path.join(sourcePaths.accountAuthDir, 'copilot-oauth.json'), process.env.YAGR_COPILOT_SESSION_PATH);
  copyIfExists(path.join(sourcePaths.accountAuthDir, 'copilot-runtime-token.json'), process.env.YAGR_COPILOT_TOKEN_CACHE_PATH);
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
    ? ['Provider', 'Setup', 'Model Listing', 'Inference', 'Advanced Scenario']
    : ['Provider', 'Setup', 'Model Listing', 'Inference'];
  const renderedRows = rows.map((row) => ([
    `${row.providerLabel} (${row.provider})`,
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
  const responseSuffix = step.response
    ? ` response: ${truncate(compactText(step.response), 110)}`
    : '';
  return `${step.status} - ${truncate(step.note || '', 110)}${responseSuffix}`;
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
    '## Details',
    '',
    ...(advanced
      ? ['| Provider | Setup | Model Listing | Inference | Advanced Scenario |', '| --- | --- | --- | --- | --- |']
      : ['| Provider | Setup | Model Listing | Inference |', '| --- | --- | --- | --- |']),
    ...rows.map((row) =>
      advanced
        ? `| \`${escapeMd(`${row.providerLabel} (${row.provider})`)}\` | ${formatMarkdownCell(row.setup)} | ${formatMarkdownCell(row.modelListing)} | ${formatMarkdownCell(row.inference)} | ${formatMarkdownCell(row.advancedScenario)} |`
        : `| \`${escapeMd(`${row.providerLabel} (${row.provider})`)}\` | ${formatMarkdownCell(row.setup)} | ${formatMarkdownCell(row.modelListing)} | ${formatMarkdownCell(row.inference)} |`),
    '',
  ];

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, lines.join('\n'));
}

function formatMarkdownCell(step) {
  const response = step.response
    ? `<br>Response: ${escapeMd(compactText(step.response || ''))}`
    : '';
  return `**${step.status}**<br>${escapeMd(step.note || '')}${response}`;
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
    'gemini-oauth': 'google-proxy',
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
  const isolatedHome = createAdvancedScenarioHome(provider, testN8nRuntime);
  const workflowDir = resolveActiveWorkflowDir(isolatedHome);
  const beforeSnapshot = snapshotWorkflowFiles(workflowDir);
  const beforeRemoteSnapshot = await listRemoteWorkflows();
  const beforeRemoteDetails = await getRemoteWorkflowDetails(beforeRemoteSnapshot);
  const effectivePrompt = buildAdvancedScenarioPrompt(prompt, provider);

  try {
    const execution = await runAdvancedAgentInProcess({
      provider,
      model,
      prompt: effectivePrompt,
      isolatedHome,
      timeoutMs,
      testN8nRuntime,
    });
    const afterSnapshot = snapshotWorkflowFiles(workflowDir);
    const changedWorkflows = diffWorkflowSnapshots(beforeSnapshot, afterSnapshot);
    const createdRemoteWorkflows = await getCreatedRemoteWorkflows(beforeRemoteSnapshot);
    const checklist = buildAdvancedChecklist({
      journal: execution.journal,
      toolEvents: execution.toolEvents,
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
    cleanupAdvancedScenarioHome(isolatedHome);
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

  if (checklist?.usedN8nac && checklist?.hasPush && (checklist?.hasVerify || checklist?.hasValidate)) {
    if (checklist.wroteWorkflowFile && (!checklist.hasWorkflowEmbed || !checklist.hasWorkflowEmbedUrl || !checklist.hasWorkflowEmbedDiagram)) {
      return {
        ok: false,
        error: 'CLI scenario completed the workflow actions but did not emit a complete workflow banner embed (url + diagram).',
      };
    }
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
    YAGR_LAUNCH_CWD: process.cwd(),
    ...(testN8nRuntime.host ? { N8N_HOST: testN8nRuntime.host } : {}),
    ...(testN8nRuntime.apiKey ? { N8N_API_KEY: testN8nRuntime.apiKey } : {}),
    ...(testN8nRuntime.projectId ? { N8N_PROJECT_ID: testN8nRuntime.projectId } : {}),
  };

  return await withScopedEnv(envOverrides, async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);

    try {
      const engine = await createN8nEngineFromWorkspace();
      const agent = new YagrAgent(engine);
      const result = await agent.run(prompt, {
        provider,
        model,
        maxSteps: 10,
        abortSignal: controller.signal,
        onTextDelta: async (textDelta) => {
          stdoutChunks.push(String(textDelta));
        },
        onToolEvent: async (event) => {
          toolEvents.push(event);
          if (event.type === 'command-start') {
            stderrChunks.push(`[tool:${event.toolName}] START ${event.command}`);
          } else if (event.type === 'command-output') {
            stderrChunks.push(`[tool:${event.toolName}] ${event.stream}: ${String(event.chunk).trimEnd()}`);
          } else if (event.type === 'command-end') {
            stderrChunks.push(`[tool:${event.toolName}] END exit=${event.exitCode}${event.timedOut ? ' timedOut=1' : ''}`);
          } else if (event.type === 'status' || event.type === 'result') {
            stderrChunks.push(`[tool:${event.toolName}] ${event.type}: ${event.message}`);
          }
        },
        onJournalEntry: async (entry) => {
          journal.push(entry);
        },
      });

      return {
        stdout: result.text || stdoutChunks.join(''),
        stderr: stderrChunks.join('\n'),
        journal: result.journal || journal,
        toolEvents,
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
        timedOut: /timeout after/i.test(message),
        error: message,
      };
    } finally {
      clearTimeout(timer);
    }
  });
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
  journal,
  toolEvents,
  changedWorkflows,
  createdRemoteWorkflows,
}) {
  const outcome = analyzeRunOutcome(journal || []);
  const n8nacActions = [...outcome.successfulActions, ...outcome.failedActions];
  const actionNames = n8nacActions.map((action) => action.action);
  const commandStarts = (toolEvents || []).filter((event) => event.type === 'command-start' && event.toolName === 'n8nac');
  const commandEnds = (toolEvents || []).filter((event) => event.type === 'command-end' && event.toolName === 'n8nac');
  const workflowEmbeds = (toolEvents || []).filter((event) => event.type === 'embed' && event.kind === 'workflow');

  return {
    usedN8nac: commandStarts.length > 0 || n8nacActions.length > 0,
    n8nacActionCount: n8nacActions.length,
    commandStartCount: commandStarts.length,
    commandEndCount: commandEnds.length,
    actionNames,
    successfulActions: outcome.successfulActions.map(formatObservedAction),
    failedActions: outcome.failedActions.map(formatObservedAction),
    hasPush: Boolean(outcome.successfulPush),
    hasVerify: Boolean(outcome.successfulVerify),
    hasValidate: Boolean(outcome.successfulValidate),
    hasWorkflowEmbed: workflowEmbeds.length > 0,
    hasWorkflowEmbedUrl: workflowEmbeds.some((event) => Boolean(String(event.url || '').trim())),
    hasWorkflowEmbedDiagram: workflowEmbeds.some((event) => Boolean(String(event.diagram || '').trim())),
    wroteWorkflowFile: Boolean(outcome.hasWorkflowWrites),
    changedWorkflowFileCount: (changedWorkflows || []).length,
    remoteWorkflowCount: Array.isArray(createdRemoteWorkflows) ? createdRemoteWorkflows.length : 0,
  };
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

function buildAdvancedScenarioPrompt(prompt, provider) {
  const marker = `yagr-it-${provider.replace(/[^a-z0-9]+/gi, '-')}-${Date.now()}`;
  return `${prompt}\n\nContraintes de test:\n- Cree un nouveau workflow.\n- Donne-lui un nom unique qui commence par "${marker}".\n- N'update pas un workflow existant.\n- Ne pose aucune question et n'attends aucune confirmation.\n- Termine seulement quand le workflow est enregistre et pousse.`;
}

function createAdvancedScenarioHome(provider, testN8nRuntime = {}) {
  const baseDir = path.join(os.tmpdir(), 'yagr-provider-advanced');
  fs.mkdirSync(baseDir, { recursive: true });
  const tempHome = fs.mkdtempSync(path.join(baseDir, `${provider.replace(/[^a-z0-9]+/gi, '-')}-`));
  const sourcePaths = getYagrPaths();

  copyIfExists(sourcePaths.yagrConfigPath, path.join(tempHome, 'yagr-config.json'));
  copyIfExists(sourcePaths.yagrCredentialsPath, path.join(tempHome, 'credentials.json'));
  copyIfExists(sourcePaths.n8nCredentialsPath, path.join(tempHome, 'n8n-credentials.json'));
  copyIfExists(sourcePaths.homeInstructionsPath, path.join(tempHome, 'AGENTS.md'));
  copyDirIfExists(sourcePaths.n8nWorkspaceDir, path.join(tempHome, 'n8n-workspace'));
  reconcileAdvancedScenarioN8nRuntime(tempHome, testN8nRuntime);

  return tempHome;
}

function cleanupAdvancedScenarioHome(tempHome) {
  try {
    fs.rmSync(tempHome, { recursive: true, force: true });
  } catch {
    // Best effort cleanup only.
  }
}

function copyIfExists(source, destination) {
  if (!source || !fs.existsSync(source)) {
    return;
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function copyIfMissing(source, destination) {
  if (!destination || fs.existsSync(destination)) {
    return;
  }

  copyIfExists(source, destination);
}

function copyDirIfExists(sourceDir, destinationDir) {
  if (!sourceDir || !fs.existsSync(sourceDir)) {
    return;
  }

  fs.mkdirSync(path.dirname(destinationDir), { recursive: true });
  fs.cpSync(sourceDir, destinationDir, { recursive: true });
}

function reconcileAdvancedScenarioN8nRuntime(tempHome, testN8nRuntime = {}) {
  const host = String(testN8nRuntime.host || '').trim();
  const apiKey = String(testN8nRuntime.apiKey || '').trim();
  const projectId = String(testN8nRuntime.projectId || '').trim();

  if (!host && !apiKey && !projectId) {
    return;
  }

  const configPath = path.join(tempHome, 'n8n-workspace', 'n8nac-config.json');
  const credentialsPath = path.join(tempHome, 'n8n-credentials.json');
  const normalizedHost = normalizeHostForStore(host);
  const localConfig = readJsonIfExists(configPath) || {};
  const credentialStore = readJsonIfExists(credentialsPath) || {};
  const nextHosts = {
    ...((credentialStore && typeof credentialStore.hosts === 'object' && credentialStore.hosts) || {}),
  };
  const previousHost = String(localConfig.host || '').trim();
  const previousProjectId = String(localConfig.projectId || '').trim();
  const hostChanged = Boolean(host && normalizeHostForStore(previousHost) !== normalizedHost);
  const projectChanged = Boolean(projectId && previousProjectId && previousProjectId !== projectId);

  if (host) {
    localConfig.host = host;
  }

  if (projectId) {
    localConfig.projectId = projectId;
  }

  if (!localConfig.syncFolder) {
    localConfig.syncFolder = 'workflows';
  }

  if ((hostChanged || projectChanged) && localConfig.instanceIdentifier) {
    delete localConfig.instanceIdentifier;
  }

  if (projectId === 'personal') {
    localConfig.projectName = 'Personal';
  }

  if (host && apiKey) {
    nextHosts[normalizedHost] = apiKey;
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(localConfig, null, 2)}\n`);

  fs.mkdirSync(path.dirname(credentialsPath), { recursive: true });
  fs.writeFileSync(credentialsPath, `${JSON.stringify({ ...credentialStore, hosts: nextHosts }, null, 2)}\n`);
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

function normalizeHostForStore(host) {
  try {
    return new URL(host).origin;
  } catch {
    return String(host || '').trim().replace(/\/$/, '');
  }
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

function snapshotWorkflowFiles(workflowDir) {
  if (!workflowDir || !fs.existsSync(workflowDir)) {
    return new Map();
  }

  const entries = new Map();
  for (const entry of fs.readdirSync(workflowDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.workflow.ts')) {
      continue;
    }
    const filePath = path.join(workflowDir, entry.name);
    const content = fs.readFileSync(filePath, 'utf8');
    entries.set(filePath, {
      content,
      mtimeMs: fs.statSync(filePath).mtimeMs,
    });
  }
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
