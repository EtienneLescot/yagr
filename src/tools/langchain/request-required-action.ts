/**
 * LangChain version of the requestRequiredAction tool.
 *
 * Returns a JSON-serialised `YagrRequiredAction` object.  The gateway event
 * adapter (`langgraph-events.ts`) detects `on_tool_end` for this tool and
 * collects the results to populate the final `requiredActions` array.
 */
import { randomUUID } from 'node:crypto';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { YagrRequiredAction } from '../../types.js';

export const requestRequiredActionTool = tool(
  async ({ kind, title, message, detail, resumable, blocking }): Promise<string> => {
    const requiredAction: YagrRequiredAction = {
      id: randomUUID(),
      kind,
      title,
      message,
      detail: detail ?? undefined,
      resumable: resumable ?? true,
      blocking: blocking ?? true,
    };
    return JSON.stringify(requiredAction);
  },
  {
    name: 'requestRequiredAction',
    description:
      'Raise a structured required action when progress is blocked on missing user input or an external dependency (credentials, API access, remote configuration). ' +
      'Do not use this when you already have a tool that can perform the operation directly. ' +
      'Use blocking=true only when the current task cannot continue or be delivered without that action. ' +
      'Use blocking=false for follow-up setup or next steps that do not prevent delivering the current artifact.',
    schema: z.object({
      kind: z.enum(['input', 'permission', 'external']).describe('Type of blocker that needs user or external action.'),
      title: z.string().min(1).max(120).describe('Short title for the blocker.'),
      message: z.string().min(1).max(500).describe('Short actionable message shown to the user.'),
      detail: z.string().max(1000).optional().describe('Detailed explanation or next step. Omit when there is no extra detail.'),
      resumable: z.boolean().optional().default(true).describe('Whether the run should be considered resumable once the action is satisfied.'),
      blocking: z.boolean().optional().default(true).describe('Whether this action blocks delivery of the current task. Set false for follow-up configuration or next steps that can happen after the current artifact is delivered.'),
    }),
  },
);
