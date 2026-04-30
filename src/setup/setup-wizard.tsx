import { stdin as input, stdout as output } from 'node:process';
import React, { useState } from 'react';
import { Box, Text, render, useInput } from 'ink';
import { PasswordInput, TextInput } from '@inkjs/ui';
import { normalizeGatewaySurfaces } from '../config/yagr-config-service.js';
import type { GatewaySurface } from '../gateway/types.js';
import {
  getDefaultBaseUrlForProvider,
  getDefaultModelForProvider,
  isOAuthAccountProvider,
  providerRequiresApiKey,
  type YagrModelProvider,
} from '../llm/provider-registry.js';

export interface SetupCallbacks {
  getLlmDefaults(): {
    provider?: YagrModelProvider;
    reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
    getApiKey(prov: YagrModelProvider): string | undefined;
    getDefaultModel(prov: YagrModelProvider): string | undefined;
    getBaseUrl(prov: YagrModelProvider): string | undefined;
    needsBaseUrl(prov: YagrModelProvider): boolean;
  };
  prepareProvider(provider: YagrModelProvider, apiKey?: string, baseUrl?: string): Promise<{
    ready: boolean;
    apiKey?: string;
    baseUrl?: string;
    models?: string[];
    notes?: string[];
    error?: string;
  }>;
  hasAccountSession(provider: YagrModelProvider): Promise<boolean>;
  startAccountAuth(provider: YagrModelProvider, authMethod?: 'browser' | 'headless'): Promise<{
    kind: 'none' | 'input';
    title?: string;
    instructions?: string[];
    placeholder?: string;
    submitLabel?: string;
    state?: string;
  }>;
  completeAccountAuth(provider: YagrModelProvider, input: string, state?: string): Promise<{
    ok: boolean;
    error?: string;
    apiKey?: string;
  }>;
  fetchModels(provider: YagrModelProvider, apiKey?: string, baseUrl?: string): Promise<string[]>;
  saveLlmConfig(p: { provider: YagrModelProvider; apiKey?: string; model: string; baseUrl?: string; reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' }): void;
  getSurfaceDefaults(): { surfaces: GatewaySurface[] };
  getTelegramToken(): string | undefined;
  setupTelegram(token: string): Promise<{ username: string }>;
  saveSurfaces(p: { surfaces: GatewaySurface[]; telegram?: { token: string; username: string } }): { telegramDeepLink?: string } | void;
}

export interface SetupResult {
  ok: boolean;
  telegramDeepLink?: string;
}

export interface SetupWizardOptions {
  mode?: 'full' | 'llm-only';
}

const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;

type ReasoningEffort = typeof REASONING_EFFORTS[number];

type ProviderFamily = 'openai' | 'anthropic' | 'google' | 'mistral' | 'openrouter' | 'copilot' | 'minimax' | 'openai-compatible';

const PROVIDER_FAMILY_OPTIONS: Array<{ label: string; value: ProviderFamily }> = [
  { label: 'OpenAI', value: 'openai' },
  { label: 'Anthropic', value: 'anthropic' },
  { label: 'Gemini', value: 'google' },
  { label: 'Mistral', value: 'mistral' },
  { label: 'OpenRouter', value: 'openrouter' },
  { label: 'GitHub Copilot', value: 'copilot' },
  { label: 'MiniMax', value: 'minimax' },
  { label: 'OpenAI Compatible', value: 'openai-compatible' },
];

export async function runSetupWizard(callbacks: SetupCallbacks, _options: SetupWizardOptions = {}): Promise<SetupResult> {
  if (!input.isTTY || !output.isTTY) {
    process.stderr.write('Interactive setup requires a TTY. Use CLI flags or the Web UI in non-interactive environments.\n');
    return { ok: false };
  }

  try {
    output.write('Yagr local runtime setup\n');
    output.write('This wizard configures the local coding-agent LLM runtime and optional gateway surfaces.\n\n');

    const defaults = callbacks.getLlmDefaults();
    await configureLlm(callbacks, defaults);

    let telegramDeepLink: string | undefined;
    if (_options.mode !== 'llm-only') {
      telegramDeepLink = await configureSurfaces(callbacks);
    }

    output.write('\nSaved local runtime configuration.\n');
    return { ok: true, telegramDeepLink };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      output.write('\nSetup cancelled.\n');
      return { ok: false };
    }
    throw error;
  }
}

async function configureLlm(
  callbacks: SetupCallbacks,
  defaults: ReturnType<SetupCallbacks['getLlmDefaults']>,
): Promise<void> {
  if (hasExistingLlmConfig(defaults)) {
    const action = await promptSelect('LLM provider is already configured', [
      { label: `Keep current (${describeProvider(defaults.provider)})`, value: 'keep' },
      { label: 'Modify LLM provider', value: 'modify' },
    ], 'keep');

    if (action === 'keep') {
      return;
    }
  }

  const provider = await promptProvider(defaults.provider);
  const existingApiKey = defaults.getApiKey(provider);
  const existingBaseUrl = defaults.getBaseUrl(provider);

  let apiKey = existingApiKey;
  let baseUrl = existingBaseUrl;

  if (defaults.needsBaseUrl(provider)) {
    const fallbackBaseUrl = existingBaseUrl ?? getDefaultBaseUrlForProvider(provider);
    baseUrl = await promptOptional('Base URL', fallbackBaseUrl);
  }

  if (isOAuthAccountProvider(provider)) {
    apiKey = await configureAccountProvider(callbacks, provider, existingApiKey);
  } else if (providerRequiresApiKey(provider)) {
    apiKey = await promptRequiredApiKey(provider, existingApiKey);
  } else {
    apiKey = await promptOptionalSecret('API key (optional)', existingApiKey ? '<stored>' : undefined);
    if (apiKey === '<stored>') apiKey = existingApiKey;
  }

  const defaultModel = defaults.getDefaultModel(provider) || getDefaultModelForProvider(provider);
  const model = await promptModel(callbacks, provider, apiKey, baseUrl, defaultModel || undefined);
  const reasoningEffort = await promptReasoningEffort(defaults.reasoningEffort);

  callbacks.saveLlmConfig({
    provider,
    apiKey: apiKey && apiKey !== existingApiKey ? apiKey : undefined,
    model,
    baseUrl,
    reasoningEffort,
  });
}

function hasExistingLlmConfig(defaults: ReturnType<SetupCallbacks['getLlmDefaults']>): boolean {
  if (!defaults.provider || !defaults.getDefaultModel(defaults.provider)) {
    return false;
  }

  return !providerRequiresApiKey(defaults.provider) || Boolean(defaults.getApiKey(defaults.provider));
}

async function promptProvider(
  defaultProvider: YagrModelProvider | undefined,
): Promise<YagrModelProvider> {
  const providerFamily = await promptSelect('Provider', PROVIDER_FAMILY_OPTIONS, getProviderFamily(defaultProvider));

  if (providerFamily === 'openai') {
    return promptSelect('OpenAI setup method', [
      { label: 'ChatGPT account', value: 'openai-oauth' },
      { label: 'API key', value: 'openai' },
    ], defaultProvider === 'openai' ? 'openai' : 'openai-oauth');
  }

  if (providerFamily === 'minimax') {
    return promptSelect('MiniMax setup method', [
      { label: 'Token plan', value: 'minimax-token-plan' },
      { label: 'API key', value: 'minimax' },
    ], defaultProvider === 'minimax' ? 'minimax' : 'minimax-token-plan');
  }

  if (providerFamily === 'copilot') return 'copilot-proxy';
  return providerFamily;
}

function getProviderFamily(provider: YagrModelProvider | undefined): ProviderFamily {
  if (provider === 'openai' || provider === 'openai-oauth') return 'openai';
  if (provider === 'minimax' || provider === 'minimax-token-plan') return 'minimax';
  if (provider === 'copilot-proxy') return 'copilot';
  if (provider === 'anthropic-proxy') return 'anthropic';
  return provider ?? 'openai';
}

function describeProvider(provider: YagrModelProvider | undefined): string {
  if (!provider) return 'not configured';
  if (provider === 'openai-oauth') return 'OpenAI, ChatGPT account';
  if (provider === 'openai') return 'OpenAI, API key';
  if (provider === 'anthropic') return 'Anthropic';
  if (provider === 'google') return 'Gemini';
  if (provider === 'mistral') return 'Mistral';
  if (provider === 'openrouter') return 'OpenRouter';
  if (provider === 'copilot-proxy') return 'GitHub Copilot';
  if (provider === 'minimax-token-plan') return 'MiniMax, token plan';
  if (provider === 'minimax') return 'MiniMax, API key';
  if (provider === 'openai-compatible') return 'OpenAI Compatible';
  return provider;
}

async function configureAccountProvider(
  callbacks: SetupCallbacks,
  provider: YagrModelProvider,
  existingApiKey: string | undefined,
): Promise<string | undefined> {
  if (await callbacks.hasAccountSession(provider)) {
    const authAction = await promptSelect(`${describeProvider(provider)} authentication`, [
      { label: 'Use existing login', value: 'existing' },
      { label: 'Renew login', value: 'renew' },
    ], 'existing');

    if (authAction === 'existing') {
      return existingApiKey;
    }
  }

  const authMethod = provider === 'openai-oauth'
    ? await promptAuthMethod()
    : undefined;
  const challenge = await callbacks.startAccountAuth(provider, authMethod);
  if (challenge.kind === 'none') return existingApiKey;

  if (challenge.title) output.write(`\n${challenge.title}\n`);
  for (const instruction of challenge.instructions ?? []) {
    output.write(`${instruction}\n`);
  }

  const inputValue = await promptText(challenge.placeholder ?? 'Input');
  const completed = await callbacks.completeAccountAuth(provider, inputValue, challenge.state);
  if (!completed.ok) {
    throw new Error(completed.error ?? `Could not complete ${provider} authentication.`);
  }

  return completed.apiKey ?? existingApiKey;
}

async function promptModel(
  callbacks: SetupCallbacks,
  provider: YagrModelProvider,
  apiKey: string | undefined,
  baseUrl: string | undefined,
  defaultModel: string | undefined,
): Promise<string> {
  output.write(`Fetching available models for ${describeProvider(provider)}...\n`);

  let models: string[] = [];
  try {
    models = await callbacks.fetchModels(provider, apiKey, baseUrl);
  } catch (error) {
    output.write(`Model discovery failed: ${error instanceof Error ? error.message : String(error)}\n`);
  }

  const modelOptions = buildModelOptions(models, defaultModel);
  if (modelOptions.length === 0) {
    return promptRequired('Model', defaultModel);
  }

  const selected = await promptSelect('Model', [
    ...modelOptions.map((model) => ({ label: model, value: model })),
    { label: 'Enter manually...', value: '__custom__' },
  ], defaultModel && modelOptions.includes(defaultModel) ? defaultModel : modelOptions[0]);

  if (selected === '__custom__') {
    return promptRequired('Model', defaultModel);
  }

  return selected;
}

function buildModelOptions(models: string[], defaultModel: string | undefined): string[] {
  const uniqueModels = Array.from(new Set(models.filter((model) => model.trim().length > 0)));
  if (defaultModel && !uniqueModels.includes(defaultModel)) {
    return [defaultModel, ...uniqueModels];
  }
  return uniqueModels;
}

async function promptAuthMethod(): Promise<'browser' | 'headless'> {
  return promptSelect('OpenAI account sign-in method', [
    { label: 'Browser sign-in', value: 'browser' },
    { label: 'Device code', value: 'headless' },
  ], 'browser');
}

async function promptRequiredApiKey(
  provider: YagrModelProvider,
  existingApiKey: string | undefined,
): Promise<string> {
  while (true) {
    const label = existingApiKey ? 'API key [stored, press Enter to keep]' : `API key for ${provider}`;
    const answer = (await promptSecret(label)).trim();
    if (answer) return answer;
    if (existingApiKey) return existingApiKey;
    output.write('An API key is required for this provider.\n');
  }
}

async function promptRequired(
  label: string,
  defaultValue: string | undefined,
): Promise<string> {
  while (true) {
    const answer = (await promptText(label, defaultValue)).trim();
    if (answer) return answer;
    if (defaultValue) return defaultValue;
    output.write(`${label} is required.\n`);
  }
}

async function promptOptional(
  label: string,
  defaultValue: string | undefined,
): Promise<string | undefined> {
  const answer = (await promptText(label, defaultValue)).trim();
  return answer || defaultValue;
}

async function promptOptionalSecret(
  label: string,
  defaultValue: string | undefined,
): Promise<string | undefined> {
  const answer = (await promptSecret(label, defaultValue)).trim();
  return answer || defaultValue;
}

async function promptReasoningEffort(
  defaultValue: ReasoningEffort | undefined,
): Promise<ReasoningEffort | undefined> {
  const fallback = defaultValue ?? 'none';
  return promptSelect('Reasoning effort', REASONING_EFFORTS.map((effort) => ({
    label: effort,
    value: effort,
  })), fallback);
}

async function configureSurfaces(
  callbacks: SetupCallbacks,
): Promise<string | undefined> {
  const defaults = callbacks.getSurfaceDefaults();
  const surfaces = new Set<GatewaySurface>(normalizeGatewaySurfaces(defaults.surfaces));

  if (await promptYesNo('Enable Web UI gateway surface', surfaces.has('webui'))) {
    surfaces.add('webui');
  } else {
    surfaces.delete('webui');
  }

  const telegram = await configureTelegramSurface(callbacks, surfaces);

  const normalizedSurfaces = normalizeGatewaySurfaces([...surfaces]);
  return callbacks.saveSurfaces({ surfaces: normalizedSurfaces, telegram })?.telegramDeepLink;
}

async function configureTelegramSurface(
  callbacks: SetupCallbacks,
  surfaces: Set<GatewaySurface>,
): Promise<{ token: string; username: string } | undefined> {
  const existingToken = callbacks.getTelegramToken();
  const hasTelegramConfig = surfaces.has('telegram') || Boolean(existingToken);

  if (hasTelegramConfig) {
    const action = await promptSelect('Telegram gateway is already configured', [
      { label: 'Keep current Telegram setup', value: 'keep' },
      { label: 'Modify Telegram setup', value: 'modify' },
      { label: 'Disable Telegram gateway', value: 'disable' },
    ], 'keep');

    if (action === 'keep') {
      surfaces.add('telegram');
      return undefined;
    }

    if (action === 'disable') {
      surfaces.delete('telegram');
      return undefined;
    }
  } else if (!(await promptYesNo('Enable Telegram gateway surface', false))) {
    surfaces.delete('telegram');
    return undefined;
  }

  const token = await promptTelegramToken(existingToken);
  const identity = await callbacks.setupTelegram(token);
  surfaces.add('telegram');
  output.write(`Telegram bot resolved as @${identity.username}.\n`);
  return { token, username: identity.username };
}

async function promptTelegramToken(
  existingToken: string | undefined,
): Promise<string> {
  while (true) {
    const answer = (await promptSecret(existingToken ? 'Telegram BotFather token [stored, press Enter to keep]' : 'Telegram BotFather token')).trim();
    const token = answer || existingToken;
    if (token && token.includes(':')) return token;
    output.write('Enter a valid Telegram BotFather token.\n');
  }
}

async function promptYesNo(
  label: string,
  defaultValue: boolean,
): Promise<boolean> {
  return (await promptSelect(label, [
    { label: 'Yes', value: 'yes' },
    { label: 'No', value: 'no' },
  ], defaultValue ? 'yes' : 'no')) === 'yes';
}

async function promptText(label: string, defaultValue?: string): Promise<string> {
  return new Promise<string>((resolve) => {
    let app: ReturnType<typeof render>;
    app = render(
      <TextPrompt
        label={label}
        defaultValue={defaultValue}
        onSubmit={(value) => {
          app.unmount();
          resolve(value);
        }}
      />,
      { stdin: input, stdout: output },
    );
  });
}

async function promptSecret(label: string, defaultValue?: string): Promise<string> {
  return new Promise<string>((resolve) => {
    let app: ReturnType<typeof render>;
    app = render(
      <TextPrompt
        label={label}
        defaultValue={defaultValue}
        secret
        onSubmit={(value) => {
          app.unmount();
          resolve(value);
        }}
      />,
      { stdin: input, stdout: output },
    );
  });
}

async function promptSelect<T extends string>(
  label: string,
  options: Array<{ label: string; value: T }>,
  defaultValue: T,
): Promise<T> {
  return new Promise<T>((resolve) => {
    let app: ReturnType<typeof render>;
    app = render(
      <SelectPrompt
        label={label}
        options={options}
        defaultValue={defaultValue}
        onSubmit={(value) => {
          app.unmount();
          resolve(value);
        }}
      />,
      { stdin: input, stdout: output },
    );
  });
}

function SelectPrompt<T extends string>({
  label,
  options,
  defaultValue,
  onSubmit,
}: {
  label: string;
  options: Array<{ label: string; value: T }>;
  defaultValue: T;
  onSubmit: (value: T) => void;
}) {
  const defaultIndex = Math.max(0, options.findIndex((option) => option.value === defaultValue));
  const [focusedIndex, setFocusedIndex] = useState(defaultIndex);
  const visibleRowCount = Math.min(12, options.length);
  const firstVisibleIndex = Math.min(
    Math.max(0, focusedIndex - Math.floor(visibleRowCount / 2)),
    Math.max(0, options.length - visibleRowCount),
  );
  const visibleOptions = options.slice(firstVisibleIndex, firstVisibleIndex + visibleRowCount);

  useInput((_inputValue, key) => {
    if (key.upArrow) {
      setFocusedIndex((index) => Math.max(0, index - 1));
      return;
    }

    if (key.downArrow) {
      setFocusedIndex((index) => Math.min(options.length - 1, index + 1));
      return;
    }

    if (key.return) {
      onSubmit(options[focusedIndex].value);
    }
  });

  return (
    <Box flexDirection="column">
      <Text>{label}</Text>
      {firstVisibleIndex > 0 ? <Text dimColor>  ...</Text> : null}
      {visibleOptions.map((option, visibleIndex) => {
        const absoluteIndex = firstVisibleIndex + visibleIndex;
        return (
        <Text key={option.value} color={absoluteIndex === focusedIndex ? 'cyan' : undefined}>
          {absoluteIndex === focusedIndex ? '❯ ' : '  '}{option.label}
        </Text>
        );
      })}
      {firstVisibleIndex + visibleRowCount < options.length ? <Text dimColor>  ...</Text> : null}
    </Box>
  );
}

function TextPrompt({
  label,
  defaultValue,
  secret = false,
  onSubmit,
}: {
  label: string;
  defaultValue?: string;
  secret?: boolean;
  onSubmit: (value: string) => void;
}) {
  return (
    <Box>
      <Text>{label}{defaultValue ? ` [${defaultValue}]` : ''}: </Text>
      {secret
        ? <PasswordInput placeholder={defaultValue ? 'Press Enter to keep, or type a new value' : ''} onSubmit={onSubmit} />
        : <TextInput placeholder={defaultValue ? 'Press Enter to keep, or type a new value' : ''} onSubmit={onSubmit} />}
    </Box>
  );
}
