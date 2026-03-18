import { tool } from 'ai';
import { z } from 'zod';
import type { ToolExecutionObserver } from './observer.js';
import { emitToolEvent } from './observer.js';

export function createPresentWorkflowResultTool(observer?: ToolExecutionObserver) {
  return tool({
    description:
      'Present an n8n workflow to the user as a rich clickable card in the UI. ' +
      'You MUST call this tool every time you reference, show, deploy, push, pull, or discuss a specific n8n workflow and you know its ID. ' +
      'If you do not have the full URL, construct it as {n8nHost}/workflow/{workflowId}.',
    parameters: z.object({
      workflowId: z.string().describe('The n8n workflow ID.'),
      workflowUrl: z.string().describe('The full URL to the workflow in n8n (e.g. http://localhost:5678/workflow/abc123).'),
      title: z.string().optional().describe('Human-readable workflow name for the card.'),
    }),
    execute: async ({ workflowId, workflowUrl, title }) => {
      await emitToolEvent(observer, {
        type: 'embed',
        toolName: 'presentWorkflowResult',
        kind: 'workflow',
        workflowId,
        url: workflowUrl,
        title,
      });
      return { presented: true, workflowId };
    },
  });
}
