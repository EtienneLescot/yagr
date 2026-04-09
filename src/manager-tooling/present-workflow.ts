/**
 * Yagr Manager tooling: presentWorkflowResult
 *
 * This tool is owned by yagr-manager, not yagr-agent.
 * It is registered dynamically when the n8n engine is active.
 */

import fs from 'node:fs';
import path from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import { getYagrLaunchDir, getYagrN8nWorkspaceDir } from '../config/yagr-home.js';
import { normalizeRenderableWorkflowDiagram } from '../gateway/workflow-diagram.js';
import { YagrN8nConfigService } from '../config/n8n-config-service.js';
import { getActiveTunnelState } from '../n8n-local/n8n-tunnel.js';
import type { ToolExecutionObserver } from '../tools/observer.js';
import { emitToolEvent } from '../tools/observer.js';
import { resolveN8nWorkspacePath } from '../tools/n8n-workspace-path-utils.js';

const WORKFLOW_FILE_SUFFIX = '.workflow.ts';
const WORKFLOW_SCAN_SKIP_DIRS = new Set(['.git', 'dist', 'node_modules', 'docs', 'build']);
export const WORKFLOW_EMBED_TYPE = 'workflow-embed';

export interface PresentWorkflowExecutionResult {
  status: 'success' | 'error' | 'waiting';
  executionId?: string;
  summary?: string;
  data?: string;
}

export interface PresentWorkflowCliInput {
  workflowId: string;
  workflowUrl?: string;
  title?: string;
  diagram?: string;
  executionResult?: PresentWorkflowExecutionResult;
}

export interface WorkflowEmbedPayload {
  __type: typeof WORKFLOW_EMBED_TYPE;
  kind: 'workflow';
  workflowId: string;
  url: string;
  targetUrl: string;
  title?: string;
  diagram?: string;
  executionResult?: PresentWorkflowExecutionResult;
}

export function extractWorkflowMapHeader(source: string): string | undefined {
  const start = source.indexOf('<workflow-map>');
  const end = source.indexOf('</workflow-map>');
  if (start === -1 || end === -1 || end < start) {
    return undefined;
  }

  return source.slice(start, end + '</workflow-map>'.length).trim();
}

export function resolveWorkflowDiagramFromFilePath(filePath: string): string | undefined {
  if (!filePath) {
    return undefined;
  }

  const candidatePath = path.isAbsolute(filePath)
    ? filePath
    : resolveN8nWorkspacePath(filePath);

  if (!fs.existsSync(candidatePath)) {
    return undefined;
  }

  try {
    return extractWorkflowMapHeader(fs.readFileSync(candidatePath, 'utf-8'));
  } catch {
    return undefined;
  }
}

function findWorkflowFileById(rootDir: string, workflowId: string): string | undefined {
  if (!rootDir || !fs.existsSync(rootDir)) {
    return undefined;
  }

  const queue = [rootDir];
  while (queue.length > 0) {
    const currentDir = queue.shift();
    if (!currentDir) {
      continue;
    }

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (!WORKFLOW_SCAN_SKIP_DIRS.has(entry.name)) {
          queue.push(fullPath);
        }
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(WORKFLOW_FILE_SUFFIX)) {
        continue;
      }

      try {
        const source = fs.readFileSync(fullPath, 'utf-8');
        if (source.includes(`id: '${workflowId}'`) || source.includes(`id: "${workflowId}"`)) {
          return fullPath;
        }
      } catch {
        continue;
      }
    }
  }

  return undefined;
}

