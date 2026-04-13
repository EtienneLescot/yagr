import { YagrConfigService, type YagrConfigStoreLike } from '../config/yagr-config-service.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3789;

export interface WebUiGatewayStatus {
  configured: boolean;
  host: string;
  port: number;
  url: string;
}

interface WebUiConfigPayload {
  host?: string;
  port?: number;
}

function sanitizeHost(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed || DEFAULT_HOST;
}

function sanitizePort(value: number | undefined): number {
  if (!Number.isInteger(value) || Number(value) <= 0 || Number(value) > 65535) {
    return DEFAULT_PORT;
  }
  return Number(value);
}

export function getWebUiConfig(configService: YagrConfigStoreLike = new YagrConfigService()): Required<WebUiConfigPayload> {
  const config = configService.getLocalConfig();
  return {
    host: sanitizeHost(config.gateway?.webui?.host),
    port: sanitizePort(config.gateway?.webui?.port),
  };
}

export function getWebUiGatewayStatus(configService: YagrConfigStoreLike = new YagrConfigService()): WebUiGatewayStatus {
  const config = getWebUiConfig(configService);
  return {
    configured: true,
    host: config.host,
    port: config.port,
    url: `http://${config.host}:${config.port}`,
  };
}
