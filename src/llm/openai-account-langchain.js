import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { createOpenAiAccountLanguageModel } from './openai-account.js';
export class OpenAiAccountChatModel extends BaseChatModel {
    static lc_name() {
        return 'OpenAiAccountChatModel';
    }
    model;
    boundTools;
    boundCallOptions;
    constructor(fields) {
        super(fields);
        this.model = fields.model;
        this.boundTools = fields.boundTools;
        this.boundCallOptions = fields.boundCallOptions;
    }
    _llmType() {
        return 'openai-account-chat';
    }
    _identifyingParams() {
        return {
            provider: 'openai-oauth',
            model: this.model,
        };
    }
    bindTools(tools, kwargs) {
        const normalizedTools = tools
            .map(toLanguageModelTool)
            .filter((tool) => Boolean(tool));
        const boundCallOptions = {
            ...(kwargs ?? {}),
            tool_choice: kwargs?.tool_choice ?? (normalizedTools.length > 0 ? 'any' : undefined),
        };
        return new OpenAiAccountChatModel({
            model: this.model,
            disableStreaming: this.disableStreaming,
            outputVersion: this.outputVersion,
            boundTools: normalizedTools,
            boundCallOptions,
            ...(kwargs?.callbacks ? { callbacks: kwargs.callbacks } : {}),
            ...(kwargs?.tags ? { tags: kwargs.tags } : {}),
            ...(kwargs?.metadata ? { metadata: kwargs.metadata } : {}),
        });
    }
    async _generate(messages, options, _runManager) {
        const model = createOpenAiAccountLanguageModel(this.model);
        const boundToolChoice = this.boundCallOptions?.tool_choice;
        const result = await model.doGenerate({
            inputFormat: 'prompt',
            mode: {
                type: 'regular',
                tools: options.tools ?? this.boundTools ?? [],
                toolChoice: normalizeToolChoice(options.tool_choice ?? boundToolChoice),
            },
            prompt: toLanguageModelPrompt(messages),
            abortSignal: options.signal,
        });
        const text = result.text ?? '';
        const toolCalls = (result.toolCalls ?? []).map((toolCall) => ({
            id: toolCall.toolCallId,
            name: toolCall.toolName,
            args: parseToolArgs(toolCall.args),
        }));
        const aiMessage = new AIMessage({
            content: text,
            tool_calls: toolCalls,
            usage_metadata: result.usage
                ? {
                    input_tokens: result.usage.promptTokens,
                    output_tokens: result.usage.completionTokens,
                    total_tokens: result.usage.promptTokens + result.usage.completionTokens,
                }
                : undefined,
        });
        return {
            generations: [{
                    text,
                    message: aiMessage,
                    generationInfo: {
                        finishReason: result.finishReason,
                        warnings: result.warnings,
                    },
                }],
            llmOutput: {
                finishReason: result.finishReason,
                usage: result.usage,
                warnings: result.warnings,
            },
        };
    }
}
function toLanguageModelPrompt(messages) {
    return messages.map((message) => {
        if (SystemMessage.isInstance(message)) {
            return {
                role: 'system',
                content: stringifyMessageContent(message.content),
            };
        }
        if (HumanMessage.isInstance(message)) {
            return {
                role: 'user',
                content: [{ type: 'text', text: stringifyMessageContent(message.content) }],
            };
        }
        if (ToolMessage.isInstance(message)) {
            return {
                role: 'tool',
                content: [{
                        type: 'tool-result',
                        toolCallId: message.tool_call_id,
                        toolName: message.name || 'tool',
                        result: stringifyMessageContent(message.content),
                        isError: message.status === 'error',
                    }],
            };
        }
        if (AIMessage.isInstance(message)) {
            const content = [];
            const text = stringifyMessageContent(message.content);
            if (text) {
                content.push({ type: 'text', text });
            }
            for (const toolCall of message.tool_calls ?? []) {
                content.push({
                    type: 'tool-call',
                    toolCallId: toolCall.id || toolCall.name,
                    toolName: toolCall.name,
                    args: toolCall.args,
                });
            }
            return {
                role: 'assistant',
                content,
            };
        }
        return {
            role: 'user',
            content: [{ type: 'text', text: stringifyMessageContent(message.content) }],
        };
    });
}
function stringifyMessageContent(content) {
    if (typeof content === 'string') {
        return content;
    }
    if (Array.isArray(content)) {
        return content
            .map((part) => {
            if (typeof part === 'string') {
                return part;
            }
            if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
                return part.text;
            }
            return '';
        })
            .join('\n')
            .trim();
    }
    return content == null ? '' : String(content);
}
function normalizeToolChoice(toolChoice) {
    if (!toolChoice || toolChoice === 'auto') {
        return undefined;
    }
    if (toolChoice === 'any') {
        return { type: 'required' };
    }
    if (toolChoice === 'none') {
        return { type: 'none' };
    }
    if (typeof toolChoice === 'string') {
        return { type: 'tool', toolName: toolChoice };
    }
    return undefined;
}
function parseToolArgs(args) {
    try {
        const parsed = JSON.parse(args);
        return parsed && typeof parsed === 'object' ? parsed : {};
    }
    catch {
        return {};
    }
}
function toLanguageModelTool(input) {
    if (!input || typeof input !== 'object') {
        return undefined;
    }
    const candidate = input;
    const name = typeof candidate.name === 'string' ? candidate.name : undefined;
    if (!name) {
        return undefined;
    }
    const parameters = toJsonSchema(candidate.parameters ?? candidate.schema);
    return {
        type: 'function',
        name,
        description: typeof candidate.description === 'string' ? candidate.description : undefined,
        parameters,
        strict: true,
    };
}
function toJsonSchema(schema) {
    if (schema instanceof z.ZodType) {
        return normalizeJsonSchema(zodToJsonSchema(schema));
    }
    if (isSerializedZodSchema(schema)) {
        return normalizeJsonSchema(serializedZodToJsonSchema(schema));
    }
    if (schema && typeof schema === 'object') {
        return normalizeJsonSchema(schema);
    }
    return normalizeJsonSchema({
        type: 'object',
        properties: {},
        additionalProperties: true,
    });
}
function zodToJsonSchema(schema) {
    if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable || schema instanceof z.ZodDefault) {
        return zodToJsonSchema(schema._def.innerType);
    }
    if (schema instanceof z.ZodString) {
        return { type: 'string' };
    }
    if (schema instanceof z.ZodNumber) {
        return { type: 'number' };
    }
    if (schema instanceof z.ZodBoolean) {
        return { type: 'boolean' };
    }
    if (schema instanceof z.ZodEnum) {
        return { type: 'string', enum: [...schema._def.values] };
    }
    if (schema instanceof z.ZodLiteral) {
        return { enum: [schema._def.value] };
    }
    if (schema instanceof z.ZodArray) {
        return {
            type: 'array',
            items: zodToJsonSchema(schema._def.type),
        };
    }
    if (schema instanceof z.ZodUnion) {
        return {
            anyOf: schema._def.options.map((option) => zodToJsonSchema(option)),
        };
    }
    if (schema instanceof z.ZodObject) {
        const shape = schema._def.shape();
        const properties = Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, zodToJsonSchema(value)]));
        const required = Object.entries(shape)
            .filter(([, value]) => !isOptionalZodSchema(value))
            .map(([key]) => key);
        return {
            type: 'object',
            properties,
            additionalProperties: false,
            ...(required.length > 0 ? { required } : {}),
        };
    }
    return {};
}
function isOptionalZodSchema(schema) {
    return schema instanceof z.ZodOptional || schema instanceof z.ZodDefault;
}
function isSerializedZodSchema(schema) {
    return Boolean(schema
        && typeof schema === 'object'
        && 'def' in schema
        && typeof schema.def === 'object');
}
function serializedZodToJsonSchema(schema) {
    const def = schema.def;
    switch (def.type) {
        case 'string':
            return { type: 'string' };
        case 'number':
            return { type: 'number' };
        case 'boolean':
            return { type: 'boolean' };
        case 'literal':
            return { enum: [def.value] };
        case 'enum':
            return { type: 'string', enum: Array.isArray(def.values) ? [...def.values] : [] };
        case 'nullable':
        case 'optional':
        case 'default':
            return serializedInnerTypeToJsonSchema(def.innerType);
        case 'array':
            return {
                type: 'array',
                items: serializedInnerTypeToJsonSchema(def.type),
            };
        case 'union':
            return {
                anyOf: Array.isArray(def.options)
                    ? def.options.map((option) => serializedInnerTypeToJsonSchema(option))
                    : [],
            };
        case 'object': {
            const shapeRecord = typeof def.shape === 'function' ? def.shape() : def.shape;
            const shape = shapeRecord && typeof shapeRecord === 'object' ? shapeRecord : {};
            const properties = Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, serializedInnerTypeToJsonSchema(value)]));
            const required = Object.entries(shape)
                .filter(([, value]) => !isSerializedOptionalSchema(value))
                .map(([key]) => key);
            return {
                type: 'object',
                properties,
                additionalProperties: false,
                ...(required.length > 0 ? { required } : {}),
            };
        }
        default:
            return {};
    }
}
function serializedInnerTypeToJsonSchema(value) {
    return isSerializedZodSchema(value)
        ? serializedZodToJsonSchema(value)
        : toJsonSchema(value);
}
function isSerializedOptionalSchema(value) {
    return isSerializedZodSchema(value) && (value.def.type === 'optional' || value.def.type === 'default');
}
function normalizeJsonSchema(schema) {
    const normalized = { ...schema };
    if (normalized.type === 'object') {
        normalized.properties = normalized.properties ?? {};
    }
    if (normalized.items && typeof normalized.items === 'object' && !Array.isArray(normalized.items)) {
        normalized.items = normalizeJsonSchema(normalized.items);
    }
    if (Array.isArray(normalized.anyOf)) {
        normalized.anyOf = normalized.anyOf.map((entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
            ? normalizeJsonSchema(entry)
            : entry);
    }
    if (normalized.properties) {
        normalized.properties = Object.fromEntries(Object.entries(normalized.properties).map(([key, value]) => [
            key,
            value && typeof value === 'object' && !Array.isArray(value)
                ? normalizeJsonSchema(value)
                : value,
        ]));
    }
    return normalized;
}
//# sourceMappingURL=openai-account-langchain.js.map