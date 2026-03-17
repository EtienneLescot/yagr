import { tool } from 'ai';
import { z } from 'zod';
import { emitToolEvent, type ToolExecutionObserver } from './observer.js';

export function createReportProgressTool(observer?: ToolExecutionObserver) {
  return tool({
    description: 'Send a short user-visible progress update. Use this for concise action-oriented status messages before or during substantial work. Do not expose private reasoning.',
    parameters: z.object({
      message: z.string().min(1).max(240).describe('Short user-visible progress update.'),
    }),
    execute: async ({ message }) => {
      await emitToolEvent(observer, {
        type: 'status',
        toolName: 'reportProgress',
        message,
      });

      return { delivered: true, message };
    },
  });
}