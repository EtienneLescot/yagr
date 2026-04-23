import type { LanguageModelV1FunctionTool } from './provider-types.js';
import { BaseChatModel, type BaseChatModelCallOptions, type BaseChatModelParams, type BindToolsInput } from '@langchain/core/language_models/chat_models';
import { type BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import type { Runnable } from '@langchain/core/runnables';
interface OpenAiAccountChatCallOptions extends BaseChatModelCallOptions {
    tools?: LanguageModelV1FunctionTool[];
}
export declare class OpenAiAccountChatModel extends BaseChatModel<OpenAiAccountChatCallOptions> {
    static lc_name(): string;
    readonly model: string;
    private readonly boundTools?;
    private readonly boundCallOptions?;
    constructor(fields: BaseChatModelParams & {
        model: string;
        boundTools?: LanguageModelV1FunctionTool[];
        boundCallOptions?: Partial<OpenAiAccountChatCallOptions>;
    });
    _llmType(): string;
    _identifyingParams(): Record<string, unknown>;
    bindTools(tools: BindToolsInput[], kwargs?: Partial<OpenAiAccountChatCallOptions>): Runnable;
    _generate(messages: BaseMessage[], options: this['ParsedCallOptions'], _runManager?: CallbackManagerForLLMRun): Promise<ChatResult>;
}
export {};
//# sourceMappingURL=openai-account-langchain.d.ts.map