import { tool } from 'ai';
import { z } from 'zod';
import type { Engine } from '../engine/engine.js';

const workflowNodeSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  parameters: z.record(z.unknown()),
  typeVersion: z.number().optional(),
  position: z.tuple([z.number(), z.number()]).optional(),
  credentials: z.record(z.object({
    id: z.string().optional(),
    name: z.string().optional(),
  })).optional(),
});

const arrayConnectionsSchema = z.array(z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.string().optional(),
  index: z.number().optional(),
}));

const n8nConnectionsSchema = z.record(
  z.string(),
  z.record(
    z.string(),
    z.array(
      z.array(
        z.object({
          node: z.string().min(1),
          type: z.string().min(1),
          index: z.number().optional(),
        }),
      ),
    ),
  ),
);

const groupedEdgeConnectionsSchema = z.record(
  z.string(),
  z.array(z.object({
    from: z.string().min(1),
    to: z.string().min(1),
    type: z.string().optional(),
    index: z.number().optional(),
  })),
);

export function createGenerateWorkflowTool(engine: Engine) {
  return tool({
    description: 'Generate a workflow definition from a structured specification.',
    parameters: z.object({
      name: z.string().min(1),
      nodes: z.array(workflowNodeSchema).min(1),
      connections: z.union([arrayConnectionsSchema, n8nConnectionsSchema, groupedEdgeConnectionsSchema]),
      active: z.boolean().optional(),
    }),
    execute: async (spec) => {
      const workflow = await engine.generateWorkflow(spec);
      return { workflow };
    },
  });
}
