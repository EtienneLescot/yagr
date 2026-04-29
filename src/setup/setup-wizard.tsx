import type { GatewaySurface } from '../gateway/types.js';
import type { YagrModelProvider } from '../llm/provider-registry.js';

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
  saveSurfaces(p: { surfaces: GatewaySurface[]; telegram?: { token: string; username: string } }): void;
}

export interface SetupResult {
  ok: boolean;
  telegramDeepLink?: string;
}

export interface SetupWizardOptions {
  mode?: 'full' | 'llm-only';
}

export async function runSetupWizard(_callbacks: SetupCallbacks, _options: SetupWizardOptions = {}): Promise<SetupResult> {
  process.stdout.write('Interactive setup now configures only the local coding agent runtime. Use the Web UI or CLI flags to save provider and gateway settings.\n');
  return { ok: true };
}
