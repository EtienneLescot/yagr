import { tool } from 'ai';
import { z } from 'zod';
import type { TemplateCatalogPort } from '../engine/engine.js';

export function createSearchTemplatesTool(engine: TemplateCatalogPort) {
  return tool({
    description: 'Search n8n documentation pages and concept guides for technical background on nodes, integrations, and patterns. Returns documentation links, not workflow code files. To find real workflow examples with node configurations, use the n8nac tool with action="skills" and skillsArgv=["examples","search","..."].',
    parameters: z.object({
      query: z.string().min(1).describe('Automation idea or integration scenario to search for'),
    }),
    execute: async ({ query }) => {
      const templates = await engine.searchTemplates(query);
      return { templates };
    },
  });
}
