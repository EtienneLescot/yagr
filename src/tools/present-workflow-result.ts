import { tool } from 'ai';
import { z } from 'zod';
import { emitToolEvent, type ToolExecutionObserver } from './observer.js';

export function createPresentWorkflowResultTool(observer?: ToolExecutionObserver) {
  return tool({
    description:
      'Surface a deployed n8n workflow as an embeddable live preview in the UI. Call this after successfully deploying or pushing a workflow to n8n so the user sees an interactive frame pointing to the live workflow URL. Pass the workflowId and workflowUrl returned by the deploy step.',
    parameters: z.object({
      workflowId: z.string().min(1).describe('The n8n workflow ID returned by the deploy or push step.'),
      workflowUrl: z.string().url().describe('The full URL of the workflow in the n8n instance (e.g. http://localhost:5678/workflow/abc123).'),
      title: z.string().optional().describe('Optional display title shown above the embedded preview.'),
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

      return { presented: true, workflowId, workflowUrl };
    },
  });
}
