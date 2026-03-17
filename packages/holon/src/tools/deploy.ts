import { tool } from 'ai';
import { z } from 'zod';
import type { Engine } from '../engine/engine.js';
import type { GeneratedWorkflow } from '../types.js';

export function createDeployWorkflowTool(engine: Engine) {
  return tool({
    description: 'Deploy a validated workflow to the active engine.',
    parameters: z.object({
      workflow: z.object({
        engine: z.enum(['n8n', 'holon-engine']),
        name: z.string(),
        sourceType: z.enum(['n8n-json', 'holon-python']),
        definition: z.unknown(),
        credentialRequirements: z.array(z.object({
          nodeName: z.string(),
          credentialType: z.string(),
          displayName: z.string(),
          required: z.boolean(),
          status: z.enum(['missing', 'linked', 'unknown']),
          helpUrl: z.string().optional(),
        })),
      }),
    }),
    execute: async ({ workflow }) => {
      const deployed = await engine.deploy(workflow as GeneratedWorkflow);
      return { deployed };
    },
  });
}
