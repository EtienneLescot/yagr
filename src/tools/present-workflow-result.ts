import fs from 'node:fs';
import path from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import { getYagrLaunchDir, getYagrN8nWorkspaceDir } from '../config/yagr-home.js';
import { resolveWorkflowOpenLink } from '../gateway/workflow-links.js';
import type { ToolExecutionObserver } from './observer.js';
import { emitToolEvent } from './observer.js';

const WORKFLOW_FILE_SUFFIX = '.workflow.ts';
const WORKFLOW_SCAN_SKIP_DIRS = new Set(['.git', 'dist', 'node_modules', 'docs', 'build']);

export function extractWorkflowMapHeader(source: string): string | undefined {
  const start = source.indexOf('<workflow-map>');
  const end = source.indexOf('</workflow-map>');
  if (start === -1 || end === -1 || end < start) {
    return undefined;
  }

  return source.slice(start, end + '</workflow-map>'.length).trim();
}

export function resolveWorkflowDiagramFromFilePath(filePath: string): string | undefined {
  if (!filePath || !fs.existsSync(filePath)) {
    return undefined;
  }

  try {
    return extractWorkflowMapHeader(fs.readFileSync(filePath, 'utf-8'));
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

export function resolveWorkflowDiagram(workflowId: string, fallbackDiagram?: string): string | undefined {
  const localDiagram = resolveLocalWorkflowDiagram(workflowId);
  if (localDiagram) {
    return localDiagram;
  }

  return fallbackDiagram;
}

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
      const resolvedDiagram = resolveWorkflowDiagram(workflowId, diagram);
      const workflowLink = resolveWorkflowOpenLink(workflowUrl);
      await emitToolEvent(observer, {
        type: 'embed',
        toolName: 'presentWorkflowResult',
        kind: 'workflow',
        workflowId,
        url: workflowLink.openUrl,
        targetUrl: workflowLink.targetUrl,
        title,
        diagram: resolvedDiagram,
      });
      return {
        presented: true,
        workflowId,
        workflowUrl: workflowLink.openUrl,
        targetWorkflowUrl: workflowLink.targetUrl,
        title: title ?? null,
      };
    },
  });
}
