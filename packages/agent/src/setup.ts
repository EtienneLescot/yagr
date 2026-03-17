import * as p from '@clack/prompts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  ConfigService as N8nConfigService,
  N8nApiClient,
  WorkspaceSetupService,
  getDisplayProjectName,
  type IProject,
} from 'n8nac';
import { HolonConfigService } from './config/holon-config-service.js';
import { getHolonHomeDir } from './config/holon-home.js';
import { getGatewaySupervisorStatus } from './gateway/manager.js';
import { setupTelegramGateway } from './gateway/telegram.js';
import type { GatewaySurface } from './gateway/types.js';
import { resolveLanguageModelConfig, resolveModelName, resolveModelProvider, type HolonModelProvider } from './llm/create-language-model.js';

const execFileAsync = promisify(execFile);

const VALID_PROVIDERS: HolonModelProvider[] = [
  'anthropic',
  'openai',
  'google',
  'groq',
  'mistral',
  'openrouter',
];

export interface HolonSetupStatus {
  ready: boolean;
  n8nConfigured: boolean;
  llmConfigured: boolean;
  enabledSurfaces: GatewaySurface[];
  startableSurfaces: GatewaySurface[];
  missingSteps: Array<'n8n' | 'llm' | 'surfaces'>;
}

export function buildHolonSetupStatus(input: {
  n8nConfigured: boolean;
  llmConfigured: boolean;
  enabledSurfaces: GatewaySurface[];
  startableSurfaces: GatewaySurface[];
}): HolonSetupStatus {
  const missingSteps: Array<'n8n' | 'llm' | 'surfaces'> = [];

  if (!input.n8nConfigured) {
    missingSteps.push('n8n');
  }

  if (!input.llmConfigured) {
    missingSteps.push('llm');
  }

  if (input.startableSurfaces.length === 0) {
    missingSteps.push('surfaces');
  }

  return {
    ready: missingSteps.length === 0,
    n8nConfigured: input.n8nConfigured,
    llmConfigured: input.llmConfigured,
    enabledSurfaces: input.enabledSurfaces,
    startableSurfaces: input.startableSurfaces,
    missingSteps,
  };
}

export function getHolonSetupStatus(
  holonConfigService = new HolonConfigService(),
  n8nConfigService = new N8nConfigService(),
): HolonSetupStatus {
  const holonConfig = holonConfigService.getLocalConfig();
  const n8nConfig = n8nConfigService.getLocalConfig();
  const gatewayStatus = getGatewaySupervisorStatus(holonConfigService);

  const n8nConfigured = Boolean(
    n8nConfig.host
    && n8nConfig.syncFolder
    && n8nConfig.projectId
    && n8nConfig.projectName
    && n8nConfigService.getApiKey(n8nConfig.host),
  );

  let llmConfigured = false;
  try {
    const resolvedConfig = resolveLanguageModelConfig({}, holonConfigService);
    llmConfigured = Boolean(resolvedConfig.provider && resolvedConfig.model && resolvedConfig.apiKey);
  } catch {
    llmConfigured = false;
  }

  return buildHolonSetupStatus({
    n8nConfigured,
    llmConfigured,
    enabledSurfaces: gatewayStatus.enabledSurfaces,
    startableSurfaces: gatewayStatus.startableSurfaces,
  });
}

export async function runHolonSetup(
  holonConfigService = new HolonConfigService(),
  n8nConfigService = new N8nConfigService(),
): Promise<boolean> {
  p.intro('Holon setup');
  p.note(
    [
      'This wizard configures your n8n backend, your default LLM, and your gateway surfaces.',
      'After this, you should only need `holon start`.',
    ].join('\n'),
    'Setup flow',
  );

  const n8nCompleted = await runN8nSetup(n8nConfigService);
  if (!n8nCompleted) {
    p.cancel('Holon setup cancelled during n8n setup.');
    return false;
  }

  const llmCompleted = await runLlmSetup(holonConfigService);
  if (!llmCompleted) {
    p.cancel('Holon setup cancelled during LLM setup.');
    return false;
  }

  const surfacesCompleted = await runSurfaceSetup(holonConfigService);
  if (!surfacesCompleted) {
    p.cancel('Holon setup cancelled during gateway setup.');
    return false;
  }

  const status = getHolonSetupStatus(holonConfigService, n8nConfigService);
  const n8nLocalConfig = n8nConfigService.getLocalConfig();
  const holonLocalConfig = holonConfigService.getLocalConfig();

  p.outro(
    [
      'Holon setup complete.',
      `n8n project: ${n8nLocalConfig.projectName ?? 'unknown'}`,
      `LLM: ${holonLocalConfig.provider ?? 'unknown'} / ${holonLocalConfig.model ?? 'default'}`,
      `Gateway surfaces: ${status.enabledSurfaces.join(', ') || 'none'}`,
      '',
      'Next commands:',
      '  holon start',
      '  holon gateway status',
    ].join('\n'),
  );

  return true;
}

