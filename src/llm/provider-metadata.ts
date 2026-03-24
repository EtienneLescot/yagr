import type { YagrModelProvider } from './provider-registry.js';

export interface YagrProviderModelMetadata {
  provider: YagrModelProvider;
  model: string;
  supportedParameters?: string[];
  inputModalities?: string[];
  outputModalities?: string[];
  contextWindow?: number;
  maxOutputTokens?: number;
  fetchedAt: string;
}

const DEFAULT_METADATA_TTL_MS = 5 * 60_000;
const OPENROUTER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

type CachedMetadataEntry = {
  metadata: YagrProviderModelMetadata;
  expiresAt: number;
};

const providerMetadataCache = new Map<string, CachedMetadataEntry>();

function metadataCacheKey(provider: YagrModelProvider, model: string): string {
  return `${provider}::${model}`;
}

function getMetadataTtlMs(): number {
  const raw = Number(process.env.YAGR_PROVIDER_METADATA_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_METADATA_TTL_MS;
}

function cacheMetadataEntries(entries: YagrProviderModelMetadata[]): void {
  const expiresAt = Date.now() + getMetadataTtlMs();
  for (const metadata of entries) {
    providerMetadataCache.set(metadataCacheKey(metadata.provider, metadata.model), {
      metadata,
      expiresAt,
    });
  }
}

export function getCachedProviderModelMetadata(
  provider: YagrModelProvider,
  model: string,
): YagrProviderModelMetadata | undefined {
  const key = metadataCacheKey(provider, model);
  const entry = providerMetadataCache.get(key);
  if (!entry) {
    return undefined;
  }

  if (entry.expiresAt <= Date.now()) {
    providerMetadataCache.delete(key);
    return undefined;
  }

  return entry.metadata;
}

export function clearProviderMetadataCache(): void {
  providerMetadataCache.clear();
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);

  return items.length > 0 ? items : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeOpenRouterMetadata(payload: Record<string, unknown>): YagrProviderModelMetadata[] {
  const rawModels = Array.isArray(payload.data) ? payload.data : [];
  const fetchedAt = new Date().toISOString();
  const entries: YagrProviderModelMetadata[] = [];

  for (const rawModel of rawModels) {
    if (!rawModel || typeof rawModel !== 'object') {
      continue;
    }

    const record = rawModel as Record<string, unknown>;
    const model = typeof record.id === 'string' ? record.id.trim() : '';
    if (!model) {
      continue;
    }

    const architecture = record.architecture && typeof record.architecture === 'object'
      ? record.architecture as Record<string, unknown>
      : undefined;
    const topProvider = record.top_provider && typeof record.top_provider === 'object'
      ? record.top_provider as Record<string, unknown>
      : undefined;

    entries.push({
      provider: 'openrouter',
      model,
      supportedParameters: normalizeStringArray(record.supported_parameters),
      inputModalities: normalizeStringArray(architecture?.input_modalities),
      outputModalities: normalizeStringArray(architecture?.output_modalities),
      contextWindow: asNumber(record.context_length),
      maxOutputTokens: asNumber(topProvider?.max_completion_tokens) ?? asNumber(record.max_completion_tokens),
      fetchedAt,
    });
  }

  return entries;
}

export function warmProviderMetadataCacheFromDiscovery(
  provider: YagrModelProvider,
  payload: Record<string, unknown>,
): void {
  if (provider !== 'openrouter') {
    return;
  }

  cacheMetadataEntries(normalizeOpenRouterMetadata(payload));
}

export async function fetchAndCacheProviderMetadata(
  provider: YagrModelProvider,
  apiKey?: string,
  baseUrl?: string,
): Promise<YagrProviderModelMetadata[]> {
  if (provider !== 'openrouter') {
    return [];
  }

  const resolvedBaseUrl = (baseUrl || OPENROUTER_DEFAULT_BASE_URL).replace(/\/$/, '');
  const metadataUrl = `${resolvedBaseUrl}/models`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(metadataUrl, { headers });
  if (!response.ok) {
    throw new Error(`Failed to fetch provider metadata: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json() as Record<string, unknown>;
  const entries = normalizeOpenRouterMetadata(payload);
  cacheMetadataEntries(entries);
  return entries;
}
