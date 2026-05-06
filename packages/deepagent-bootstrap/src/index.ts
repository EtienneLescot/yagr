import fs from 'node:fs/promises';
import path from 'node:path';
import { createDeepAgent, computeSummarizationDefaults, LocalShellBackend } from 'deepagents';
import { createMiddleware, countTokensApproximately, SystemMessage } from 'langchain';
import { MemorySaver } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, HumanMessage, ToolMessage, getBufferString, type BaseMessage } from '@langchain/core/messages';
import type { StreamEvent } from '@langchain/core/tracers/log_stream';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  CompactionService,
  type ContextCompactionEvent,
  type ManualCompactionOptions,
  type ManualCompactionResult,
} from '@yagr/session-service';

export type CreateDeepAgentRuntimeParams = Parameters<typeof createDeepAgent>[0];

export function createDeepAgentRuntime(params: CreateDeepAgentRuntimeParams): ReturnType<typeof createDeepAgent> {
  return createDeepAgent(params);
}

export interface YagrDeepAgentRuntimeOptions {
  rootDir?: string;
  memorySources?: string[];
  skillSourcePaths?: string[];
  replaceSkillSourcePaths?: boolean;
  systemPrompt?: string;
  historyLimit?: number;
}

export interface CreateYagrDeepAgentOptions {
  model: BaseChatModel;
  checkpointer?: BaseCheckpointSaver;
  defaultMemorySources?: string[];
  defaultSkillSourcePaths?: string[];
  runtimeOptions?: YagrDeepAgentRuntimeOptions;
}

export interface YagrDeepAgentHandle {
  agent: ReturnType<typeof createDeepAgent>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  checkpointer: any;
  compactionService: CompactionService;
}

type DeepAgentGraphState = {
  values?: Record<string, unknown>;
};

type DeepAgentStatefulGraph = ReturnType<typeof createDeepAgent> & {
  getState?: (config: Record<string, unknown>) => Promise<DeepAgentGraphState>;
  updateState?: (config: Record<string, unknown>, values: Record<string, unknown>) => Promise<unknown>;
};

type ContextSize = { type: 'messages' | 'tokens' | 'fraction'; value: number };

interface DeepAgentsSummarizationEvent {
  cutoffIndex: number;
  summaryMessage: HumanMessage;
  filePath: string | null;
}

const MANUAL_SUMMARY_PROMPT = `You are a conversation summarizer. Your task is to create a concise summary of the conversation that captures:
1. The main topics discussed
2. Key decisions or conclusions reached
3. Any important context that would be needed for continuing the conversation

Keep the summary focused and informative. Do not include unnecessary details.

Conversation to summarize:
{conversation}

Summary:`;

const DEFAULT_TRIM_TOKEN_LIMIT = 4000;
const INJECT_MEMORY_TOOL_NAME = 'inject_memory';

export async function createYagrDeepAgent(options: CreateYagrDeepAgentOptions): Promise<YagrDeepAgentHandle> {
  const model = options.model;
  const runtimeOptions = options.runtimeOptions ?? {};
  const checkpointerInstance = options.checkpointer ?? new MemorySaver();
  const rootDir = runtimeOptions.rootDir ?? process.cwd();
  const defaultSkills = options.defaultSkillSourcePaths ?? [];
  const skills = runtimeOptions.replaceSkillSourcePaths
    ? (runtimeOptions.skillSourcePaths ?? [])
    : [...defaultSkills, ...(runtimeOptions.skillSourcePaths ?? [])];
  const memory = [...new Set([
    ...(options.defaultMemorySources ?? []),
    ...(runtimeOptions.memorySources ?? []),
  ])];

  const pristineConfig = buildPristineDeepAgentConfig({
    model,
    checkpointer: checkpointerInstance,
    rootDir,
    memory,
    skills: [...new Set(skills)],
  });

  const agent = createDeepAgent({
    ...pristineConfig,
    ...(runtimeOptions.systemPrompt ? { systemPrompt: runtimeOptions.systemPrompt } : {}),
    middleware: getCodingOrientedDeepAgentMiddleware({
      runtimePathAnchor: `Backend working directory: ${rootDir}`,
    }),
  });

  const compactionService = new CompactionService(
    { historyLimit: runtimeOptions.historyLimit ?? 50 },
    (sessionId, compactOptions) => compactDeepAgentSession(agent as DeepAgentStatefulGraph, model, sessionId, compactOptions),
  );

  return { agent, checkpointer: checkpointerInstance, compactionService };
}

