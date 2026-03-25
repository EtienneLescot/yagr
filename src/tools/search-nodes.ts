import { tool } from 'ai';
import { z } from 'zod';
import type { NodeCatalogPort } from '../engine/engine.js';

export function createSearchNodesTool(engine: NodeCatalogPort) {
  return tool({
    description: 'Search nodes that match a capability or integration need.',
    parameters: z.object({
      query: z.string().min(1).describe('Capability to search for, for example send slack message'),
    }),
    execute: async ({ query }) => {
      const nodes = await engine.searchNodes(query);
      return { nodes };
    },
  });
}
