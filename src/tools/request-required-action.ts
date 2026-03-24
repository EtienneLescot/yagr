import { randomUUID } from 'node:crypto';
import { tool } from 'ai';
import { z } from 'zod';
import type { YagrRequiredAction } from '../types.js';
import { emitToolEvent, type ToolExecutionObserver } from './observer.js';

export function createRequestRequiredActionTool(observer?: ToolExecutionObserver) {
  return tool({
    description: 'Raise a structured required action when progress is blocked on user input, permission, or an external dependency. Use this instead of asking only in plain assistant text.',
    parameters: z.object({
      kind: z.enum(['input', 'permission', 'external']).describe('Type of blocker that needs user or external action.'),
      title: z.string().min(1).max(120).describe('Short title for the blocker.'),
      message: z.string().min(1).max(500).describe('Short actionable message shown to the user.'),
      detail: z.string().max(1000).nullable().optional().describe('Detailed explanation or next step. Use null when there is no extra detail.'),
      resumable: z.boolean().optional().default(true).describe('Whether the run should be considered resumable once the action is satisfied.'),
    }),
    execute: async ({ kind, title, message, detail, resumable }) => {
      const requiredAction: YagrRequiredAction = {
        id: randomUUID(),
        kind,
        title,
        message,
        detail: detail ?? undefined,
        resumable: resumable ?? true,
      };

      await emitToolEvent(observer, {
        type: 'status',
        toolName: 'requestRequiredAction',
        message: `${title}: ${message}`,
      });

      return requiredAction;
    },
  });
}
