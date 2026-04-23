/**
 * Yagr Manager tooling: presentWorkflowResult
 *
 * This tool is owned by yagr-manager, not yagr-agent.
 * It is registered dynamically when the n8n engine is active.
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ToolExecutionObserver } from '../tools/observer.js';
export declare const WORKFLOW_EMBED_TYPE = "workflow-embed";
export interface PresentWorkflowExecutionResult {
    status: 'success' | 'error' | 'waiting';
    executionId?: string;
    summary?: string;
    data?: string;
}
export interface PresentWorkflowCliInput {
    workflowId: string;
    workflowUrl?: string;
    title?: string;
    diagram?: string;
    executionResult?: PresentWorkflowExecutionResult;
}
export interface WorkflowEmbedPayload {
    __type: typeof WORKFLOW_EMBED_TYPE;
    kind: 'workflow';
    workflowId: string;
    url: string;
    targetUrl: string;
    via: 'direct' | 'self-contained-auth';
    title?: string;
    diagram?: string;
    executionResult?: PresentWorkflowExecutionResult;
}
export declare function extractWorkflowMapHeader(source: string): string | undefined;
export declare function resolveWorkflowDiagramFromFilePath(filePath: string): string | undefined;
export declare function resolveLocalWorkflowDiagram(workflowId: string): string | undefined;
export declare function resolveWorkflowDiagram(workflowId: string, fallbackDiagram?: string): string | undefined;
export declare function presentWorkflowResultCli({ workflowId, workflowUrl, title, diagram, executionResult, }: PresentWorkflowCliInput): Promise<{
    __type: string;
    kind: string;
    workflowId: string;
    url: string;
    targetUrl: string;
    via: "direct" | "self-contained-auth";
    title: string | undefined;
    diagram: string | undefined;
    executionResult: PresentWorkflowExecutionResult | undefined;
    presented: boolean;
    workflowUrl: string;
}>;
export declare function createPresentWorkflowResultTool(observer?: ToolExecutionObserver): DynamicStructuredTool<z.ZodObject<{
    workflowId: z.ZodString;
    workflowUrl: z.ZodString;
    title: z.ZodOptional<z.ZodString>;
    diagram: z.ZodOptional<z.ZodString>;
    executionResult: z.ZodOptional<z.ZodObject<{
        status: z.ZodEnum<["success", "error", "waiting"]>;
        executionId: z.ZodOptional<z.ZodString>;
        summary: z.ZodOptional<z.ZodString>;
        data: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        status: "error" | "success" | "waiting";
        data?: string | undefined;
        summary?: string | undefined;
        executionId?: string | undefined;
    }, {
        status: "error" | "success" | "waiting";
        data?: string | undefined;
        summary?: string | undefined;
        executionId?: string | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    workflowId: string;
    workflowUrl: string;
    title?: string | undefined;
    diagram?: string | undefined;
    executionResult?: {
        status: "error" | "success" | "waiting";
        data?: string | undefined;
        summary?: string | undefined;
        executionId?: string | undefined;
    } | undefined;
}, {
    workflowId: string;
    workflowUrl: string;
    title?: string | undefined;
    diagram?: string | undefined;
    executionResult?: {
        status: "error" | "success" | "waiting";
        data?: string | undefined;
        summary?: string | undefined;
        executionId?: string | undefined;
    } | undefined;
}>, {
    workflowId: string;
    workflowUrl: string;
    title?: string | undefined;
    diagram?: string | undefined;
    executionResult?: {
        status: "error" | "success" | "waiting";
        data?: string | undefined;
        summary?: string | undefined;
        executionId?: string | undefined;
    } | undefined;
}, {
    workflowId: string;
    workflowUrl: string;
    title?: string | undefined;
    diagram?: string | undefined;
    executionResult?: {
        status: "error" | "success" | "waiting";
        data?: string | undefined;
        summary?: string | undefined;
        executionId?: string | undefined;
    } | undefined;
}, string, unknown, "presentWorkflowResult">;
//# sourceMappingURL=present-workflow.d.ts.map