export function createPristineDeepAgentBackend(rootDir: string = process.cwd()) {
  return new LocalShellBackend({
    rootDir,
    inheritEnv: true,
  });
}

export function buildPristineDeepAgentConfig({
  model,
  checkpointer,
  rootDir = process.cwd(),
  memory = [],
  skills = [],
}: {
  model: BaseChatModel;
  checkpointer: BaseCheckpointSaver;
  rootDir?: string;
  memory?: string[];
  skills?: string[];
}) {
  return {
    model,
    checkpointer,
    memory,
    skills,
    backend: createPristineDeepAgentBackend(rootDir),
  };
}

export const CODING_ORIENTATION_SYSTEM_PROMPT = [
  'Operate as a coding-focused agent.',
  'Read the relevant repository files before making changes.',
  'When the user asks for code changes, prefer making the smallest correct edit in the workspace over giving advice only.',
  'Prefer repository evidence over assumptions and verify with the smallest relevant build, typecheck, or test command after edits.',
  'Keep changes explicit and local; avoid speculative rewrites or ad-hoc scripting when normal filesystem and shell usage is sufficient.',
].join(' ');

export interface CodingOrientationMiddlewareOptions {
  runtimePathAnchor?: string;
}

export function createCodingOrientationMiddleware(
  prompt: string = CODING_ORIENTATION_SYSTEM_PROMPT,
  options: CodingOrientationMiddlewareOptions = {},
) {
  return createMiddleware({
    name: 'YagrCodingOrientationMiddleware',
    wrapModelCall(request, handler) {
      const parts = [prompt, options.runtimePathAnchor].filter(Boolean);
      return handler({
        ...request,
        systemMessage: request.systemMessage.concat(
          new SystemMessage({ content: parts.join('\n\n') }),
        ),
      });
    },
  });
}

export function createEditFileToolInputNormalizerMiddleware() {
  return createMiddleware({
    name: 'YagrEditFileToolInputNormalizerMiddleware',
    wrapToolCall(request, handler) {
      if (request.toolCall.name !== 'edit_file') {
        return handler(request);
      }
      const args = request.toolCall.args;
      if (!args || typeof args !== 'object' || Array.isArray(args) || (args as Record<string, unknown>).replace_all !== null) {
        return handler(request);
      }
      const normalizedArgs = { ...(args as Record<string, unknown>) };
      delete normalizedArgs.replace_all;
      return handler({
        ...request,
        toolCall: {
          ...request.toolCall,
          args: normalizedArgs,
        },
      });
    },
  });
}

export function getCodingOrientedDeepAgentMiddleware(options: CodingOrientationMiddlewareOptions = {}) {
  return [
    createCodingOrientationMiddleware(CODING_ORIENTATION_SYSTEM_PROMPT, options),
    createEditFileToolInputNormalizerMiddleware(),
    createInjectMemoryMiddleware(),
  ];
}

