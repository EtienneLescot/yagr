import fs from 'node:fs';
import { tool } from 'ai';
import { z } from 'zod';
import type { ToolExecutionObserver } from './observer.js';
import { ensureParentDirectory, fileExists, relativeWorkspacePath, resolveWorkspacePath } from './workspace-utils.js';

export function createWriteWorkspaceFileTool(_observer?: ToolExecutionObserver) {
  return tool({
    description: 'Create or overwrite a workspace file. Use this for new .workflow.ts files or deliberate full-file rewrites.',
    parameters: z.object({
      path: z.string().min(1).describe('Workspace-relative file path.'),
      content: z.string().describe('Full file content to write.'),
      mode: z.enum(['create', 'overwrite', 'append']).default('overwrite').describe('Write mode for the target file.'),
    }),
    execute: async ({ path: inputPath, content, mode }) => {
      const targetPath = resolveWorkspacePath(inputPath);
      const exists = fileExists(targetPath);

      if (mode === 'create' && exists) {
        return {
          ok: false,
          path: relativeWorkspacePath(targetPath),
          error: `File already exists: ${inputPath}`,
        };
      }

      ensureParentDirectory(targetPath);

      if (mode === 'append') {
        fs.appendFileSync(targetPath, content, 'utf-8');
      } else {
        fs.writeFileSync(targetPath, content, 'utf-8');
      }

      return {
        ok: true,
        path: relativeWorkspacePath(targetPath),
        mode,
        bytesWritten: Buffer.byteLength(content, 'utf-8'),
      };
    },
  });
}