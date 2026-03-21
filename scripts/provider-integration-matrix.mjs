#!/usr/bin/env node
import process from 'node:process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig({ path: '.env', quiet: true, override: true });
dotenvConfig({ path: '.env.test', quiet: true, override: true });

const {
  YAGR_MODEL_PROVIDERS,
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
const advancedPrompt = process.env.YAGR_IT_ADVANCED_PROMPT || 'Crée moi un petit workflow n8n: un manual trigger puis un node Set qui met status=\"ok\".';
const advancedTimeoutMs = toInt(process.env.YAGR_IT_ADVANCED_TIMEOUT_MS, 120_000);

const providersFromCli = readProvidersFromCli(argv);
const requestedProviders = (providersFromCli || process.env.YAGR_IT_PROVIDERS || '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);
const providers = requestedProviders.length > 0
  ? requestedProviders.map((entry) => normalizeProviderSelector(entry))
  : [...YAGR_MODEL_PROVIDERS];

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

    const setupStatus = getYagrSetupStatus(new YagrConfigService(), new YagrN8nConfigService());
    if (!setupStatus.n8nConfigured) {
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
    if (result.ok) {
      return {
        status: 'PASS',
        note: `CLI scenario succeeded with model ${chosenModel}.`,
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
      note: result.error,
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

function configureWritableOAuthPaths() {
  const base = path.join(os.tmpdir(), 'yagr-provider-matrix');
  process.env.YAGR_GEMINI_SESSION_PATH ||= path.join(base, 'gemini-session.json');
  process.env.YAGR_GEMINI_AUTH_PATH ||= path.join(base, 'gemini-oauth-creds.json');
  process.env.YAGR_GEMINI_SETTINGS_PATH ||= path.join(base, 'gemini-settings.json');
  process.env.YAGR_COPILOT_SESSION_PATH ||= path.join(base, 'copilot-session.json');
  process.env.YAGR_COPILOT_TOKEN_CACHE_PATH ||= path.join(base, 'copilot-token-cache.json');
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
    formatCell(row.setup.status, row.setup.note),
    formatCell(row.modelListing.status, row.modelListing.note),
    formatCell(row.inference.status, row.inference.note),
    ...(advanced ? [formatCell(row.advancedScenario.status, row.advancedScenario.note)] : []),
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

function formatCell(status, note) {
  return `${status} - ${truncate(note || '', 110)}`;
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
  return `**${step.status}**<br>${escapeMd(step.note || '')}`;
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
  const workflowDir = resolveActiveWorkflowDir();
  const beforeSnapshot = snapshotWorkflowFiles(workflowDir);

  return await new Promise((resolve) => {
    const cliPath = path.join(process.cwd(), 'dist', 'cli.js');
    const args = [
      cliPath,
      '--provider', provider,
      '--model', model,
      '--max-steps', '10',
      '--hide-thinking',
      prompt,
    ];

    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ ok: false, error: `Timeout after ${timeoutMs}ms` });
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, error: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        const afterSnapshot = snapshotWorkflowFiles(workflowDir);
        const validation = validateAdvancedScenarioResult({
          stdout,
          stderr,
          prompt,
          workflowDir,
          beforeSnapshot,
          afterSnapshot,
        });
        if (validation.ok) {
          resolve({ ok: true });
          return;
        }

        const logPath = writeAdvancedFailureLog(provider, { code, stdout, stderr, prompt, model });
        resolve({
          ok: false,
          error: logPath ? `${validation.error} (log: ${logPath})` : validation.error,
        });
        return;
      }
      const merged = `${stdout}\n${stderr}`.trim().replace(/\s+/g, ' ');
      const stderrLine = String(stderr)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .pop();
      const logPath = writeAdvancedFailureLog(provider, { code, stdout, stderr, prompt, model });
      const base = truncate(stderrLine || merged || `CLI exited with code ${code ?? 1}`, 160);
      resolve({
        ok: false,
        error: logPath ? `${base} (log: ${logPath})` : base,
      });
    });
  });
}

function validateAdvancedScenarioResult({
  stdout,
  stderr,
  prompt,
  workflowDir,
  beforeSnapshot,
  afterSnapshot,
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

  const changedWorkflows = diffWorkflowSnapshots(beforeSnapshot, afterSnapshot);
  if (changedWorkflows.length === 0) {
    return {
      ok: false,
      error: `CLI scenario exited cleanly but created or modified no .workflow.ts file in ${workflowDir || 'the active workflow directory'}: ${truncate(normalized, 220)}`,
    };
  }

  const promptValidation = validateWorkflowMatchesPrompt(prompt, changedWorkflows);
  if (!promptValidation.ok) {
    return {
      ok: false,
      error: promptValidation.error,
    };
  }

  return { ok: true };
}

function resolveActiveWorkflowDir() {
  try {
    const configPath = path.join(os.homedir(), '.yagr', 'n8n-workspace', 'n8nac-config.json');
    if (!fs.existsSync(configPath)) {
      return '';
    }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const instanceIdentifier = String(config.instanceIdentifier || '').trim();
    const projectId = String(config.projectId || '').trim();
    if (!instanceIdentifier || !projectId) {
      return '';
    }
    return path.join(os.homedir(), '.yagr', 'n8n-workspace', 'workflows', instanceIdentifier, projectId);
  } catch {
    return '';
  }
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
      '',
      '--- stdout ---',
      payload.stdout || '',
      '',
      '--- stderr ---',
      payload.stderr || '',
      '',
    ].join('\n'));
    return filePath;
  } catch {
    return '';
  }
}
