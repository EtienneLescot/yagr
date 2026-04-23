import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import { LocalShellBackend } from 'deepagents';
export declare function getPristineDeepAgentMemorySources(): string[];
export declare function createPristineDeepAgentBackend(rootDir?: string): LocalShellBackend;
export declare function buildPristineDeepAgentConfig({ model, checkpointer, rootDir, }: {
    model: BaseChatModel;
    checkpointer: BaseCheckpointSaver;
    rootDir?: string;
}): {
    model: BaseChatModel<import("@langchain/core/language_models/chat_models").BaseChatModelCallOptions, import("langchain").AIMessageChunk<import("@langchain/core/messages").MessageStructure<import("@langchain/core/messages").MessageToolSet>>>;
    checkpointer: BaseCheckpointSaver<number>;
    memory: string[];
    backend: LocalShellBackend;
};
//# sourceMappingURL=pristine.d.ts.map