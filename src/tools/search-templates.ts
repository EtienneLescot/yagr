import { tool } from 'ai';
import { z } from 'zod';
import type { TemplateCatalogPort } from '../engine/engine.js';

export function createSearchTemplatesTool(engine: TemplateCatalogPort) {
  return tool({
    description: 'Search reference templates, examples, and documentation relevant to a workflow idea.',
    parameters: z.object({
      query: z.string().min(1).describe('Automation idea or integration scenario to search for'),
    }),
    execute: async ({ query }) => {
      const templates = await engine.searchTemplates(query);
      return { templates };
    },
  });
}
