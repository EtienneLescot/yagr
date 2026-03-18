import { tool } from 'ai';
import { z } from 'zod';
import type { ToolExecutionObserver } from './observer.js';
import { emitToolEvent } from './observer.js';

export function createPresentWorkflowResultTool(observer?: ToolExecutionObserver) {
  return tool({
    description:
      'Present an n8n workflow to the user as a rich clickable card in the UI. ' +
      'You MUST call this tool every time you reference, show, deploy, push, pull, or discuss a specific n8n workflow and you know its ID. ' +
      'If you do not have the full URL, construct it as {n8nHost}/workflow/{workflowId}. ' +
      'Always include the diagram parameter with the ASCII header from the n8nac TypeScript output so the user sees the workflow graph at a glance.',
    parameters: z.object({
      workflowId: z.string().describe('The n8n workflow ID.'),
      workflowUrl: z.string().describe('The full URL to the workflow in n8n (e.g. http://localhost:5678/workflow/abc123).'),
      title: z.string().optional().describe('Human-readable workflow name for the card.'),
      diagram: z.string().optional().describe('ASCII art diagram of the workflow graph, typically the header block from the n8nac TypeScript output.'),
    }),
    execute: async ({ workflowId, workflowUrl, title, diagram }) => {
      await emitToolEvent(observer, {
        type: 'embed',
        toolName: 'presentWorkflowResult',
        kind: 'workflow',
        workflowId,
        url: workflowUrl,
        title,
        diagram,
      });
      return { presented: true, workflowId };
    },
  });
}
