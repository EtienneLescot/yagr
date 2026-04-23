import { YagrConfigService, type YagrConfigStoreLike } from '../config/yagr-config-service.js';
import type { YagrRunOptions } from '../types.js';
import type { GatewayRuntimeHandle, GatewaySurface } from './types.js';
export interface GatewaySurfaceStatus {
    id: GatewaySurface;
    label: string;
    enabled: boolean;
    configured: boolean;
    implemented: boolean;
    startable: boolean;
    summary: string;
    details?: Record<string, unknown>;
}
export interface GatewaySupervisorStatus {
    enabledSurfaces: GatewaySurface[];
    startableSurfaces: GatewaySurface[];
    surfaces: GatewaySurfaceStatus[];
    warnings: string[];
}
export declare function buildGatewaySupervisorStatus(surfaces: Array<Omit<GatewaySurfaceStatus, 'startable'>>): GatewaySupervisorStatus;
export declare function getGatewaySupervisorStatus(configService?: YagrConfigStoreLike): GatewaySupervisorStatus;
export declare function stopGatewayRuntimes(runtimes: GatewayRuntimeHandle[]): Promise<void>;
/**
 * Start the given gateway surfaces and return a `stop()` function for cleanup.
 * Unlike `runGatewaySurfaces`, this does NOT block waiting for SIGINT — callers
 * are responsible for calling `stop()` when they are done (e.g. after TUI exits).
 */
export declare function startGatewaySurfacesInBackground(surfaces: GatewaySurface[], options?: YagrRunOptions, configService?: YagrConfigService): Promise<() => Promise<void>>;
export declare function runGatewaySurfaces(surfaces: GatewaySurface[], options?: YagrRunOptions, configService?: YagrConfigService): Promise<void>;
export declare function getGatewayRunningBanner(configService?: YagrConfigService, pid?: number): string;
export declare function runGatewaySupervisor(options?: YagrRunOptions, configService?: YagrConfigService): Promise<void>;
//# sourceMappingURL=manager.d.ts.map