import type { YagrOperationEvent, YagrPhaseEvent, YagrRunPhase, YagrStateEvent, YagrToolEvent } from '../types.js';
export interface YagrUserVisibleUpdate {
    tone: 'info' | 'success' | 'error';
    title: string;
    detail?: string;
    phase?: YagrRunPhase;
    dedupeKey: string;
}
export declare function makePhaseOperationEvent(event: YagrPhaseEvent): YagrOperationEvent;
export declare function makeToolStartOperationEvent(toolName: string, rawInput: Record<string, unknown> | undefined): YagrOperationEvent | undefined;
export declare function makeToolEndOperationEvent(operationId: string, toolName: string, rawOutput: unknown, startedAt: number): Partial<YagrOperationEvent>;
export declare const THINKING_OP_ID = "llm:thinking";
export declare function makeThinkingStartEvent(): YagrOperationEvent;
export declare function makeThinkingEndEvent(body: string, startedAt: number): Partial<YagrOperationEvent>;
export declare function mapPhaseEventToUserVisibleUpdate(event: YagrPhaseEvent): YagrUserVisibleUpdate | undefined;
export declare function mapStateEventToUserVisibleUpdate(event: YagrStateEvent): YagrUserVisibleUpdate | undefined;
export declare function mapToolEventToUserVisibleUpdate(event: YagrToolEvent): YagrUserVisibleUpdate | undefined;
//# sourceMappingURL=user-visible-updates.d.ts.map