export function createInjectMemoryMiddleware() {
  const injected = new Map<string, string>();

  const injectMemoryTool = tool(
    async ({ path: filePath }: { path: string }) => {
      const resolved = path.resolve(filePath);
      if (injected.has(resolved)) {
        return `Already active: "${resolved}" is already injected and governing this session. Do NOT call inject_memory again - proceed directly with the user's request.`;
      }
      try {
        const content = await fs.readFile(resolved, 'utf-8');
        injected.set(resolved, content);
        return `Injected: "${resolved}" (${content.length} chars) is now active for this session. Do NOT call inject_memory again - proceed directly with the user's request.`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `inject_memory failed for "${resolved}": ${message}`;
      }
    },
    {
      name: INJECT_MEMORY_TOOL_NAME,
      description: 'Inject an AGENTS.md or instruction file into persistent session memory. Call this ONCE before any other action when a workspace-specific AGENTS.md is required. If the tool returns "Already active", do NOT call it again - the instructions are already in effect.',
      schema: z.object({
        path: z.string().describe('Absolute path to the instruction file to inject (e.g. AGENTS.md).'),
      }),
    },
  );

  return createMiddleware({
    name: 'YagrInjectMemoryMiddleware',
    tools: [injectMemoryTool],
    wrapModelCall(request, handler) {
      if (injected.size === 0) {
        return handler(request);
      }
      const sections = Array.from(injected.entries())
        .map(([sourcePath, content]) => `<!-- source: ${sourcePath} -->\n${content}`)
        .join('\n\n');
      return handler({
        ...request,
        systemMessage: request.systemMessage.concat(new SystemMessage({
          content: `<injected_context>\n${sections}\n</injected_context>`,
        })),
      });
    },
  });
}

export interface CompactionMiddlewareOptions {
  sessionId: string;
  compactionService: CompactionService;
  onCompaction?: (event: ContextCompactionEvent) => void | Promise<void>;
}

export function createCompactionEventHandler(options: CompactionMiddlewareOptions) {
  const { sessionId, compactionService, onCompaction } = options;
  return async function handleCompactionEvent(event: StreamEvent): Promise<void> {
    const compactionEvent = extractCompactionEvent(event);
    if (!compactionEvent) {
      return;
    }
    await compactionService.notifyCompaction(sessionId, compactionEvent);
    await onCompaction?.(compactionEvent);
  };
}

export async function processCompactionFromStream(
  event: StreamEvent,
  sessionId: string,
  compactionService: CompactionService,
  onCompaction?: (event: ContextCompactionEvent) => void | Promise<void>,
): Promise<void> {
  const handler = createCompactionEventHandler({ sessionId, compactionService, onCompaction });
  await handler(event);
}

function extractCompactionEvent(event: StreamEvent): ContextCompactionEvent | null {
  if (!isCompactionEvent(event)) {
    return null;
  }
  try {
    const data = event.data as Record<string, unknown> | undefined;
    const chunk = data?.chunk as Record<string, unknown> | undefined;
    if (!chunk) return null;
    return {
      summary: String(chunk.summary ?? 'Context compacted'),
      source: chunk.source === 'fallback' ? 'fallback' : 'llm',
      estimatedTokens: Number(chunk.estimatedTokens ?? 0),
      thresholdTokens: Number(chunk.thresholdTokens ?? 0),
      messagesCompacted: Number(chunk.messagesCompacted ?? 0),
      preservedRecentMessages: Number(chunk.preservedRecentMessages ?? 4),
      fallbackReason: typeof chunk.fallbackReason === 'string' ? chunk.fallbackReason : undefined,
    };
  } catch {
    return null;
  }
}

function isCompactionEvent(event: StreamEvent): boolean {
  if (event.event === 'on_llm_new_token') {
    const name = 'name' in event ? (event.name as string) : '';
    return name === 'CompactionReducer' || name === 'context_compaction';
  }
  return typeof event.event === 'string' && (event.event.includes('compaction') || event.event.includes('context'));
}

