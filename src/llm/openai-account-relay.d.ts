/**
 * Translation layer between OpenAI Chat Completions API and the Codex backend
 * (chatgpt.com/backend-api/codex/responses).
 *
 * The Yagr LLM relay receives requests in OpenAI Chat Completions format.
 * When the active provider is openai-oauth, these requests
 * are translated into the Codex Responses API format, forwarded with the required
 * ChatGPT session headers, and the Codex SSE stream is translated back to the
 * OpenAI Chat Completions format. Both streaming and non-streaming modes are supported.
 *
 * Reference:
 *   - Codex backend: chatgpt.com/backend-api/codex/responses
 *   - OpenAI Chat Completions: https://platform.openai.com/docs/api-reference/chat
 */
import http from 'node:http';
/**
 * Handles an incoming OpenAI Chat Completions request by translating it to
 * the Codex Responses API, forwarding it with ChatGPT session headers, and
 * streaming/returning the translated response.
 *
 * When `options.fromResponsesApi` is true the response is re-translated into
 * OpenAI Responses API format for upstream compatibility.
 */
export declare function handleOpenAiAccountRelay(_req: http.IncomingMessage, res: http.ServerResponse, body: Buffer, options?: {
    fromResponsesApi?: boolean;
}): Promise<void>;
//# sourceMappingURL=openai-account-relay.d.ts.map