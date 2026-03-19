import { generateText, type CoreMessage } from 'ai';
import type { YagrContextCompactionEvent, YagrLanguageModelConfig, YagrRunJournalEntry } from '../types.js';
import { createLanguageModel } from '../llm/create-language-model.js';
import { analyzeRunOutcome, formatObservedAction } from './outcome.js';
import { collectRequiredActions } from './required-actions.js';
import { INTERNAL_TAG_OPEN } from './run-engine.js';

const DEFAULT_CHARS_PER_TOKEN = 4;
const DEFAULT_THRESHOLD_PERCENT = 70;
const DEFAULT_PRESERVE_RECENT_MESSAGES = 6;
const MAX_TRANSCRIPT_CHARS = 24_000;

export interface ContextBudget {
  contextWindowTokens: number;
  reservedOutputTokens: number;
  thresholdPercent?: number;
  charsPerToken?: number;
  preserveRecentMessages?: number;
}

export interface CompactConversationInput {
  messages: CoreMessage[];
  prompt: string;
  journal: YagrRunJournalEntry[];
  systemPrompt: string;
  budget: ContextBudget;
  abortSignal?: AbortSignal;
  llmConfig?: YagrLanguageModelConfig;
  condense?: (prompt: string) => Promise<string>;
}

export interface CompactConversationResult {
  messages: CoreMessage[];
  event?: YagrContextCompactionEvent;
}

function contentToText(content: CoreMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }

        if (part && typeof part === 'object') {
          if ('text' in part && typeof part.text === 'string') {
            return part.text;
          }

          return JSON.stringify(part);
        }

        return String(part ?? '');
      })
      .join('\n');
  }

  return '';
}

function estimateTokensFromText(text: string, charsPerToken: number): number {
  if (!text) {
    return 0;
  }

  return Math.ceil(text.length / charsPerToken);
}

function estimateMessageTokens(messages: CoreMessage[], charsPerToken: number): number {
  return messages.reduce((total, message) => total + estimateTokensFromText(contentToText(message.content), charsPerToken), 0);
}

function buildAllowedTokenThreshold(budget: ContextBudget): number {
  const thresholdPercent = budget.thresholdPercent ?? DEFAULT_THRESHOLD_PERCENT;
  const cappedThreshold = Math.max(5, Math.min(95, thresholdPercent));
  const thresholdBudget = Math.floor((budget.contextWindowTokens * cappedThreshold) / 100);
  return Math.max(0, thresholdBudget - budget.reservedOutputTokens);
}

function sanitizeTranscriptText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.includes(INTERNAL_TAG_OPEN)) {
    return '';
  }

  return trimmed;
}

function transcriptAsText(messages: CoreMessage[]): string {
  const lines = messages
    .map((message) => {
      const text = sanitizeTranscriptText(contentToText(message.content));
      if (!text) {
        return '';
      }

      return `[${message.role}]\n${text}`;
    })
    .filter((line) => line.length > 0)
    .join('\n\n');

  if (lines.length <= MAX_TRANSCRIPT_CHARS) {
    return lines;
  }

  return `${lines.slice(0, MAX_TRANSCRIPT_CHARS)}\n\n[Transcript truncated for condensation]`;
}

function buildJournalDigest(prompt: string, journal: YagrRunJournalEntry[]): string {
  const outcome = analyzeRunOutcome(journal);
  const requiredActions = collectRequiredActions(journal);
  const lines: string[] = [];

  lines.push(`Original request: ${prompt}`);

  if (outcome.writtenFiles.length > 0) {
    lines.push(`Written files: ${outcome.writtenFiles.join(', ')}`);
  }

  if (outcome.updatedFiles.length > 0) {
    lines.push(`Updated files: ${outcome.updatedFiles.join(', ')}`);
  }

  if (outcome.successfulActions.length > 0) {
    lines.push(`Successful actions: ${outcome.successfulActions.map(formatObservedAction).join(', ')}`);
  }

  if (outcome.unresolvedFailedActions.length > 0) {
    lines.push(`Unresolved failures: ${outcome.unresolvedFailedActions.map(formatObservedAction).join(', ')}`);
  }

  if (requiredActions.length > 0) {
    lines.push(`Open required actions: ${requiredActions.map((action) => `${action.title} [${action.kind}]`).join(', ')}`);
  }

  return lines.join('\n');
}

