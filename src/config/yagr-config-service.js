import Conf from 'conf';
import fs from 'node:fs';
import { ensureYagrHomeDir, getYagrPaths } from './yagr-home.js';
import { normalizeProviderId } from '../llm/provider-registry.js';
export function normalizeGatewaySurfaces(surfaces) {
    const normalized = [];
    for (const surface of surfaces ?? []) {
        if ((surface === 'telegram' || surface === 'webui' || surface === 'whatsapp') && !normalized.includes(surface)) {
            normalized.push(surface);
        }
    }
    return normalized;
}
export class YagrConfigService {
    globalStore;
    localConfigPath;
    constructor() {
        const paths = getYagrPaths();
        ensureYagrHomeDir();
        this.globalStore = new Conf({
            cwd: paths.homeDir,
            configName: 'credentials',
        });
        this.localConfigPath = paths.yagrConfigPath;
    }
    getLocalConfig() {
        if (!fs.existsSync(this.localConfigPath)) {
            return {};
        }
        try {
            const content = fs.readFileSync(this.localConfigPath, 'utf-8');
            return normalizeLocalConfig(JSON.parse(content));
        }
        catch {
            return {};
        }
    }
    saveLocalConfig(config) {
        fs.writeFileSync(this.localConfigPath, JSON.stringify(normalizeLocalConfig(config), null, 2));
    }
    updateLocalConfig(updater) {
        const nextConfig = normalizeLocalConfig(updater(this.getLocalConfig()));
        this.saveLocalConfig(nextConfig);
        return nextConfig;
    }
    getEnabledGatewaySurfaces() {
        const localConfig = this.getLocalConfig();
        if (Array.isArray(localConfig.gateway?.enabledSurfaces)) {
            return normalizeGatewaySurfaces(localConfig.gateway.enabledSurfaces);
        }
        if (localConfig.telegram) {
            return ['telegram'];
        }
        return [];
    }
    setEnabledGatewaySurfaces(surfaces) {
        const nextSurfaces = normalizeGatewaySurfaces(surfaces);
        return this.updateLocalConfig((localConfig) => ({
            ...localConfig,
            gateway: {
                ...localConfig.gateway,
                enabledSurfaces: nextSurfaces,
            },
        }));
    }
    enableGatewaySurface(surface) {
        const nextSurfaces = normalizeGatewaySurfaces([...this.getEnabledGatewaySurfaces(), surface]);
        return this.setEnabledGatewaySurfaces(nextSurfaces);
    }
    disableGatewaySurface(surface) {
        const nextSurfaces = this.getEnabledGatewaySurfaces().filter((entry) => entry !== surface);
        return this.setEnabledGatewaySurfaces(nextSurfaces);
    }
    getApiKey(provider) {
        const credentials = this.globalStore.get('providers') ?? {};
        return credentials[provider];
    }
    saveApiKey(provider, apiKey) {
        const credentials = this.globalStore.get('providers') ?? {};
        credentials[provider] = apiKey;
        this.globalStore.set('providers', credentials);
    }
    hasApiKey(provider) {
        return Boolean(this.getApiKey(provider));
    }
    clearLocalConfig() {
        if (fs.existsSync(this.localConfigPath)) {
            fs.unlinkSync(this.localConfigPath);
        }
    }
    clearAllApiKeys() {
        this.globalStore.set('providers', {});
    }
    getTelegramBotToken() {
        return this.globalStore.get('telegram.botToken');
    }
    saveTelegramBotToken(botToken) {
        this.globalStore.set('telegram.botToken', botToken);
    }
    clearTelegramBotToken() {
        this.globalStore.delete('telegram.botToken');
    }
}
function normalizeLocalConfig(config) {
    const provider = normalizeProviderId(config.provider);
    const legacyConfig = config;
    delete legacyConfig.llmProxy;
    delete legacyConfig.legacyTunnel;
    const rest = legacyConfig;
    return {
        ...rest,
        ...(provider ? { provider } : {}),
    };
}
//# sourceMappingURL=yagr-config-service.js.map