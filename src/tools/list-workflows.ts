import { tool } from 'ai';
import { z } from 'zod';
import type { Engine } from '../engine/engine.js';

export function createListWorkflowsTool(engine: Engine) {
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