function buildFallbackSummary(prompt: string, journal: YagrRunJournalEntry[], compactedMessages: CoreMessage[]): string {
  const transcript = transcriptAsText(compactedMessages)
    .split('\n')
    .slice(-12)
    .join('\n');

  return [
    '## Yagr Context Checkpoint',
    buildJournalDigest(prompt, journal),
    transcript ? `Compressed transcript excerpts:\n${transcript}` : '',
    'Continue from this checkpoint without redoing completed work. Re-read files or instructions if exact wording or structure is needed.',
  ].filter(Boolean).join('\n\n');
}

function buildSummaryPrompt(prompt: string, journal: YagrRunJournalEntry[], compactedMessages: CoreMessage[]): string {
  return [
    'You are condensing Yagr runtime context for continuation inside the same task.',
    'Produce a concise but loss-aware checkpoint summary.',
    'Keep facts that are necessary for the next agent call: user objective, confirmed decisions, files created or modified, validated or pushed actions, unresolved failures, open blockers, and any exact constraints that must continue to govern the work.',
    'Do not repeat generic boilerplate. Do not invent facts. Do not mention that you are an AI model.',
    'Preserve actionable exactness when a rule, filename, identifier, or required next step matters.',
    'Output plain text only. Start with the heading "## Yagr Context Checkpoint".',
    '',
    'Journal digest:',
    buildJournalDigest(prompt, journal),
    '',
    'Conversation to condense:',
    transcriptAsText(compactedMessages),
  ].join('\n');
}

async function generateCheckpointSummary(
  prompt: string,
  journal: YagrRunJournalEntry[],
  compactedMessages: CoreMessage[],
  abortSignal?: AbortSignal,
  llmConfig?: YagrLanguageModelConfig,
  condense?: (prompt: string) => Promise<string>,
): Promise<{ summary: string; source: 'llm' | 'fallback'; fallbackReason?: string }> {
  try {
    const summaryPrompt = buildSummaryPrompt(prompt, journal, compactedMessages);
    const summary = condense
      ? (await condense(summaryPrompt)).trim()
      : (await generateText({
          abortSignal,
          model: createLanguageModel(llmConfig),
          system: 'This is a context condensation operation. Do not call tools. Return only the checkpoint summary text.',
          messages: [
            {
              role: 'user',
              content: summaryPrompt,
            },
          ],
          maxSteps: 1,
        })).text.trim();

    if (summary.length > 0) {
      return { summary, source: 'llm' };
    }

    return {
      summary: buildFallbackSummary(prompt, journal, compactedMessages),
      source: 'fallback',
      fallbackReason: 'LLM condensation returned empty text.',
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }

    return {
      summary: buildFallbackSummary(prompt, journal, compactedMessages),
      source: 'fallback',
      fallbackReason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function compactConversationContext(input: CompactConversationInput): Promise<CompactConversationResult> {
  const charsPerToken = input.budget.charsPerToken ?? DEFAULT_CHARS_PER_TOKEN;
  const preserveRecentMessages = Math.max(2, input.budget.preserveRecentMessages ?? DEFAULT_PRESERVE_RECENT_MESSAGES);
  const estimatedTokens = estimateTokensFromText(input.systemPrompt, charsPerToken) + estimateMessageTokens(input.messages, charsPerToken);
  const thresholdTokens = buildAllowedTokenThreshold(input.budget);

  if (estimatedTokens <= thresholdTokens) {
    return { messages: input.messages };
  }

  if (input.messages.length <= preserveRecentMessages + 1) {
    return { messages: input.messages };
  }

  const splitIndex = Math.max(1, input.messages.length - preserveRecentMessages);
  const compactedMessages = input.messages.slice(0, splitIndex);
  const recentMessages = input.messages.slice(splitIndex);
  const checkpoint = await generateCheckpointSummary(
    input.prompt,
    input.journal,
    compactedMessages,
    input.abortSignal,
    input.llmConfig,
    input.condense,
  );

  const summaryMessage: CoreMessage = {
    role: 'user',
    content: checkpoint.summary,
  };

  return {
    messages: [summaryMessage, ...recentMessages],
    event: {
      summary: checkpoint.summary,
      source: checkpoint.source,
      fallbackReason: checkpoint.fallbackReason,
      estimatedTokens,
      thresholdTokens,
      messagesCompacted: compactedMessages.length,
      preservedRecentMessages: recentMessages.length,
    },
  };
}