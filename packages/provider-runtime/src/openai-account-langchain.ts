import type { JSONSchema7, LanguageModelV1FunctionTool, LanguageModelV1Prompt, LanguageModelV1ToolChoice } from './provider-types.js';
import { BaseChatModel, type BaseChatModelCallOptions, type BaseChatModelParams, type BindToolsInput } from '@langchain/core/language_models/chat_models';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import type { ToolCall } from '@langchain/core/messages/tool';
import type { ChatResult } from '@langchain/core/outputs';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import type { Runnable } from '@langchain/core/runnables';
import { z } from 'zod';
import { createOpenAiAccountLanguageModel } from './openai-account.js';

interface OpenAiAccountChatCallOptions extends BaseChatModelCallOptions {
  tools?: LanguageModelV1FunctionTool[];
}

export class OpenAiAccountChatModel extends BaseChatModel<OpenAiAccountChatCallOptions> {
  static lc_name() {
    return 'OpenAiAccountChatModel';
  }

  readonly model: string;

  private readonly boundTools?: LanguageModelV1FunctionTool[];

  private readonly boundCallOptions?: Partial<OpenAiAccountChatCallOptions>;

  constructor(fields: BaseChatModelParams & { model: string; boundTools?: LanguageModelV1FunctionTool[]; boundCallOptions?: Partial<OpenAiAccountChatCallOptions> }) {
    super(fields);
    this.model = fields.model;
    this.boundTools = fields.boundTools;
    this.boundCallOptions = fields.boundCallOptions;
  }

  _llmType(): string {
    return 'openai-account-chat';
  }

  override _identifyingParams(): Record<string, unknown> {
    return {
      provider: 'openai-oauth',
      model: this.model,
    };
  }

  override bindTools(tools: BindToolsInput[], kwargs?: Partial<OpenAiAccountChatCallOptions>): Runnable {
    const normalizedTools = tools
      .map(toLanguageModelTool)
      .filter((tool): tool is LanguageModelV1FunctionTool => Boolean(tool));
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
    }) as unknown as Runnable;
  }

  async _generate(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    _runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
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

    const toolCalls = (result.toolCalls ?? []).map<ToolCall>((toolCall) => ({
      id: toolCall.toolCallId,
      name: toolCall.toolName,
      args: parseToolArgs(toolCall.toolName, toolCall.args),
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

function toLanguageModelPrompt(messages: BaseMessage[]): LanguageModelV1Prompt {
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
      const content = [] as Array<{ type: 'text'; text: string } | { type: 'tool-call'; toolCallId: string; toolName: string; args: unknown }>;
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

function stringifyMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }
        if (part && typeof part === 'object' && 'text' in part && typeof (part as { text?: unknown }).text === 'string') {
          return (part as { text: string }).text;
        }
        return '';
      })
      .join('\n')
      .trim();
  }

  return content == null ? '' : String(content);
}

function normalizeToolChoice(toolChoice: OpenAiAccountChatCallOptions['tool_choice']): LanguageModelV1ToolChoice | undefined {
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

function parseToolArgs(toolName: string, args: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(args);
    const normalized = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
    if (toolName === 'edit_file' && normalized.replace_all === null) {
      delete normalized.replace_all;
    }
    return normalized;
  } catch {
    return {};
  }
}

function toLanguageModelTool(input: BindToolsInput): LanguageModelV1FunctionTool | undefined {
  if (!input || typeof input !== 'object') {
    return undefined;
  }

  const candidate = input as {
    name?: unknown;
    description?: unknown;
    parameters?: unknown;
    schema?: unknown;
  };
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

function toJsonSchema(schema: unknown): JSONSchema7 {
  if (schema instanceof z.ZodType) {
    return normalizeJsonSchema(zodToJsonSchema(schema));
  }

  if (isSerializedZodSchema(schema)) {
    return normalizeJsonSchema(serializedZodToJsonSchema(schema));
  }

  if (schema && typeof schema === 'object') {
    return normalizeJsonSchema(schema as JSONSchema7);
  }

  return normalizeJsonSchema({
    type: 'object',
    properties: {},
    additionalProperties: true,
  });
}

function zodToJsonSchema(schema: z.ZodTypeAny): JSONSchema7 {
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
      anyOf: schema._def.options.map((option: z.ZodTypeAny) => zodToJsonSchema(option)),
    };
  }

  if (schema instanceof z.ZodObject) {
    const shape = schema._def.shape();
    const properties = Object.fromEntries(
      Object.entries(shape).map(([key, value]) => [key, zodToJsonSchema(value as z.ZodTypeAny)]),
    );
    const required = Object.entries(shape)
      .filter(([, value]) => !isOptionalZodSchema(value as z.ZodTypeAny))
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

function isOptionalZodSchema(schema: z.ZodTypeAny): boolean {
  return schema instanceof z.ZodOptional || schema instanceof z.ZodDefault;
}

function isSerializedZodSchema(schema: unknown): schema is { def: { type?: string; [key: string]: unknown } } {
  return Boolean(
    schema
      && typeof schema === 'object'
      && 'def' in (schema as Record<string, unknown>)
      && typeof (schema as { def?: unknown }).def === 'object',
  );
}

function serializedZodToJsonSchema(schema: { def: { type?: string; [key: string]: unknown } }): JSONSchema7 {
  const def = schema.def;
  switch (def.type) {
    case 'string':
      return { type: 'string' };
    case 'number':
      return { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'literal':
      return { enum: [def.value] as JSONSchema7['enum'] };
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
      const shape = shapeRecord && typeof shapeRecord === 'object' ? shapeRecord as Record<string, unknown> : {};
      const properties = Object.fromEntries(
        Object.entries(shape).map(([key, value]) => [key, serializedInnerTypeToJsonSchema(value)]),
      );
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

function serializedInnerTypeToJsonSchema(value: unknown): JSONSchema7 {
  return isSerializedZodSchema(value)
    ? serializedZodToJsonSchema(value)
    : toJsonSchema(value);
}

function isSerializedOptionalSchema(value: unknown): boolean {
  return isSerializedZodSchema(value) && (value.def.type === 'optional' || value.def.type === 'default');
}

function normalizeJsonSchema(schema: JSONSchema7): JSONSchema7 {
  const normalized: JSONSchema7 = { ...schema };

  if (normalized.type === 'object') {
    normalized.properties = normalized.properties ?? {};
  }

  if (normalized.items && typeof normalized.items === 'object' && !Array.isArray(normalized.items)) {
    normalized.items = normalizeJsonSchema(normalized.items as JSONSchema7);
  }

  if (Array.isArray(normalized.anyOf)) {
    normalized.anyOf = normalized.anyOf.map((entry) =>
      entry && typeof entry === 'object' && !Array.isArray(entry)
        ? normalizeJsonSchema(entry as JSONSchema7)
        : entry,
    );
  }

  if (normalized.properties) {
    normalized.properties = Object.fromEntries(
      Object.entries(normalized.properties).map(([key, value]) => [
        key,
        value && typeof value === 'object' && !Array.isArray(value)
          ? normalizeJsonSchema(value as JSONSchema7)
          : value,
      ]),
    );
  }

  return normalized;
}