async function compactDeepAgentSession(
  agent: DeepAgentStatefulGraph,
  model: BaseChatModel,
  sessionId: string,
  options: ManualCompactionOptions = {},
): Promise<ManualCompactionResult> {
  if (typeof agent.getState !== 'function' || typeof agent.updateState !== 'function') {
    return { status: 'unavailable', reason: 'The DeepAgents graph does not expose state access for manual compaction.' };
  }

  const config = buildThreadConfig(sessionId);
  try {
    const snapshot = await agent.getState(config);
    const values = snapshot.values ?? {};
    const stateMessages = normalizeMessages(options.messages ?? values.messages);
    if (stateMessages.length === 0) {
      return { status: 'skipped', reason: 'No session history is available to compact.' };
    }

    const previousEvent = normalizeSummarizationEvent(values._summarizationEvent);
    const effectiveMessages = getEffectiveMessages(stateMessages, previousEvent);
    const maxInputTokens = getMaxInputTokens(model);
    const defaults = computeSummarizationDefaults(model);
    const trigger = defaults.trigger as ContextSize;
    const keep = defaults.keep as ContextSize;

    if (!options.force && !shouldSummarize(effectiveMessages, trigger, maxInputTokens)) {
      return { status: 'skipped', reason: 'DeepAgents summarization threshold has not been reached.' };
    }

    const cutoffIndex = determineCutoffIndex(effectiveMessages, keep, maxInputTokens);
    if (cutoffIndex <= 0) {
      return { status: 'skipped', reason: 'Session history is too small to preserve useful recent context after compaction.' };
    }

    const messagesToSummarize = effectiveMessages.slice(0, cutoffIndex);
    const preservedMessages = effectiveMessages.slice(cutoffIndex);
    if (messagesToSummarize.length === 0 || preservedMessages.length === 0) {
      return { status: 'skipped', reason: 'Session history is too small to compact safely.' };
    }

    const summary = await createDeepAgentsSummary(messagesToSummarize, model, options);
    const summaryMessage = buildDeepAgentsSummaryMessage(summary);
    const stateCutoffIndex = previousEvent ? previousEvent.cutoffIndex + cutoffIndex - 1 : cutoffIndex;

    await agent.updateState(config, {
      _summarizationEvent: { cutoffIndex: stateCutoffIndex, summaryMessage, filePath: null },
      _summarizationSessionId: sessionId,
    });

    const event: ContextCompactionEvent = {
      summary,
      source: 'llm',
      estimatedTokens: countTokensApproximately(effectiveMessages),
      thresholdTokens: getThresholdTokens(trigger, maxInputTokens),
      messagesCompacted: messagesToSummarize.length,
      preservedRecentMessages: preservedMessages.length,
    };

    return { status: 'completed', event, messagesCompacted: event.messagesCompacted, preservedRecentMessages: event.preservedRecentMessages };
  } catch (error) {
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}

function buildThreadConfig(sessionId: string): { configurable: { thread_id: string }; version: 'v2' } {
  return { configurable: { thread_id: sessionId }, version: 'v2' };
}

function normalizeMessages(value: unknown): BaseMessage[] {
  return Array.isArray(value) ? value.filter((message): message is BaseMessage => Boolean(message) && typeof message === 'object') : [];
}

function normalizeSummarizationEvent(value: unknown): DeepAgentsSummarizationEvent | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const event = value as Record<string, unknown>;
  if (typeof event.cutoffIndex !== 'number' || !HumanMessage.isInstance(event.summaryMessage)) return undefined;
  return { cutoffIndex: event.cutoffIndex, summaryMessage: event.summaryMessage, filePath: typeof event.filePath === 'string' ? event.filePath : null };
}

function getEffectiveMessages(messages: BaseMessage[], previousEvent?: DeepAgentsSummarizationEvent): BaseMessage[] {
  return previousEvent ? [previousEvent.summaryMessage, ...messages.slice(previousEvent.cutoffIndex)] : messages;
}

function shouldSummarize(messages: BaseMessage[], trigger: ContextSize, maxInputTokens?: number): boolean {
  if (trigger.type === 'messages') return messages.length >= trigger.value;
  const tokens = countTokensApproximately(messages);
  if (trigger.type === 'tokens') return tokens >= trigger.value;
  return maxInputTokens !== undefined && tokens >= Math.floor(maxInputTokens * trigger.value);
}

