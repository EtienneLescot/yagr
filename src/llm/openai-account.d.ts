import type { LanguageModelV1 } from './provider-types.js';
export declare const OPENAI_ACCOUNT_BASE_URL = "https://chatgpt.com/backend-api";
export declare const OPENAI_ACCOUNT_DEFAULT_MODEL = "gpt-5.4";
/**
 * Reasoning effort level for Codex responses API.
 * Corresponds to the `reasoning_effort` parameter accepted by the API.
 * - 'none': No reasoning (fastest)
 * - 'minimal': Minimal reasoning (~5-10% of budget)
 * - 'low': Low reasoning (~10-20% of max_completion_tokens)
 * - 'medium': Medium reasoning (~50% of max_completion_tokens) — default
 * - 'high': High reasoning (~80% of max_completion_tokens)
 * - 'xhigh': Extra high reasoning (~95% of max_completion_tokens)
 */
export declare const CODEX_REASONING_EFFORT_OPTIONS: readonly ["none", "minimal", "low", "medium", "high", "xhigh"];
export type CodexReasoningEffort = typeof CODEX_REASONING_EFFORT_OPTIONS[number];
export declare function getDefaultCodexReasoningEffort(modelId: string): CodexReasoningEffort;
export interface CodexAuthChallenge {
    authUrl: string;
    callbackServerStarted: boolean;
}
export declare function beginCodexAuth(): Promise<CodexAuthChallenge>;
export declare function completeCodexAuth(): Promise<OpenAiAccountSession>;
export interface OpenAiAccountSession {
    accessToken: string;
    refreshToken?: string;
    email?: string;
    /** Always 'codex' — session is read from the Codex CLI auth file. */
    source: 'codex';
}
/** Path to the Codex CLI auth file. Override with YAGR_CODEX_AUTH_PATH for tests. */
export declare function getCodexAuthPath(): string;
/** Reads the session and automatically refreshes if the access token is expiring soon. */
export declare function ensureOpenAiAccountSession(): Promise<OpenAiAccountSession | undefined>;
export declare function getOpenAiAccountSession(): OpenAiAccountSession | undefined;
/**
 * Fetches available models from the ChatGPT Codex backend with ETag caching.
 *
 * Discovery policy — all models compatible with the ChatGPT/Codex OAuth plan,
 * shown in the account's model selector (visibility = "list").  This includes
 * models regardless of their `supported_in_api` flag, because some plans expose
 * models that are not yet surfaced in the standalone API but are usable through
 * the ChatGPT UI and the Codex relay.
 *
 * Filter chain applied to the `/codex/models` payload:
 *   1. non-empty slug
 *   2. visibility === "list"  (excludes internal / hidden entries)
 *   3. no further filter on `supported_in_api`
 *   4. sorted by ascending `priority`
 *
 * Falls back to the in-memory cache on network failure or 304 Not Modified.
 * Returns `[]` if the cache is empty and the network call fails.
 */
export declare function fetchOpenAiAccountModels(accessToken: string): Promise<string[]>;
export declare function validateOpenAiAccountRuntime(modelId?: string): Promise<{
    ok: boolean;
    text?: string;
    error?: string;
}>;
export declare function createOpenAiAccountLanguageModel(modelId: string, reasoningEffort?: CodexReasoningEffort, sessionId?: string): LanguageModelV1;
export declare function ensureCodexInstructions(instructions: string | undefined): string;
export declare function ensureCodexSessionId(sessionId?: string): string;
//# sourceMappingURL=openai-account.d.ts.map