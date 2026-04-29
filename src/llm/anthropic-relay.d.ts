/**
 * Translation layer between OpenAI Chat Completions API and Anthropic Messages API.
 *
 * The Yagr LLM relay receives requests in OpenAI Chat Completions format.
 * When the active provider is anthropic-proxy, these
 * requests are translated into Anthropic Messages API format, forwarded, and the
 * responses are translated back. Both streaming (SSE) and non-streaming modes are
 * supported, as well as tool calls.
 *
 * Reference:
 *   - Anthropic Messages API: https://docs.anthropic.com/en/api/messages
 *   - OpenAI Chat Completions: https://platform.openai.com/docs/api-reference/chat
 */
import http from 'node:http';
import { translateChatCompletionToResponsesApi, pipeChatCompletionsSseAsResponsesApi } from './responses-api-relay.js';
export declare const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
interface OpenAIMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null | Array<{
        type: string;
        text?: string;
    }>;
    tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
            name: string;
            arguments: string;
        };
    }>;
    tool_call_id?: string;
}
interface OpenAITool {
    type: 'function';
    function: {
        name: string;
        description?: string;
        parameters?: Record<string, unknown>;
        strict?: boolean;
    };
}
interface OpenAIChatCompletionsRequest {
    model: string;
    messages: OpenAIMessage[];
    max_tokens?: number;
    temperature?: number;
    stream?: boolean;
    tools?: OpenAITool[];
    tool_choice?: unknown;
    [key: string]: unknown;
}
interface AnthropicTextBlock {
    type: 'text';
    text: string;
}
interface AnthropicToolUseBlock {
    type: 'tool_use';
    id: string;
    name: string;
    input: unknown;
}
type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock;
interface AnthropicMessage {
    role: 'user' | 'assistant';
    content: string | AnthropicContentBlock[];
}
interface AnthropicRequest {
    model: string;
    messages: AnthropicMessage[];
    system?: string;
    max_tokens: number;
    stream?: boolean;
    temperature?: number;
    tools?: Array<{
        name: string;
        description?: string;
        input_schema: Record<string, unknown>;
    }>;
    tool_choice?: unknown;
}
interface AnthropicNonStreamResponse {
    id: string;
    type: 'message';
    role: 'assistant';
    content: AnthropicContentBlock[];
    model: string;
    stop_reason: string | null;
    usage: {
        input_tokens: number;
        output_tokens: number;
    };
}
export declare function translateChatCompletionsToAnthropic(payload: OpenAIChatCompletionsRequest): AnthropicRequest;
export declare function translateAnthropicResponseToChatCompletions(response: AnthropicNonStreamResponse): Record<string, unknown>;
/**
 * Translates a single Anthropic SSE event into zero or more OpenAI SSE data lines.
 * Returns an array of `data: {...}` strings (without trailing newline) to write.
 * State is mutated across calls to track tool_call index and accumulated tool input.
 */
export declare function translateAnthropicSseEvent(eventType: string, eventData: Record<string, unknown>, state: AnthropicSseTranslationState): string[];
export interface AnthropicSseTranslationState {
    completionId: string;
    model: string;
    createdAt: number;
    nextToolIndex: number;
    currentToolIndex: number | undefined;
    toolInputAccumulator: Record<number, string>;
}
export declare function createAnthropicSseTranslationState(model: string): AnthropicSseTranslationState;
/**
 * Handles an incoming OpenAI Chat Completions request by translating it to
 * the Anthropic Messages API, forwarding it, and streaming/returning the
 * translated response.
 *
 * When `options.fromResponsesApi` is true the response is re-translated into
 * OpenAI Responses API format for upstream compatibility.
 */
export declare function handleAnthropicRelay(req: http.IncomingMessage, res: http.ServerResponse, body: Buffer, apiKey: string, options?: {
    fromResponsesApi?: boolean;
}): Promise<void>;
export { translateChatCompletionToResponsesApi, pipeChatCompletionsSseAsResponsesApi };
//# sourceMappingURL=anthropic-relay.d.ts.map