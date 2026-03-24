import { randomUUID } from 'node:crypto';
import { tool } from 'ai';
import { z } from 'zod';
import type { YagrRequiredAction } from '../types.js';
import { emitToolEvent, type ToolExecutionObserver } from './observer.js';

export function createRequestRequiredActionTool(observer?: ToolExecutionObserver) {
  return tool({
    description: 'Raise a structured required action when progress is blocked on user input, permission, or an external dependency. Use blocking=true only when the current task cannot continue or be delivered without that action. Use blocking=false for follow-up setup or next steps that do not prevent delivering the current artifact.',
    parameters: z.object({
      kind: z.enum(['input', 'permission', 'external']).describe('Type of blocker that needs user or external action.'),
      title: z.string().min(1).max(120).describe('Short title for the blocker.'),
      message: z.string().min(1).max(500).describe('Short actionable message shown to the user.'),
      detail: z.string().max(1000).nullable().optional().describe('Detailed explanation or next step. Use null when there is no extra detail.'),
      resumable: z.boolean().optional().default(true).describe('Whether the run should be considered resumable once the action is satisfied.'),
      blocking: z.boolean().optional().default(true).describe('Whether this action blocks delivery of the current task. Set false for follow-up configuration or next steps that can happen after the current artifact is delivered.'),
    }),
    execute: async ({ kind, title, message, detail, resumable, blocking }) => {
      const requiredAction: YagrRequiredAction = {
        id: randomUUID(),
        kind,
        title,
        message,
        detail: detail ?? undefined,
        resumable: resumable ?? true,
        blocking: blocking ?? true,
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
