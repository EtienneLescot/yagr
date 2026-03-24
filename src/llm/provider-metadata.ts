import type { YagrModelProvider } from './provider-registry.js';

export interface YagrProviderModelMetadata {
  provider: YagrModelProvider;
  model: string;
  supportedParameters?: string[];
  inputModalities?: string[];
  outputModalities?: string[];
  contextWindow?: number;
  maxOutputTokens?: number;
  endpointVariants?: Array<{
    providerName?: string;
    providerSlug?: string;
    supportedParameters?: string[];
    contextWindow?: number;
    maxOutputTokens?: number;
  }>;
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
    const key = metadataCacheKey(metadata.provider, metadata.model);
    const previous = providerMetadataCache.get(key)?.metadata;
    providerMetadataCache.set(key, {
      metadata: mergeProviderMetadata(previous, metadata),
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

function normalizeEndpointVariants(value: unknown): YagrProviderModelMetadata['endpointVariants'] {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const variants = value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return undefined;
      }

      const record = item as Record<string, unknown>;
      const providerName = typeof record.provider_name === 'string'
        ? record.provider_name.trim()
        : typeof record.provider === 'string'
          ? record.provider.trim()
          : undefined;
      const providerSlug = typeof record.provider_slug === 'string'
        ? record.provider_slug.trim()
        : undefined;
      const supportedParameters = normalizeStringArray(record.supported_parameters ?? record.supportedParameters);
      const contextWindow = asNumber(record.context_length ?? record.contextWindow);
      const maxOutputTokens = asNumber(record.max_completion_tokens ?? record.maxOutputTokens);

      if (!providerName && !providerSlug && !supportedParameters && contextWindow === undefined && maxOutputTokens === undefined) {
        return undefined;
      }

      return {
        ...(providerName ? { providerName } : {}),
        ...(providerSlug ? { providerSlug } : {}),
        ...(supportedParameters ? { supportedParameters } : {}),
        ...(contextWindow !== undefined ? { contextWindow } : {}),
        ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      };
    })
    .filter((item): item is NonNullable<YagrProviderModelMetadata['endpointVariants']>[number] => Boolean(item));

  return variants.length > 0 ? variants : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function mergeStringArrays(left: string[] | undefined, right: string[] | undefined): string[] | undefined {
  const merged = [...new Set([...(left ?? []), ...(right ?? [])].filter(Boolean))];
  return merged.length > 0 ? merged : undefined;
}

function mergeEndpointVariants(
  left: YagrProviderModelMetadata['endpointVariants'],
  right: YagrProviderModelMetadata['endpointVariants'],
): YagrProviderModelMetadata['endpointVariants'] {
  if (!left?.length) {
    return right;
  }

  if (!right?.length) {
    return left;
  }

  const byKey = new Map<string, NonNullable<YagrProviderModelMetadata['endpointVariants']>[number]>();
  for (const variant of [...left, ...right]) {
    const key = `${variant.providerName ?? ''}::${variant.providerSlug ?? ''}`;
    const previous = byKey.get(key);
    byKey.set(key, {
      providerName: variant.providerName ?? previous?.providerName,
      providerSlug: variant.providerSlug ?? previous?.providerSlug,
      supportedParameters: mergeStringArrays(previous?.supportedParameters, variant.supportedParameters),
      contextWindow: variant.contextWindow ?? previous?.contextWindow,
      maxOutputTokens: variant.maxOutputTokens ?? previous?.maxOutputTokens,
    });
  }

  return [...byKey.values()];
}

function mergeProviderMetadata(
  left: YagrProviderModelMetadata | undefined,
  right: YagrProviderModelMetadata,
): YagrProviderModelMetadata {
  if (!left) {
    return right;
  }

  const mergedEndpointVariants = mergeEndpointVariants(left.endpointVariants, right.endpointVariants);
  const mergedSupportedParameters = mergeStringArrays(
    mergeStringArrays(left.supportedParameters, right.supportedParameters),
    mergedEndpointVariants?.flatMap((variant) => variant.supportedParameters ?? []),
  );

  return {
    ...left,
    ...right,
    supportedParameters: mergedSupportedParameters,
    inputModalities: mergeStringArrays(left.inputModalities, right.inputModalities),
    outputModalities: mergeStringArrays(left.outputModalities, right.outputModalities),
    contextWindow: right.contextWindow ?? left.contextWindow,
    maxOutputTokens: right.maxOutputTokens ?? left.maxOutputTokens,
    endpointVariants: mergedEndpointVariants,
    fetchedAt: right.fetchedAt || left.fetchedAt,
  };
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

function normalizeOpenRouterEndpointMetadata(
  model: string,
  payload: Record<string, unknown>,
): YagrProviderModelMetadata | undefined {
  const endpointRecords = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload.endpoints)
      ? payload.endpoints
      : Array.isArray(payload.providers)
        ? payload.providers
        : [];

  const endpointVariants = normalizeEndpointVariants(endpointRecords);
  if (!endpointVariants) {
    return undefined;
  }

  return {
    provider: 'openrouter',
    model,
    supportedParameters: mergeStringArrays(
      undefined,
      endpointVariants.flatMap((variant) => variant.supportedParameters ?? []),
    ),
    endpointVariants,
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchAndCacheProviderMetadata(
  provider: YagrModelProvider,
  apiKey?: string,
  baseUrl?: string,
  options: {
    model?: string;
  } = {},
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

  if (options.model) {
    const encodedModelPath = options.model
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    const endpointUrl = `${resolvedBaseUrl}/models/${encodedModelPath}/endpoints`;
    const response = await fetch(endpointUrl, { headers });
    if (!response.ok) {
      throw new Error(`Failed to fetch provider metadata: ${response.status} ${response.statusText}`);
    }

    const payload = await response.json() as Record<string, unknown>;
    const entry = normalizeOpenRouterEndpointMetadata(options.model, payload);
    if (!entry) {
      return [];
    }

    cacheMetadataEntries([entry]);
    return [entry];
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

export async function primeProviderModelMetadata(
  provider: YagrModelProvider,
  model: string,
  apiKey?: string,
  baseUrl?: string,
): Promise<YagrProviderModelMetadata | undefined> {
  const trimmedModel = model.trim();
  if (!trimmedModel) {
    return undefined;
  }

  const cached = getCachedProviderModelMetadata(provider, trimmedModel);
  if (cached?.endpointVariants?.length || provider !== 'openrouter') {
    return cached;
  }

  const entries = await fetchAndCacheProviderMetadata(provider, apiKey, baseUrl, { model: trimmedModel });
  return entries[0] ?? getCachedProviderModelMetadata(provider, trimmedModel);
}
