export declare function getGatewayPidPath(): string;
export declare function getGatewayLogPath(): string;
export declare function getGatewayLockPath(): string;
export declare function writeGatewayPid(pid: number): void;
export declare function readGatewayPid(): number | undefined;
export declare function clearGatewayPid(): void;
export declare function isYagrGatewayProcess(pid: number): boolean;
export declare function tryAcquireLock(): boolean;
export declare function releaseLock(): void;
export declare function isGatewayRunning(): {
    running: boolean;
    pid?: number;
};
//# sourceMappingURL=gateway-daemon.d.ts.map