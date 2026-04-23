export declare const ANTHROPIC_ACCOUNT_DEFAULT_MODEL = "claude-haiku-4-5";
export interface AnthropicAccountSession {
    /** Bearer token for the Anthropic API (API key or OAuth access token). */
    apiKey: string;
    email?: string;
    /** Where the credential came from. */
    source: 'env' | 'claude-config';
}
export declare function getClaudeConfigPath(): string;
export declare function getAnthropicAccountSession(): AnthropicAccountSession | undefined;
export declare function ensureAnthropicAccountSession(): Promise<AnthropicAccountSession | undefined>;
export declare function fetchAnthropicAccountModels(apiKey: string): Promise<string[]>;
export declare function validateAnthropicAccountRuntime(modelId?: string, overrideApiKey?: string): Promise<{
    ok: boolean;
    text?: string;
    error?: string;
}>;
//# sourceMappingURL=anthropic-account.d.ts.map