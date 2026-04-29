import { type YagrConfigStoreLike } from '../config/yagr-config-service.js';
import type { GatewaySurface } from '../gateway/types.js';
export interface YagrSetupStatus {
    ready: boolean;
    llmConfigured: boolean;
    enabledSurfaces: GatewaySurface[];
    startableSurfaces: GatewaySurface[];
    missingSteps: Array<'llm'>;
}
export declare function buildYagrSetupStatus(input: {
    llmConfigured: boolean;
    enabledSurfaces: GatewaySurface[];
    startableSurfaces: GatewaySurface[];
}): YagrSetupStatus;
export declare function getYagrSetupStatus(yagrConfigService: YagrConfigStoreLike, options?: {
    activeSurfaces?: GatewaySurface[];
}): YagrSetupStatus;
//# sourceMappingURL=status.d.ts.map