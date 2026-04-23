import { type YagrConfigStoreLike } from '../config/yagr-config-service.js';
import type { YagrN8nConfigService } from '../config/n8n-config-service.js';
import type { GatewaySurface } from '../gateway/types.js';
export interface YagrSetupStatus {
    ready: boolean;
    n8nConfigured: boolean;
    llmConfigured: boolean;
    enabledSurfaces: GatewaySurface[];
    startableSurfaces: GatewaySurface[];
    missingSteps: Array<'n8n' | 'llm'>;
}
export declare function buildYagrSetupStatus(input: {
    n8nConfigured: boolean;
    llmConfigured: boolean;
    enabledSurfaces: GatewaySurface[];
    startableSurfaces: GatewaySurface[];
}): YagrSetupStatus;
export declare function getYagrSetupStatus(yagrConfigService: YagrConfigStoreLike, n8nConfigService: Pick<YagrN8nConfigService, 'getLocalConfig' | 'getApiKey'>, options?: {
    activeSurfaces?: GatewaySurface[];
}): YagrSetupStatus;
//# sourceMappingURL=status.d.ts.map