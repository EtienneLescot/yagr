import type { SessionMessage } from '../session/session-types.js';
import type { SessionMemoryRecord, WorkflowRef } from './memory-types.js';

/**
 * Tools that are purely operational/commentary — excluded from the "toolsUsed"
 * list so it stays signal-rich rather than listing every housekeeping call.
 */
const NOISE_TOOLS = new Set([
  'reportProgress',
  'requestRequiredAction',
  'presentWorkflowResult', // captured separately as a WorkflowRef
]);

/**
 * Extract a compact, structured memory record from a completed session's
 * message history. Pure function — no I/O, no LLM calls.
 */
export function extractSessionMemory(
  sessionId: string,
  title: string,
  createdAt: string,
  messages: readonly SessionMessage[],
): SessionMemoryRecord {
  const userTexts: string[] = [];
  const toolNames = new Set<string>();
  const workflowRefs: WorkflowRef[] = [];
  const seenWorkflowIds = new Set<string>();
  let lastAssistantText = '';

  for (const msg of messages) {
    if (msg.role === 'user') {
      const text = extractTextFromContent(msg.content);
      if (text) {
        userTexts.push(text.slice(0, 120).replace(/\s+/g, ' ').trim());
      }
    } else if (msg.role === 'assistant') {
      const parts = Array.isArray(msg.content) ? msg.content : [];
      for (const part of parts) {
        if (!part || typeof part !== 'object') {
          continue;
        }

        const typedPart = part as unknown as Record<string, unknown>;

        if (typedPart['type'] === 'text') {
          const text = String(typedPart['text'] ?? '').trim();
          if (text) {
            lastAssistantText = text.slice(0, 220).replace(/\s+/g, ' ');
          }
        }

        if (typedPart['type'] === 'tool-call') {
          const toolName = String(typedPart['toolName'] ?? '');
          if (toolName && !NOISE_TOOLS.has(toolName)) {
            toolNames.add(toolName);
          }

          // Capture workflow references from presentWorkflowResult calls.
          if (toolName === 'presentWorkflowResult') {
            const args = typedPart['args'] as Record<string, unknown> | undefined;
            const wfId = String(args?.['workflowId'] ?? '').trim();
            const wfTitle = String(args?.['title'] ?? wfId).trim();
            if (wfId && !seenWorkflowIds.has(wfId)) {
              seenWorkflowIds.add(wfId);
              workflowRefs.push({ id: wfId, title: wfTitle || wfId });
            }
          }

          if (toolName === 'execute') {
            const args = typedPart['args'] as Record<string, unknown> | undefined;
            const command = String(args?.['command'] ?? '').trim();
            const workflowId = extractWorkflowIdFromPresentWorkflowCommand(command);
            if (workflowId && !seenWorkflowIds.has(workflowId)) {
              seenWorkflowIds.add(workflowId);
              workflowRefs.push({ id: workflowId, title: workflowId });
            }
          }
        }
      }

      // Also handle plain string content (rare but possible).
      if (typeof msg.content === 'string' && msg.content.trim()) {
        lastAssistantText = msg.content.slice(0, 220).replace(/\s+/g, ' ');
      }
    }
  }

  const summaryParts: string[] = [];

  // Requests — show at most 2 distinct asks.
  const distinctRequests = [...new Set(userTexts)].slice(0, 2);
  if (distinctRequests.length > 0) {
    summaryParts.push(`Requests: ${distinctRequests.map((t) => `"${t}"`).join('; ')}.`);
  }

  // Workflows.
  if (workflowRefs.length > 0) {
    const refs = workflowRefs.map((w) => `"${w.title}" (${w.id})`).join(', ');
    summaryParts.push(`Workflows: ${refs}.`);
  }

  // Last assistant response — trim aggressively to keep the block small.
  if (lastAssistantText) {
    const trimmed = lastAssistantText.length > 180
      ? `${lastAssistantText.slice(0, 177)}…`
      : lastAssistantText;
    summaryParts.push(`Last response: ${trimmed}`);
  }

  return {
    sessionId,
    title,
    createdAt,
    updatedAt: new Date().toISOString(),
    summary: summaryParts.join(' '),
    toolsUsed: [...toolNames].sort(),
    workflowRefs,
  };
}

function extractWorkflowIdFromPresentWorkflowCommand(command: string): string | undefined {
  const match = command.match(/(?:^|\s)(?:npx\s+)?yagr\s+presentWorkflowResult\s+.*?--workflow-id\s+(?:"([^"]+)"|'([^']+)'|(\S+))/);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .filter((p): p is { type: 'text'; text: string } => p?.type === 'text')
    .map((p) => p.text)
    .join(' ');
}
