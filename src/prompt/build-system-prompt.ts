import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { getYagrMemoriesDir, getYagrPaths } from '../config/yagr-home.js';
import { MemoryStore } from '../memory/memory-store.js';
import type { EngineIdentityPort } from '../engine/engine.js';

export interface InstructionContentSnapshot {
  path: string;
  content: string;
  fingerprint: string;
}

export interface SystemPromptSnapshot {
  systemPrompt: string;
  homeInstructions?: InstructionContentSnapshot;
}

export function buildSystemPrompt(engine: EngineIdentityPort): string {
  return buildSystemPromptSnapshot(engine).systemPrompt;
}

export function buildSystemPromptSnapshot(engine: EngineIdentityPort): SystemPromptSnapshot {
  const homeInstructions = loadHomeInstructions();
  const recentMemory = loadRecentMemory();

  return {
    systemPrompt: [
      buildBaselineSection(engine),
      buildInstructionHierarchySection(homeInstructions),
      recentMemory ? `Recent session and workspace memory:\n<recent-memory>\n${recentMemory}\n</recent-memory>` : '',
    ].filter(Boolean).join('\n\n'),
    homeInstructions,
  };
}

function buildBaselineSection(engine: EngineIdentityPort): string {
  return [
    'You are Yagr, a local autonomous coding agent.',
    'When the user sends a casual greeting or a short conversational message (e.g. "salut", "bonjour", "hey", "ça va", "ok", "merci"), respond with a short plain-text reply ONLY. Do NOT call any tool. This rule takes absolute priority over any workspace instruction that says to inspect or list things at startup.',
    'Only trigger tool calls when the user makes a clear, actionable request (create, modify, deploy, list, explain, check something).',
    `The active execution engine is ${engine.name}.`,
    'Use relative paths for normal work inside the Yagr home. Treat absolute paths as real host filesystem paths.',
    'Follow home and workspace instructions before applying your own generic exploration strategy.',
  ].join(' ');
}

function buildInstructionHierarchySection(
  homeInstructions?: InstructionContentSnapshot,
): string {
  const sections = [
    'Instruction hierarchy for this run:',
    '1. Follow the baseline Yagr rules in this system prompt.',
    '2. Apply Yagr home instructions as manager-owned policy for the active engine and runtime environment.',
    '3. When home instructions send you to a managed workspace such as n8n-workspace, inspect that workspace and read its local AGENT.md or AGENTS.md yourself before acting there.',
    '4. Do not assume that workspace instructions are already injected into this system prompt. Read them from the filesystem when the task enters that workspace.',
  ];

  if (homeInstructions) {
    sections.push(
      `Yagr home instructions source: ${homeInstructions.path}`,
      '<yagr-home-instructions>',
      homeInstructions.content,
      '</yagr-home-instructions>',
    );
  }

  return sections.join('\n');
}

function fingerprintInstructionContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function readInstructionFile(candidatePath: string): InstructionContentSnapshot | undefined {
  if (!fs.existsSync(candidatePath)) {
    return undefined;
  }

  try {
    const content = fs.readFileSync(candidatePath, 'utf-8').trim();
    if (!content) {
      return undefined;
    }

    return {
      path: candidatePath,
      content,
      fingerprint: fingerprintInstructionContent(content),
    };
  } catch {
    return undefined;
  }
}

function loadHomeInstructions(): InstructionContentSnapshot | undefined {
  const paths = getYagrPaths();
  return readInstructionFile(paths.homeInstructionsPath);
}

/**
 * Loads the last few session memory records and formats them as a compact
 * context block for the system prompt. Returns empty string when no memories
 * exist yet (first run, fresh install).
 */
function loadRecentMemory(): string {
  try {
    return new MemoryStore(getYagrMemoriesDir()).buildContextBlock(6);
  } catch {
    return '';
  }
}
