/**
 * LangChain version of the presentWorkflowResult tool.
 *
 * Instead of emitting an observer event, it returns a JSON object containing
 * a `__type: "workflow_embed"` marker.  The gateway event adapter
 * (`langgraph-events.ts`) detects this in the `on_tool_end` event and
 * translates it into a WebUI `embed` SSE frame or a Telegram workflow banner.
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  resolveWorkflowDiagram,
  resolveWorkflowDiagramFromFilePath,
} from '../present-workflow.js';
import { YagrN8nConfigService } from '../../config/n8n-config-service.js';
import { getActiveTunnelState } from '../../n8n-local/n8n-tunnel.js';

export const WORKFLOW_EMBED_TYPE = 'workflow_embed' as const;

export interface WorkflowEmbedPayload {
  __type: typeof WORKFLOW_EMBED_TYPE;
  kind: 'workflow';
  workflowId: string;
  url: string;
  targetUrl: string;
  title?: string;
  diagram?: string;
  executionResult?: {
    status: 'success' | 'error' | 'waiting';
    executionId?: string;
    summary?: string;
    data?: string;
  };
}

function resolveWorkflowUrl(workflowId: string, agentProvidedUrl?: string): string {
  if (workflowId && /^https?:\/\//.test(workflowId)) {
    return workflowId.replace(/\/+$/, '');
  }

  try {
    const config = new YagrN8nConfigService().getLocalConfig();
    const host = config.host;
    if (!host) {
      return agentProvidedUrl ?? `http://localhost:5678/workflow/${workflowId}`;
    }

    const base = host.replace(/\/+$/, '');
    const workflowUrl = `${base}/workflow/${workflowId}`;
    const tunnelUrl = getActiveTunnelState()?.publicUrl;

    if (tunnelUrl) {
      return workflowUrl.replace(base, tunnelUrl.replace(/\/+$/, ''));
    }

    return workflowUrl;
  } catch {
    return agentProvidedUrl ?? `http://localhost:5678/workflow/${workflowId}`;
  }
}

export const presentWorkflowResultTool = tool(
  async ({ workflowId, workflowUrl, title, diagram, executionResult }): Promise<string> => {
    const resolvedDiagram = resolveWorkflowDiagram(workflowId, diagram);
    const canonicalUrl = resolveWorkflowUrl(workflowId, workflowUrl);

    const payload: WorkflowEmbedPayload = {
      __type: WORKFLOW_EMBED_TYPE,
      kind: 'workflow',
      workflowId,
      url: canonicalUrl,
      targetUrl: canonicalUrl,
      title,
      diagram: resolvedDiagram,
      executionResult,
    };

    return JSON.stringify(payload);
  },
  {
    name: 'presentWorkflowResult',
    description:
      'Present an n8n workflow to the user. ' +
      'You MUST call this tool every time you reference, show, deploy, push, pull, or discuss a specific n8n workflow and you know its ID. ' +
      'If you have just run or tested a workflow, pass the execution result in the executionResult parameter so the user sees real output data — not just a deployment banner. ' +
      'If you do not have the full URL, construct it as {n8nHost}/workflow/{workflowId}. ' +
      'Always include the diagram parameter with the ASCII header from the n8nac TypeScript output so rich surfaces can show the workflow graph at a glance.',
    schema: z.object({
      workflowId: z.string().describe('The n8n workflow ID.'),
      workflowUrl: z.string().describe('The full URL to the workflow in n8n (e.g. http://localhost:5678/workflow/abc123).'),
      title: z.string().optional().describe('Human-readable workflow name for the banner.'),
      diagram: z.string().optional().describe('ASCII art diagram of the workflow graph, typically the header block from the n8nac TypeScript output.'),
      executionResult: z.object({
        status: z.enum(['success', 'error', 'waiting']).describe('Final execution status.'),
        executionId: z.string().optional().describe('The n8n execution ID.'),
        summary: z.string().optional().describe('One-sentence plain-text summary of what the execution produced.'),
        data: z.string().optional().describe('Key output data from the execution — paste the relevant node output JSON or text here verbatim from the tool result.'),
      }).optional().describe('Include this whenever you have run or tested a workflow and received execution output. Pass the actual data from the tool result, do not summarize from memory.'),
    }),
  },
);

export { resolveWorkflowDiagramFromFilePath };
