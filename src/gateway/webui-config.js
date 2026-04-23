import { YagrConfigService } from '../config/yagr-config-service.js';
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3789;
function sanitizeHost(value) {
    const trimmed = value?.trim();
    return trimmed || DEFAULT_HOST;
}
function sanitizePort(value) {
    if (!Number.isInteger(value) || Number(value) <= 0 || Number(value) > 65535) {
        return DEFAULT_PORT;
    }
    return Number(value);
}
export function getWebUiConfig(configService = new YagrConfigService()) {
    const config = configService.getLocalConfig();
    return {
        host: sanitizeHost(config.gateway?.webui?.host),
        port: sanitizePort(config.gateway?.webui?.port),
    };
}
export function getWebUiGatewayStatus(configService = new YagrConfigService()) {
    const config = getWebUiConfig(configService);
    return {
        configured: true,
        host: config.host,
        port: config.port,
        url: `http://${config.host}:${config.port}`,
    };
}
//# sourceMappingURL=webui-config.js.map