async function runN8nSetup(configService: N8nConfigService): Promise<boolean> {
  const currentConfig = configService.getLocalConfig();
  const defaultHost = sanitizeInputValue(currentConfig.host) ?? 'http://localhost:5678';

  const hostAnswer = await p.text({
    message: 'n8n instance URL',
    placeholder: 'https://your-n8n.example.com',
    defaultValue: defaultHost,
    validate: (value) => validateUrl(String(value ?? '')),
  });

  if (p.isCancel(hostAnswer)) {
    return false;
  }

  const host = sanitizeInputValue(String(hostAnswer)) ?? defaultHost;
  const existingApiKey = configService.getApiKey(host);
  const apiKey = await promptForSecret('n8n API key', existingApiKey);
  if (!apiKey) {
    return false;
  }

  const spinner = p.spinner();
  spinner.start('Testing n8n connection...');

  let projects: IProject[];
  try {
    const client = new N8nApiClient({ host, apiKey });
    const connected = await client.testConnection();
    if (!connected) {
      spinner.stop('n8n connection failed.');
      throw new Error('Unable to connect to n8n with the provided URL and API key.');
    }

    projects = await client.getProjects();
    if (projects.length === 0) {
      spinner.stop('No n8n projects found.');
      throw new Error('No n8n projects were found. Create one in n8n first, then rerun Holon setup.');
    }
  } catch (error) {
    spinner.stop('n8n setup failed.');
    throw error;
  }

  spinner.stop(`Connected to n8n. Found ${projects.length} project(s).`);

  const selectedProject = await promptForProject(projects, currentConfig.projectId);
  if (!selectedProject) {
    return false;
  }

  const syncFolderAnswer = await p.text({
    message: 'Local workflow sync folder',
    defaultValue: currentConfig.syncFolder ?? 'workflows',
    validate: (value) => String(value ?? '').trim() ? undefined : 'Sync folder is required.',
  });

  if (p.isCancel(syncFolderAnswer)) {
    return false;
  }

  const syncFolder = String(syncFolderAnswer).trim();

  configService.saveApiKey(host, apiKey);
  configService.saveBootstrapState(host, syncFolder);
  const instanceIdentifier = await configService.getOrCreateInstanceIdentifier(host);

  configService.saveLocalConfig({
    host,
    syncFolder,
    projectId: selectedProject.id,
    projectName: getDisplayProjectName(selectedProject),
    instanceIdentifier,
    customNodesPath: currentConfig.customNodesPath,
  });
  WorkspaceSetupService.ensureWorkspaceFiles(syncFolder);

  const aiSpinner = p.spinner();
  aiSpinner.start('Refreshing AGENTS.md from n8n...');
  try {
    await runN8nacCommand(['update-ai']);
    aiSpinner.stop('AGENTS.md refreshed.');
  } catch (error) {
    aiSpinner.stop('n8n workspace saved.');
    p.log.warn(`Workspace initialized, but AGENTS.md refresh failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  p.log.success(`n8n workspace ready on ${host} with project ${getDisplayProjectName(selectedProject)}.`);
  return true;
}

async function runLlmSetup(configService: HolonConfigService): Promise<boolean> {
  const currentConfig = configService.getLocalConfig();

  let initialProvider = currentConfig.provider;
  if (!initialProvider) {
    try {
      initialProvider = resolveModelProvider(undefined, configService);
    } catch {
      initialProvider = undefined;
    }
  }

  const provider = await promptForProvider(initialProvider);
  if (!provider) {
    return false;
  }

  const existingApiKey = configService.getApiKey(provider);
  const apiKey = await promptForSecret(`${provider} API key`, existingApiKey);
  if (!apiKey) {
    return false;
  }

  const defaultModel = resolveModelName(
    provider,
    currentConfig.provider === provider ? currentConfig.model : undefined,
    configService,
  );
  const model = await promptForModel(provider, apiKey, defaultModel);
  if (!model) {
    return false;
  }

  const baseUrl = await promptForBaseUrl(provider, currentConfig.provider === provider ? currentConfig.baseUrl : undefined);
  if (baseUrl === null) {
    return false;
  }

  configService.saveApiKey(provider, apiKey);
  configService.saveLocalConfig({
    ...currentConfig,
    provider,
    model,
    baseUrl: baseUrl ?? getBaseUrlForProvider(provider),
  });

  p.log.success(`Default LLM set to ${provider} / ${model}.`);
  return true;
}

async function runSurfaceSetup(configService: HolonConfigService): Promise<boolean> {
  const currentSurfaces = configService.getEnabledGatewaySurfaces();
  const selected = await p.multiselect<GatewaySurface>({
    message: 'Gateway surfaces to enable',
    initialValues: currentSurfaces,
    required: true,
    options: [
      { value: 'telegram', label: 'Telegram', hint: 'Implemented now' },
      { value: 'webui', label: 'Web UI', hint: 'Config can be saved now, runtime not implemented yet' },
      { value: 'whatsapp', label: 'WhatsApp', hint: 'Config can be saved now, runtime not implemented yet' },
    ],
  });

  if (p.isCancel(selected)) {
    return false;
  }

  const surfaces = selected as GatewaySurface[];

  if (surfaces.includes('telegram')) {
    await setupTelegramGateway(configService);
  }

  configService.setEnabledGatewaySurfaces(surfaces);

  const deferredSurfaces = surfaces.filter((surface) => surface !== 'telegram');
  if (deferredSurfaces.length > 0) {
    p.log.warn(`Saved surfaces awaiting runtime implementation: ${deferredSurfaces.join(', ')}.`);
  }

  return true;
}

async function promptForProject(projects: IProject[], currentProjectId?: string): Promise<IProject | undefined> {
  if (projects.length === 1) {
    p.log.success(`Using the only available n8n project: ${getDisplayProjectName(projects[0])}.`);
    return projects[0];
  }

  const selection = await p.select<string>({
    message: 'Choose the n8n project to bind to this workspace',
    options: projects.map((project) => ({
      value: project.id,
      label: getDisplayProjectName(project),
      hint: currentProjectId === project.id ? 'Current selection' : project.id,
    })),
    initialValue: currentProjectId,
  });

  if (p.isCancel(selection)) {
    return undefined;
  }

  return projects.find((project) => project.id === selection);
}

async function promptForProvider(initialProvider?: HolonModelProvider): Promise<HolonModelProvider | undefined> {
  if (initialProvider) {
    const keepCurrent = await p.confirm({
      message: `Use ${initialProvider} as the default LLM provider?`,
      initialValue: true,
    });
    if (p.isCancel(keepCurrent)) {
      return undefined;
    }
    if (keepCurrent) {
      return initialProvider;
    }
  }

  const selection = await p.select<HolonModelProvider>({
    message: 'Choose the default LLM provider',
    options: VALID_PROVIDERS.map((provider) => ({
      value: provider,
      label: provider,
      hint: 'Configured and persisted by Holon setup',
    })),
  });

  if (p.isCancel(selection)) {
    return undefined;
  }

  return selection;
}

async function promptForModel(
  provider: HolonModelProvider,
  apiKey: string,
  defaultModel: string,
): Promise<string | undefined> {
  const availableModels = await fetchAvailableModels(provider, apiKey);
  if (availableModels.length > 0) {
    const customOption = '__custom__';
    const selection = await p.select<string>({
      message: `Choose the default model for ${provider}`,
      options: [
        ...availableModels.slice(0, 100).map((model) => ({
          value: model,
          label: model,
          hint: model === defaultModel ? 'Default' : undefined,
        })),
        { value: customOption, label: 'Custom model', hint: defaultModel },
      ],
      initialValue: availableModels.includes(defaultModel) ? defaultModel : customOption,
    });

    if (p.isCancel(selection)) {
      return undefined;
    }

    if (selection !== customOption) {
      return selection;
    }
  }

  const customModel = await p.text({
    message: `Default model for ${provider}`,
    defaultValue: defaultModel,
    validate: (value) => String(value ?? '').trim() ? undefined : 'Model name is required.',
  });

  if (p.isCancel(customModel)) {
    return undefined;
  }

  return String(customModel).trim();
}

async function promptForBaseUrl(
  provider: HolonModelProvider,
  currentBaseUrl?: string,
): Promise<string | undefined | null> {
  const suggested = currentBaseUrl ?? getBaseUrlForProvider(provider);

  if (!suggested && provider !== 'openai' && provider !== 'anthropic') {
    return undefined;
  }

  const customize = await p.confirm({
    message: `Use a custom base URL for ${provider}?`,
    initialValue: Boolean(currentBaseUrl),
  });

  if (p.isCancel(customize)) {
    return null;
  }

  if (!customize) {
    return undefined;
  }

  const answer = await p.text({
    message: `${provider} base URL`,
    defaultValue: suggested ?? '',
    validate: (value) => validateUrl(String(value ?? '')),
  });

  if (p.isCancel(answer)) {
    return null;
  }

  return sanitizeInputValue(String(answer));
}

async function promptForSecret(message: string, existingValue?: string): Promise<string | undefined> {
  if (existingValue) {
    const useExisting = await p.confirm({
      message: `Reuse the saved ${message}?`,
      initialValue: true,
    });

    if (p.isCancel(useExisting)) {
      return undefined;
    }

    if (useExisting) {
      return existingValue;
    }
  }

  const answer = await p.password({
    message,
    validate: (value) => String(value ?? '').trim() ? undefined : `${message} is required.`,
  });

  if (p.isCancel(answer)) {
    return undefined;
  }

  return String(answer).trim();
}

async function fetchAvailableModels(provider: HolonModelProvider, apiKey: string): Promise<string[]> {
  const endpoints: Partial<Record<HolonModelProvider, {
    url: string;
    map: (data: any) => string[];
  }>> = {
    openrouter: {
      url: 'https://openrouter.ai/api/v1/models',
      map: (data) => data.data?.map((model: { id: string }) => model.id) ?? [],
    },
    openai: {
      url: 'https://api.openai.com/v1/models',
      map: (data) => data.data?.map((model: { id: string }) => model.id) ?? [],
    },
    groq: {
      url: 'https://api.groq.com/openai/v1/models',
      map: (data) => data.data?.map((model: { id: string }) => model.id) ?? [],
    },
    mistral: {
      url: 'https://api.mistral.ai/v1/models',
      map: (data) => data.data?.map((model: { id: string }) => model.id) ?? [],
    },
  };

  const endpoint = endpoints[provider];
  if (!endpoint) {
    return [];
  }

  const spinner = p.spinner();
  spinner.start(`Fetching available models for ${provider}...`);

  try {
    const response = await fetch(endpoint.url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    const models = endpoint.map(payload).sort((left, right) => left.localeCompare(right));
    spinner.stop(`Found ${models.length} models for ${provider}.`);
    return models;
  } catch (error) {
    spinner.stop(`Could not fetch models for ${provider}.`);
    p.log.warn(`Using the default model instead: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

async function runN8nacCommand(args: string[]): Promise<void> {
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  await execFileAsync(command, ['--yes', 'n8nac', ...args], {
    cwd: getHolonHomeDir(),
    env: process.env,
  });
}

function getBaseUrlForProvider(provider: HolonModelProvider): string | undefined {
  switch (provider) {
    case 'openrouter': return 'https://openrouter.ai/api/v1';
    case 'openai': return undefined;
    case 'groq': return 'https://api.groq.com/openai/v1';
    case 'mistral': return 'https://api.mistral.ai/v1';
    case 'anthropic': return undefined;
    default: return undefined;
  }
}

function validateUrl(value: string): string | undefined {
  const normalized = sanitizeInputValue(value);
  if (!normalized) {
    return 'A URL is required.';
  }

  try {
    new URL(normalized);
    return undefined;
  } catch {
    return 'Enter a valid URL.';
  }
}

function sanitizeInputValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.replace(/^['"]|['"]$/g, '');
}
