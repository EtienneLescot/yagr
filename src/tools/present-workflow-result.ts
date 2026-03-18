import { tool } from 'ai';
import { z } from 'zod';
import type { ToolExecutionObserver } from './observer.js';
import { emitToolEvent } from './observer.js';

export function createPresentWorkflowResultTool(observer?: ToolExecutionObserver) {
  return tool({
    description:
      'Present a deployed n8n workflow to the user as a rich visual card in the UI. ' +
      'Call this tool every time a workflow has been successfully deployed or pushed to n8n.',
    parameters: z.object({
      workflowId: z.string().describe('The n8n workflow ID returned by the deploy or push step.'),
      workflowUrl: z.string().url().describe('The full URL to the workflow in the n8n editor.'),
      title: z.string().optional().describe('Optional human-readable title for the card.'),
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