export function resolveLocalWorkflowDiagram(workflowId: string): string | undefined {
  const candidateRoots = Array.from(new Set([getYagrN8nWorkspaceDir(), getYagrLaunchDir()]));

  for (const rootDir of candidateRoots) {
    const workflowFile = findWorkflowFileById(rootDir, workflowId);
    if (!workflowFile) {
      continue;
    }

    try {
      const source = fs.readFileSync(workflowFile, 'utf-8');
      const extracted = extractWorkflowMapHeader(source);
      if (extracted) {
        return extracted;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

/**
 * Resolves the canonical n8n workflow URL from a workflow ID.
 * Uses the configured n8n host and applies the tunnel public URL if active.
 * Falls back to the agent-provided URL if the workflowId looks invalid.
 */
function resolveWorkflowUrl(workflowId: string, agentProvidedUrl?: string): string {
  // If the workflowId looks like a full URL, trust it as fallback
  if (workflowId && /^https?:\/\//.test(workflowId)) {
    return normalizeWorkflowUrl(workflowId);
  }

  try {
    const config = new YagrN8nConfigService().getLocalConfig();
    const host = config.host;
    if (!host) {
      return agentProvidedUrl || `http://localhost:5678/workflow/${workflowId}`;
    }

    const baseUrl = normalizeWorkflowUrl(host);
    const tunnelUrl = getActiveTunnelState()?.publicUrl;

    // Build the workflow URL
    const workflowUrl = `${baseUrl}/workflow/${workflowId}`;

    // If tunnel is active, substitute the origin
    if (tunnelUrl) {
      const tunnelOrigin = normalizeWorkflowUrl(tunnelUrl);
      return workflowUrl.replace(baseUrl, tunnelOrigin);
    }

    return workflowUrl;
  } catch {
    return agentProvidedUrl || `http://localhost:5678/workflow/${workflowId}`;
  }
}

function normalizeWorkflowUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

export function resolveWorkflowDiagram(workflowId: string, fallbackDiagram?: string): string | undefined {
  const localDiagram = resolveLocalWorkflowDiagram(workflowId);
  if (localDiagram) {
    return normalizeRenderableWorkflowDiagram(localDiagram);
  }

  return normalizeRenderableWorkflowDiagram(fallbackDiagram);
}

export async function presentWorkflowResultCli({
  workflowId,
  workflowUrl,
  title,
  diagram,
  executionResult,
}: PresentWorkflowCliInput) {
  const resolvedDiagram = resolveWorkflowDiagram(workflowId, diagram);
  const canonicalUrl = resolveWorkflowUrl(workflowId, workflowUrl);

  return {
    __type: WORKFLOW_EMBED_TYPE,
    kind: 'workflow',
    workflowId,
    url: canonicalUrl,
    targetUrl: canonicalUrl,
    title: title ?? undefined,
    diagram: resolvedDiagram ?? undefined,
    executionResult: executionResult ?? undefined,
    presented: true,
    workflowUrl: canonicalUrl,
  };
}

export function createPresentWorkflowResultTool(observer?: ToolExecutionObserver) {
  return tool({
    description:
      'Present an n8n workflow to the user. ' +
      'You MUST call this tool every time you reference, show, deploy, push, pull, or discuss a specific n8n workflow and you know its ID. ' +
      'If you have just run or tested a workflow, pass the execution result in the executionResult parameter so the user sees real output data — not just a deployment banner. ' +
      'If you do not have the full URL, construct it as {n8nHost}/workflow/{workflowId}. ' +
      'Always include the diagram parameter with the ASCII header from the n8nac TypeScript output so rich surfaces can show the workflow graph at a glance.',
    parameters: z.object({
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
    execute: async ({ workflowId, workflowUrl, title, diagram, executionResult }) => {
      const payload = await presentWorkflowResultCli({ workflowId, workflowUrl, title, diagram, executionResult });
      await emitToolEvent(observer, {
        type: 'embed',
        toolName: 'presentWorkflowResult',
        kind: 'workflow',
        workflowId: payload.workflowId,
        url: payload.url,
        targetUrl: payload.targetUrl,
        title: payload.title ?? undefined,
        diagram: payload.diagram ?? undefined,
        executionResult: payload.executionResult ?? undefined,
      });
      return payload;
    },
  });
}
