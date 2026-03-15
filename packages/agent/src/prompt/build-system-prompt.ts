import fs from 'node:fs';
import path from 'node:path';
import type { Engine } from '../engine/engine.js';

export function buildSystemPrompt(engine: Engine): string {
  const workspaceInstructions = loadWorkspaceInstructions();

  return [
    'You are Holon, a local coding agent specialized in n8n-as-code workflow engineering.',
    `The active execution engine is ${engine.name}.`,
    'Follow workspace instructions from AGENT.md or AGENTS.md as the primary source of truth whenever they are present.',
    'Do not generate workflow JSON for the user or rely on JSON workflow specs as your main working format.',
    'Your default implementation format is local TypeScript workflow files such as *.workflow.ts.',
    'Use the n8nac tool to initialize the workspace, inspect node schemas, list and pull workflows, validate files, push changes, and verify live workflows.',
    'Use the workspace file tools to inspect, create, and edit local files directly inside the active workspace.',
    'Use the reportProgress tool for brief user-visible progress updates when you are about to inspect, edit, validate, or run substantial commands. Keep those updates short, concrete, and free of hidden reasoning.',
    'Search for real nodes and examples before writing node parameters, and treat n8nac schema output as authoritative.',
    'If initialization or credentials are missing, ask only for the missing values, then perform the required n8nac steps yourself.',
    'Prefer concrete edits and command execution over abstract planning.',
    workspaceInstructions,
  ].join(' ');
}

function loadWorkspaceInstructions(): string {
  const candidatePaths = [
    path.join(process.cwd(), 'AGENTS.md'),
    path.join(process.cwd(), 'AGENT.md'),
  ];

  for (const candidatePath of candidatePaths) {
    if (!fs.existsSync(candidatePath)) {
      continue;
    }

    try {
      const content = fs.readFileSync(candidatePath, 'utf-8').trim();
      if (!content) {
        continue;
      }

      const truncated = content.slice(0, 12000);
      return `Follow these workspace instructions when relevant: ${truncated}`;
    } catch {
      continue;
    }
  }

  return '';
}
