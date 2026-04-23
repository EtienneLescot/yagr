import type { YagrToolEvent } from '../types.js';
export interface UserFacingToolStatus {
    title: string;
    detail: string;
}
export interface ToolExecutionObserver {
    onToolEvent?: (event: YagrToolEvent) => void | Promise<void>;
}
export declare function getUserFacingToolStatus(event: YagrToolEvent): UserFacingToolStatus | undefined;
export declare function quoteShellArg(value: string): string;
export declare function emitToolEvent(observer: ToolExecutionObserver | undefined, event: YagrToolEvent): Promise<void>;
//# sourceMappingURL=observer.d.ts.map