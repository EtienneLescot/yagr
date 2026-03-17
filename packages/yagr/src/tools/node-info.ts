import { tool } from 'ai';
import { z } from 'zod';
import type { Engine } from '../engine/engine.js';

export function createNodeInfoTool(engine: Engine) {
  return tool({
    description: 'Fetch full schema details for a node type before generating a workflow.',
    parameters: z.object({
      type: z.string().min(1).describe('Exact node type, for example n8n-nodes-base.slack'),
    }),
    execute: async ({ type }) => {
      const schema = await engine.nodeInfo(type);
      return { schema };
    },
  });
}
