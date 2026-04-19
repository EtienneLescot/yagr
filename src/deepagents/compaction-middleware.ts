import type { StreamEvent } from '@langchain/core/tracers/log_stream';
import type { YagrContextCompactionEvent } from '../types.js';
import type { CompactionService } from '../compaction/compaction-service.js';

export interface CompactionMiddlewareOptions {
  sessionId: string;
  compactionService: CompactionService;
  onCompaction?: (event: YagrContextCompactionEvent) => void | Promise<void>;
}

export function createCompactionEventHandler(options: CompactionMiddlewareOptions) {
  const { sessionId, compactionService, onCompaction } = options;

  return async function handleCompactionEvent(event: StreamEvent): Promise<void> {
    if (!isCompactionEvent(event)) {
      return;
    }

    const compactionEvent = extractCompactionEvent(event);
    if (!compactionEvent) {
      return;
    }

    await compactionService.notifyCompaction(sessionId, compactionEvent);
    await onCompaction?.(compactionEvent);
  };
}

function isCompactionEvent(event: StreamEvent): boolean {
  if (event.event === 'on_llm_new_token') {
    const name = 'name' in event ? (event.name as string) : '';
    return name === 'CompactionReducer' || name === 'context_compaction';
  }

  if (typeof event.event === 'string') {
    return event.event.includes('compaction') || event.event.includes('context');
  }

  return false;
}

function extractCompactionEvent(event: StreamEvent): YagrContextCompactionEvent | null {
  try {
    const data = event.data as Record<string, unknown> | undefined;
    if (!data) return null;

    const chunk = data.chunk as Record<string, unknown> | undefined;
    if (!chunk) return null;

    if (chunk.type === 'compaction' || chunk.__type === 'compaction') {
      return {
        summary: String(chunk.summary ?? 'Context compacted'),
        source: chunk.source as 'llm' | 'fallback' ?? 'llm',
        estimatedTokens: Number(chunk.estimatedTokens ?? 0),
        thresholdTokens: Number(chunk.thresholdTokens ?? 0),
        messagesCompacted: Number(chunk.messagesCompacted ?? 0),
        preservedRecentMessages: Number(chunk.preservedRecentMessages ?? 4),
        fallbackReason: chunk.fallbackReason as string | undefined,
      };
    }

    return {
      summary: String(chunk.summary ?? 'Context compacted'),
      source: 'llm',
      estimatedTokens: Number(chunk.estimatedTokens ?? 0),
      thresholdTokens: Number(chunk.thresholdTokens ?? 0),
      messagesCompacted: Number(chunk.messagesCompacted ?? 0),
      preservedRecentMessages: Number(chunk.preservedRecentMessages ?? 4),
    };
  } catch {
    return null;
  }
}

export async function processCompactionFromStream(
  event: StreamEvent,
  sessionId: string,
  compactionService: CompactionService,
  onCompaction?: (event: YagrContextCompactionEvent) => void | Promise<void>,
): Promise<void> {
  const handler = createCompactionEventHandler({ sessionId, compactionService, onCompaction });
  await handler(event);
}
