/**
 * Yagr Manager tooling: yagrProxy
 *
 * This tool is owned by yagr-manager, not yagr-agent.
 * It is registered dynamically when the n8n engine is active.
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { type ToolExecutionObserver } from '../tools/observer.js';
export declare function ensureYagrProxyCredential(): Promise<{
    credentialId: string | null;
    created: boolean;
    reused: boolean;
    baseUrl: string;
    port: number;
}>;
export declare function getYagrProxyStatus(): Promise<{
    operation: string;
    success: boolean;
    relayRunning: boolean;
    relayPort: number | null;
    configured: boolean;
    expectedBaseUrl: string | null;
    confirmedBaseUrl: string | null;
    credentialFound: boolean;
    credentialId: string | null;
    credentialName: string;
    credentialType: string;
    credentialStatus: string;
    next: string;
}>;
export declare function runYagrProxyCli(): Promise<{
    operation: string;
    success: boolean;
    relayRunning: boolean;
    relayPort: number | null;
    configured: boolean;
    expectedBaseUrl: string | null;
    confirmedBaseUrl: string | null;
    credentialFound: boolean;
    credentialId: string | null;
    credentialName: string;
    credentialType: string;
    credentialStatus: string;
    next: string;
}>;
/**
 * Syncs the n8n "Yagr LLM Proxy" credential whenever the LLM config or relay
 * state may have changed (e.g. after `yagr llm setup`, or at startup when the
 * relay restarted on a different port).
 *
 * Guards:
 *  1. llmProxy.enabled must be true (user opted in).
 *  2. The n8nac workspace must be initialised (n8nac-config.json present) so
 *     that credential CLI commands have a valid target.
 *
 * Always resolves — callers should NOT propagate errors from this function.
 */
export declare function syncProxyCredentialIfEnabled(): Promise<void>;
export declare function createYagrProxyTool(observer?: ToolExecutionObserver): DynamicStructuredTool<z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>, {}, {}, string, unknown, "yagrProxy">;
//# sourceMappingURL=yagr-proxy.d.ts.map