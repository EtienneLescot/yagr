import { tool } from 'ai';
import { z } from 'zod';
import type { WorkflowLifecyclePort } from '../engine/engine.js';

export function createListWorkflowsTool(engine: WorkflowLifecyclePort) {
  return tool({
    description: 'List workflows deployed in the active engine instance.',
    parameters: z.object({
      includeInactive: z.boolean().optional().default(true),
    }),
    execute: async ({ includeInactive }) => {
      const workflows = await engine.listWorkflows();
      return {
        workflows: includeInactive ? workflows : workflows.filter((workflow) => workflow.active),
      };
    },
  });
}
