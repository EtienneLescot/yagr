import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export const ANTHROPIC_ACCOUNT_DEFAULT_MODEL = 'claude-haiku-4-5';
// ─── Path helpers ──────────────────────────────────────────────────────────────
export function getClaudeConfigPath() {
    return process.env.YAGR_CLAUDE_CONFIG_PATH || path.join(os.homedir(), '.claude', 'config.json');
}
// ─── Session reader ────────────────────────────────────────────────────────────
export function getAnthropicAccountSession() {
    const yagrToken = process.env.YAGR_ANTHROPIC_SETUP_TOKEN?.trim();
    if (yagrToken) {
        return { apiKey: yagrToken, source: 'env' };
    }
    // 1. Environment variable (highest priority, e.g. CI or explicit override).
    const envKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (envKey) {
        return { apiKey: envKey, source: 'env' };
    }
    // 2. Claude Code config file (~/.claude/config.json).
    const configPath = getClaudeConfigPath();
    if (!fs.existsSync(configPath)) {
        return undefined;
    }
    try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        // API key stored in Claude Code config.
        const primaryApiKey = config.primaryApiKey?.trim();
        if (primaryApiKey) {
            return { apiKey: primaryApiKey, source: 'claude-config' };
        }
        // OAuth access token from Claude Code account login.
        const oauthToken = config.oauthAccount?.tokenData?.accessToken?.trim();
        if (oauthToken) {
            return {
                apiKey: oauthToken,
                email: config.oauthAccount?.emailAddress,
                source: 'claude-config',
            };
        }
    }
    catch {
        return undefined;
    }
    return undefined;
}
export async function ensureAnthropicAccountSession() {
    return getAnthropicAccountSession();
}
// ─── Model discovery ───────────────────────────────────────────────────────────
export async function fetchAnthropicAccountModels(apiKey) {
    const response = await fetch('https://api.anthropic.com/v1/models', {
        method: 'GET',
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            Accept: 'application/json',
        },
    });
    if (!response.ok) {
        throw new Error(`Anthropic account model discovery failed: HTTP ${response.status}`);
    }
    const payload = await response.json();
    const models = (payload.data ?? [])
        .map((entry) => entry.id?.trim())
        .filter((entry) => Boolean(entry))
        .sort((a, b) => a.localeCompare(b));
    return [...new Set(models)];
}
// ─── Runtime validation ─────────────────────────────────────────────────────────
export async function validateAnthropicAccountRuntime(modelId = ANTHROPIC_ACCOUNT_DEFAULT_MODEL, overrideApiKey) {
    if (process.env.YAGR_SKIP_ANTHROPIC_RUNTIME_VALIDATION === '1') {
        return { ok: true, text: 'OK' };
    }
    const session = await ensureAnthropicAccountSession();
    const apiKey = overrideApiKey?.trim() || session?.apiKey;
    if (!apiKey) {
        return { ok: false, error: 'No Anthropic account credentials found. Install Claude Code or set ANTHROPIC_API_KEY.' };
    }
    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                model: modelId,
                max_tokens: 16,
                messages: [{ role: 'user', content: 'Reply with exactly OK.' }],
            }),
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        const text = data.content?.[0]?.text ?? '';
        return {
            ok: text.trim().toUpperCase().includes('OK'),
            text,
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('429') || message.includes('overloaded') || message.includes('rate')) {
            return { ok: true, text: 'Rate limited but endpoint reachable.' };
        }
        return { ok: false, error: message };
    }
}
//# sourceMappingURL=anthropic-account.js.map