import { type YagrConfigStoreLike } from '../config/yagr-config-service.js';
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
export declare function getWebUiConfig(configService?: YagrConfigStoreLike): Required<WebUiConfigPayload>;
export declare function getWebUiGatewayStatus(configService?: YagrConfigStoreLike): WebUiGatewayStatus;
export {};
//# sourceMappingURL=webui-config.d.ts.map