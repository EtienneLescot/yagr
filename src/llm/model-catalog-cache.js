import fs from 'node:fs';
import path from 'node:path';
import { ensureYagrHomeDir, getYagrPaths } from '../config/yagr-home.js';
function getCatalogCachePath() {
    ensureYagrHomeDir();
    return path.join(getYagrPaths().proxyRuntimeDir, 'model-catalog-cache.json');
}
function readCatalogState() {
    const cachePath = getCatalogCachePath();
    if (!fs.existsSync(cachePath)) {
        return {};
    }
    try {
        return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    }
    catch {
        return {};
    }
}
function writeCatalogState(state) {
    const cachePath = getCatalogCachePath();
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(state, null, 2));
}
export function readCachedModelCatalog(provider) {
    const entry = readCatalogState().providers?.[provider];
    return entry?.models?.length ? [...entry.models] : [];
}
export function writeCachedModelCatalog(provider, models) {
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
//# sourceMappingURL=model-catalog-cache.js.map