/**
 * Utilities for translating between OpenAI Chat Completions format and
 * OpenAI Responses API format, used when the relay proxies a provider that
 * does not natively support the /v1/responses endpoint.
 *
 * Used by:
 *   - The transparent proxy path for providers like Google/Gemini
 *   - The Anthropic relay handler (anthropic, anthropic-proxy)
 *   - The OpenAI account relay handler (openai-oauth / Codex)
 */
import http from 'node:http';
export declare function translateChatCompletionToResponsesApi(chatCompletion: Record<string, unknown>, model: string): Record<string, unknown>;
/**
 * Reads an upstream chat completions SSE stream and writes the equivalent
 * Responses API SSE events directly to the HTTP response.
 */
export declare function pipeChatCompletionsSseAsResponsesApi(upstream: Response, res: http.ServerResponse, model: string): Promise<void>;
//# sourceMappingURL=responses-api-relay.d.ts.map