function determineCutoffIndex(messages: BaseMessage[], keep: ContextSize, maxInputTokens?: number): number {
  let rawCutoff: number;
  if (keep.type === 'messages') {
    if (messages.length <= keep.value) return 0;
    rawCutoff = messages.length - keep.value;
  } else {
    const targetTokens = keep.type === 'fraction' && maxInputTokens !== undefined ? Math.floor(maxInputTokens * keep.value) : keep.value;
    let tokensKept = 0;
    rawCutoff = 0;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const messageTokens = countTokensApproximately([messages[index]]);
      if (tokensKept + messageTokens > targetTokens) {
        rawCutoff = index + 1;
        break;
      }
      tokensKept += messageTokens;
    }
  }
  return findSafeCutoffPoint(messages, rawCutoff);
}

function findSafeCutoffPoint(messages: BaseMessage[], cutoffIndex: number): number {
  if (cutoffIndex >= messages.length || !ToolMessage.isInstance(messages[cutoffIndex])) return cutoffIndex;
  let forwardIndex = cutoffIndex;
  while (forwardIndex < messages.length && ToolMessage.isInstance(messages[forwardIndex])) forwardIndex += 1;
  const toolCallIds = new Set<string>();
  for (let index = cutoffIndex; index < forwardIndex; index += 1) {
    const toolMessage = messages[index];
    if (ToolMessage.isInstance(toolMessage) && toolMessage.tool_call_id) toolCallIds.add(toolMessage.tool_call_id);
  }
  let backwardIndex: number | null = null;
  for (let index = cutoffIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!AIMessage.isInstance(message) || !message.tool_calls) continue;
    const aiToolCallIds = new Set(message.tool_calls.map((toolCall) => toolCall.id).filter((id): id is string => typeof id === 'string'));
    for (const id of toolCallIds) {
      if (aiToolCallIds.has(id)) {
        backwardIndex = index;
        break;
      }
    }
    if (backwardIndex !== null) break;
  }
  if (backwardIndex === null) return forwardIndex;
  if (cutoffIndex - backwardIndex > cutoffIndex / 2 && cutoffIndex > 2) return forwardIndex;
  return backwardIndex;
}

async function createDeepAgentsSummary(messages: BaseMessage[], model: BaseChatModel, options: ManualCompactionOptions): Promise<string> {
  const messagesToSummarize = trimMessagesToSummarize(messages);
  const conversation = getBufferString(messagesToSummarize);
  const prompt = MANUAL_SUMMARY_PROMPT.replace('{conversation}', conversation);
  const response = await model.invoke([new HumanMessage({ content: prompt })], options.abortSignal ? { signal: options.abortSignal } : undefined);
  return typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
}

function trimMessagesToSummarize(messages: BaseMessage[]): BaseMessage[] {
  if (countTokensApproximately(messages) <= DEFAULT_TRIM_TOKEN_LIMIT) return messages;
  let keptTokens = 0;
  const trimmed: BaseMessage[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const messageTokens = countTokensApproximately([messages[index]]);
    if (keptTokens + messageTokens > DEFAULT_TRIM_TOKEN_LIMIT) break;
    trimmed.unshift(messages[index]);
    keptTokens += messageTokens;
  }
  return trimmed;
}

function buildDeepAgentsSummaryMessage(summary: string): HumanMessage {
  return new HumanMessage({ content: `Here is a summary of the conversation to date:\n\n${summary}`, additional_kwargs: { lc_source: 'summarization' } });
}

function getMaxInputTokens(model: BaseChatModel): number | undefined {
  const profile = model.profile;
  return profile && typeof profile === 'object' && 'maxInputTokens' in profile && typeof profile.maxInputTokens === 'number' ? profile.maxInputTokens : undefined;
}

function getThresholdTokens(trigger: ContextSize, maxInputTokens?: number): number {
  if (trigger.type === 'tokens') return trigger.value;
  if (trigger.type === 'fraction' && maxInputTokens !== undefined) return Math.floor(maxInputTokens * trigger.value);
  return 0;
}
