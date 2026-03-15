import { tool } from 'ai';
import { z } from 'zod';
import type { Engine } from '../engine/engine.js';

export function createManageWorkflowTool(engine: Engine) {
  return tool({
    description: 'Activate, deactivate, or delete an existing workflow.',
    parameters: z.object({
      workflowId: z.string().min(1),
      action: z.enum(['activate', 'deactivate', 'delete']),
    }),
    execute: async ({ workflowId, action }) => {
      switch (action) {
        case 'activate':
          await engine.activateWorkflow(workflowId);
          return { workflowId, action, ok: true };
        case 'deactivate':
          await engine.deactivateWorkflow(workflowId);
          return { workflowId, action, ok: true };
        case 'delete':
          await engine.deleteWorkflow(workflowId);
          return { workflowId, action, ok: true };
      }

      throw new Error(`Unsupported workflow action: ${action}`);
    },
  });
}
