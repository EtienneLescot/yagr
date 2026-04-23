export declare const DEFAULT_COPILOT_API_BASE_URL = "https://api.individual.githubcopilot.com";
export declare const GITHUB_COPILOT_DEFAULT_MODEL = "gpt-4.1";
export interface GitHubCopilotSession {
    githubToken: string;
    source: string;
}
export interface GitHubCopilotAuthChallenge {
    verificationUri: string;
    userCode: string;
    deviceCode: string;
    intervalMs: number;
    expiresAt: number;
}
export declare function getGitHubCopilotSession(): GitHubCopilotSession | undefined;
export declare function ensureGitHubCopilotSession(): Promise<GitHubCopilotSession | undefined>;
export declare function resolveCopilotApiToken(githubToken: string): Promise<{
    token: string;
    expiresAt: number;
    baseUrl: string;
}>;
export declare function validateGitHubCopilotRuntime(modelId?: string): Promise<{
    ok: boolean;
    text?: string;
    error?: string;
}>;
export declare function fetchGitHubCopilotModels(token: string, baseUrl?: string): Promise<string[]>;
export declare function beginGitHubCopilotAuth(): Promise<GitHubCopilotAuthChallenge>;
export declare function completeGitHubCopilotAuth(challenge: {
    deviceCode: string;
    intervalMs: number;
    expiresAt: number;
}): Promise<GitHubCopilotSession>;
export declare function deriveCopilotApiBaseUrlFromToken(token: string): string | null;
//# sourceMappingURL=copilot-account.d.ts.map