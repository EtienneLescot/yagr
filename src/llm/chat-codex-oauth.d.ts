import type { LanguageModelV1FunctionTool, LanguageModelV1Prompt } from './provider-types.js';
import { BaseChatModel, type BaseChatModelCallOptions, type BaseChatModelParams, type BindToolsInput } from '@langchain/core/language_models/chat_models';
import { type BaseMessage } from '@langchain/core/messages';
import { ChatGenerationChunk, type ChatResult } from '@langchain/core/outputs';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import type { Runnable } from '@langchain/core/runnables';
import { CodexReasoningEffort } from './openai-account.js';
interface ChatCodexOAuthCallOptions extends BaseChatModelCallOptions {
    tools?: LanguageModelV1FunctionTool[];
    reasoningEffort?: CodexReasoningEffort;
}
export declare class ChatCodexOAuth extends BaseChatModel<ChatCodexOAuthCallOptions> {
    static lc_name(): string;
    readonly model: string;
    readonly reasoningEffort: CodexReasoningEffort;
    readonly sessionId: string;
    private readonly boundTools?;
    private readonly boundCallOptions?;
    private previousPrompt?;
    private previousResponseId?;
    constructor(fields: BaseChatModelParams & {
        model: string;
        reasoningEffort?: CodexReasoningEffort;
        sessionId?: string;
        boundTools?: LanguageModelV1FunctionTool[];
        boundCallOptions?: Partial<ChatCodexOAuthCallOptions>;
        previousPrompt?: LanguageModelV1Prompt;
        previousResponseId?: string;
    });
    _llmType(): string;
    _identifyingParams(): Record<string, unknown>;
    bindTools(tools: BindToolsInput[], kwargs?: Partial<ChatCodexOAuthCallOptions>): Runnable;
    _generate(messages: BaseMessage[], options: this['ParsedCallOptions'], _runManager?: CallbackManagerForLLMRun): Promise<ChatResult>;
    _streamResponseChunks(messages: BaseMessage[], options: this['ParsedCallOptions'], runManager?: CallbackManagerForLLMRun): AsyncGenerator<ChatGenerationChunk>;
}
export {};
//# sourceMappingURL=chat-codex-oauth.d.ts.map