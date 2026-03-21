import fs from 'node:fs';
import path from 'node:path';
import { ensureYagrHomeDir, getYagrPaths } from '../config/yagr-home.js';
import type { YagrModelProvider } from './provider-registry.js';

interface CachedModelCatalogEntry {
  models: string[];
  updatedAt: string;
}

interface CachedModelCatalogState {
  providers?: Partial<Record<YagrModelProvider, CachedModelCatalogEntry>>;
}

function getCatalogCachePath(): string {
  ensureYagrHomeDir();
  return path.join(getYagrPaths().proxyRuntimeDir, 'model-catalog-cache.json');
}

function readCatalogState(): CachedModelCatalogState {
  const cachePath = getCatalogCachePath();
  if (!fs.existsSync(cachePath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8')) as CachedModelCatalogState;
  } catch {
    return {};
  }
}

function writeCatalogState(state: CachedModelCatalogState): void {
  const cachePath = getCatalogCachePath();
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(state, null, 2));
}

export function readCachedModelCatalog(provider: YagrModelProvider): string[] {
  const entry = readCatalogState().providers?.[provider];
  return entry?.models?.length ? [...entry.models] : [];
}

export function writeCachedModelCatalog(provider: YagrModelProvider, models: string[]): void {
  const normalized = [...new Set(models.map((model) => model.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (normalized.length === 0) {
    return;
  }

  const current = readCatalogState();
  writeCatalogState({
    ...current,
    providers: {
      ...(current.providers ?? {}),
      [provider]: {
        models: normalized,
        updatedAt: new Date().toISOString(),
      },
    },
  });
}
