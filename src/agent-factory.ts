/**
 * Yagr deep-agent factory.
 *
 * Keeps the Yagr runtime close to vanilla `createDeepAgent` while composing
 * a clearly separated coding-oriented middleware overlay:
 *
 *   - pristine deepagents core: host-native backend + native memory and skills loading
 *   - coding-oriented overlay: a dedicated middleware layer with generic
 *     coding guidance only
 *   - checkpointer so per-thread (=per-session) state is maintained and
 *     can be persisted to disk for checkpoint/restore functionality
 *
 * Usage:
 *   const agentHandle = await createYagrDeepAgent(engine, configService);
 *   // agentHandle.agent is a CompiledStateGraph — call streamEvents / invoke
 *   // with { configurable: { thread_id: sessionId } }
 */
import { createDeepAgent, computeSummarizationDefaults } from 'deepagents';
import { countTokensApproximately } from 'langchain';
import { MemorySaver } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import { AIMessage, HumanMessage, ToolMessage, getBufferString, type BaseMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { YagrConfigStoreLike } from './config/yagr-config-service.js';
import { createLangChainModel } from './llm/create-langchain-model.js';
import { getCodingOrientedDeepAgentMiddleware } from './deepagents/coding-orientation.js';
import { buildPristineDeepAgentConfig, getPristineDeepAgentMemorySources } from './deepagents/pristine.js';
import { getYagrHomeDir } from './config/yagr-home.js';
import type { YagrContextCompactionEvent, YagrManualCompactionOptions, YagrManualCompactionResult, YagrRunOptions } from './types.js';
import { CompactionService } from './compaction/compaction-service.js';
import { getDeepAgentSkillSourcePaths } from './skills/agent-skills.js';

/** Returned by `createYagrDeepAgent`. */
export interface YagrDeepAgentHandle {
  /** The compiled LangGraph agent — call `streamEvents` or `invoke`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent: ReturnType<typeof createDeepAgent>;
  /** The checkpointer — shared across calls so per-thread state persists. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  checkpointer: any;
  /** Compaction service — tracks context compaction events and history. */
  compactionService: CompactionService;
}

export interface YagrDeepAgentRuntimeOptions {
  /** DeepAgents backend working directory. Defaults to Yagr home for CLI/runtime compatibility. */
  rootDir?: string;
  /** Extra memory files to append to the default Yagr memory sources. */
  memorySources?: string[];
  /** Extra or replacement DeepAgents skill roots. Defaults to Yagr skill roots for the selected root. */
  skillSourcePaths?: string[];
  /** Replace default Yagr skill roots instead of appending to them. */
  replaceSkillSourcePaths?: boolean;
  /** Extra system prompt appended by the embedding surface, e.g. selected workflow context. */
  systemPrompt?: string;
}

export const getYagrAgentMemorySources = getPristineDeepAgentMemorySources;
export const getYagrAgentSkillSourcePaths = getDeepAgentSkillSourcePaths;

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

/**
 * Instantiate a Yagr-configured deep agent.
 *
 * This should be called once per active engine instance.  When the engine
 * is invalidated by runtime configuration changes, discard the handle and call this
 * again; the new handle will use a fresh checkpointer so session history
 * starts over — matching the current behaviour where `agents.clear()` is
 * called on config change.
 *
 * @param configStore Optional config store to read LLM defaults from.
 * @param modelConfig Optional explicit model overrides (provider, model, apiKey, baseUrl).
 * @param checkpointer Optional checkpointer instance. If not provided, a new MemorySaver is created.
 * @param runOptions Optional run options including compaction configuration.
 */
export async function createYagrDeepAgent(
  configStore?: YagrConfigStoreLike,
  modelConfig?: { provider?: string; model?: string; apiKey?: string; baseUrl?: string },
  checkpointer?: BaseCheckpointSaver,
  runOptions?: YagrRunOptions,
  runtimeOptions: YagrDeepAgentRuntimeOptions = {},
): Promise<YagrDeepAgentHandle> {
  const model = await createLangChainModel(modelConfig, configStore);
  const checkpointerInstance = checkpointer ?? new MemorySaver();
  const rootDir = runtimeOptions.rootDir ?? getYagrHomeDir();
  const defaultSkills = getDeepAgentSkillSourcePaths({ contextRoot: rootDir });
  const skills = runtimeOptions.replaceSkillSourcePaths
    ? (runtimeOptions.skillSourcePaths ?? [])
    : [...defaultSkills, ...(runtimeOptions.skillSourcePaths ?? [])];

  const pristineConfig = buildPristineDeepAgentConfig({
    model,
    checkpointer: checkpointerInstance,
    rootDir,
    skills: [...new Set(skills)],
  });

  const agent = createDeepAgent({
    ...pristineConfig,
    memory: [...new Set([
      ...pristineConfig.memory,
      ...(runtimeOptions.memorySources ?? []),
    ])],
    ...(runtimeOptions.systemPrompt ? { systemPrompt: runtimeOptions.systemPrompt } : {}),
    middleware: getCodingOrientedDeepAgentMiddleware({
      runtimePathAnchor: `Backend working directory: ${rootDir}`,
    }),
  });

  const compactionService = new CompactionService(
    { historyLimit: runOptions?.historyLimit ?? 50 },
    (sessionId, options) => compactDeepAgentSession(agent as DeepAgentStatefulGraph, model, sessionId, options),
  );

  return { agent, checkpointer: checkpointerInstance, compactionService };
}

async function compactDeepAgentSession(
  agent: DeepAgentStatefulGraph,
  model: BaseChatModel,
  sessionId: string,
  options: YagrManualCompactionOptions = {},
): Promise<YagrManualCompactionResult> {
  if (typeof agent.getState !== 'function' || typeof agent.updateState !== 'function') {
    return {
      status: 'unavailable',
      reason: 'The DeepAgents graph does not expose state access for manual compaction.',
    };
  }

  const config = buildThreadConfig(sessionId);

  try {
    const snapshot = await agent.getState(config);
    const values = snapshot.values ?? {};
    const stateMessages = normalizeMessages(options.messages ?? values.messages);
    if (stateMessages.length === 0) {
      return {
        status: 'skipped',
        reason: 'No session history is available to compact.',
      };
    }

    const previousEvent = normalizeSummarizationEvent(values._summarizationEvent);
    const effectiveMessages = getEffectiveMessages(stateMessages, previousEvent);
    const maxInputTokens = getMaxInputTokens(model);
    const defaults = computeSummarizationDefaults(model);
    const trigger = defaults.trigger as ContextSize;
    const keep = defaults.keep as ContextSize;

    if (!options.force && !shouldSummarize(effectiveMessages, trigger, maxInputTokens)) {
      return {
        status: 'skipped',
        reason: 'DeepAgents summarization threshold has not been reached.',
      };
    }

    const cutoffIndex = determineCutoffIndex(effectiveMessages, keep, maxInputTokens);
    if (cutoffIndex <= 0) {
      return {
        status: 'skipped',
        reason: 'Session history is too small to preserve useful recent context after compaction.',
      };
    }

    const messagesToSummarize = effectiveMessages.slice(0, cutoffIndex);
    const preservedMessages = effectiveMessages.slice(cutoffIndex);
    if (messagesToSummarize.length === 0 || preservedMessages.length === 0) {
      return {
        status: 'skipped',
        reason: 'Session history is too small to compact safely.',
      };
    }

    const summary = await createDeepAgentsSummary(messagesToSummarize, model, options);
    const summaryMessage = buildDeepAgentsSummaryMessage(summary);
    const stateCutoffIndex = previousEvent
      ? previousEvent.cutoffIndex + cutoffIndex - 1
      : cutoffIndex;

    await agent.updateState(config, {
      _summarizationEvent: {
        cutoffIndex: stateCutoffIndex,
        summaryMessage,
        filePath: null,
      },
      _summarizationSessionId: sessionId,
    });

    const event: YagrContextCompactionEvent = {
      summary,
      source: 'llm',
      estimatedTokens: countTokensApproximately(effectiveMessages),
      thresholdTokens: getThresholdTokens(trigger, maxInputTokens),
      messagesCompacted: messagesToSummarize.length,
      preservedRecentMessages: preservedMessages.length,
    };

    return {
      status: 'completed',
      event,
      messagesCompacted: event.messagesCompacted,
      preservedRecentMessages: event.preservedRecentMessages,
    };
  } catch (error) {
    return {
      status: 'failed',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildThreadConfig(sessionId: string): { configurable: { thread_id: string }; version: 'v2' } {
  return {
    configurable: { thread_id: sessionId },
    version: 'v2',
  };
}

function normalizeMessages(value: unknown): BaseMessage[] {
  return Array.isArray(value)
    ? value.filter((message): message is BaseMessage => Boolean(message) && typeof message === 'object')
    : [];
}

function normalizeSummarizationEvent(value: unknown): DeepAgentsSummarizationEvent | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const event = value as Record<string, unknown>;
  if (typeof event.cutoffIndex !== 'number' || !HumanMessage.isInstance(event.summaryMessage)) {
    return undefined;
  }
  return {
    cutoffIndex: event.cutoffIndex,
    summaryMessage: event.summaryMessage,
    filePath: typeof event.filePath === 'string' ? event.filePath : null,
  };
}

function getEffectiveMessages(messages: BaseMessage[], previousEvent?: DeepAgentsSummarizationEvent): BaseMessage[] {
  if (!previousEvent) {
    return messages;
  }
  return [previousEvent.summaryMessage, ...messages.slice(previousEvent.cutoffIndex)];
}

function shouldSummarize(messages: BaseMessage[], trigger: ContextSize, maxInputTokens?: number): boolean {
  if (trigger.type === 'messages') {
    return messages.length >= trigger.value;
  }
  const tokens = countTokensApproximately(messages);
  if (trigger.type === 'tokens') {
    return tokens >= trigger.value;
  }
  return maxInputTokens !== undefined && tokens >= Math.floor(maxInputTokens * trigger.value);
}

function determineCutoffIndex(messages: BaseMessage[], keep: ContextSize, maxInputTokens?: number): number {
  let rawCutoff: number;
  if (keep.type === 'messages') {
    if (messages.length <= keep.value) {
      return 0;
    }
    rawCutoff = messages.length - keep.value;
  } else {
    const targetTokens = keep.type === 'fraction' && maxInputTokens !== undefined
      ? Math.floor(maxInputTokens * keep.value)
      : keep.value;
    let tokensKept = 0;
    rawCutoff = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      const messageTokens = countTokensApproximately([messages[i]]);
      if (tokensKept + messageTokens > targetTokens) {
        rawCutoff = i + 1;
        break;
      }
      tokensKept += messageTokens;
    }
  }

  return findSafeCutoffPoint(messages, rawCutoff);
}

function findSafeCutoffPoint(messages: BaseMessage[], cutoffIndex: number): number {
  if (cutoffIndex >= messages.length || !ToolMessage.isInstance(messages[cutoffIndex])) {
    return cutoffIndex;
  }

  let forwardIndex = cutoffIndex;
  while (forwardIndex < messages.length && ToolMessage.isInstance(messages[forwardIndex])) {
    forwardIndex += 1;
  }

  const toolCallIds = new Set<string>();
  for (let i = cutoffIndex; i < forwardIndex; i++) {
    const toolMessage = messages[i];
    if (ToolMessage.isInstance(toolMessage) && toolMessage.tool_call_id) {
      toolCallIds.add(toolMessage.tool_call_id);
    }
  }

  let backwardIndex: number | null = null;
  for (let i = cutoffIndex - 1; i >= 0; i--) {
    const message = messages[i];
    if (!AIMessage.isInstance(message) || !message.tool_calls) {
      continue;
    }
    const aiToolCallIds = new Set(message.tool_calls.map((toolCall) => toolCall.id).filter((id): id is string => typeof id === 'string'));
    for (const id of toolCallIds) {
      if (aiToolCallIds.has(id)) {
        backwardIndex = i;
        break;
      }
    }
    if (backwardIndex !== null) {
      break;
    }
  }

  if (backwardIndex === null) {
    return forwardIndex;
  }
  if (cutoffIndex - backwardIndex > cutoffIndex / 2 && cutoffIndex > 2) {
    return forwardIndex;
  }
  return backwardIndex;
}

async function createDeepAgentsSummary(
  messages: BaseMessage[],
  model: BaseChatModel,
  options: YagrManualCompactionOptions,
): Promise<string> {
  const messagesToSummarize = trimMessagesToSummarize(messages);
  const conversation = getBufferString(messagesToSummarize);
  const prompt = MANUAL_SUMMARY_PROMPT.replace('{conversation}', conversation);
  const response = await model.invoke(
    [new HumanMessage({ content: prompt })],
    options.abortSignal ? { signal: options.abortSignal } : undefined,
  );
  return typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
}

function trimMessagesToSummarize(messages: BaseMessage[]): BaseMessage[] {
  if (countTokensApproximately(messages) <= DEFAULT_TRIM_TOKEN_LIMIT) {
    return messages;
  }
  let keptTokens = 0;
  const trimmed: BaseMessage[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const messageTokens = countTokensApproximately([messages[i]]);
    if (keptTokens + messageTokens > DEFAULT_TRIM_TOKEN_LIMIT) {
      break;
    }
    trimmed.unshift(messages[i]);
    keptTokens += messageTokens;
  }
  return trimmed;
}

function buildDeepAgentsSummaryMessage(summary: string): HumanMessage {
  return new HumanMessage({
    content: `Here is a summary of the conversation to date:\n\n${summary}`,
    additional_kwargs: { lc_source: 'summarization' },
  });
}

function getMaxInputTokens(model: BaseChatModel): number | undefined {
  const profile = model.profile;
  return profile && typeof profile === 'object' && 'maxInputTokens' in profile && typeof profile.maxInputTokens === 'number'
    ? profile.maxInputTokens
    : undefined;
}

function getThresholdTokens(trigger: ContextSize, maxInputTokens?: number): number {
  if (trigger.type === 'tokens') {
    return trigger.value;
  }
  if (trigger.type === 'fraction' && maxInputTokens !== undefined) {
    return Math.floor(maxInputTokens * trigger.value);
  }
  return 0;
}
