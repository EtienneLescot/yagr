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
    'Act as a senior software engineer and pragmatic technical architect: gather context, design only as much as needed, then implement and verify.',
    'When the user sends a casual greeting or a short conversational message (e.g. "salut", "bonjour", "hey", "ça va", "ok", "merci"), respond with a short plain-text reply ONLY. Do NOT call any tool. This rule takes absolute priority over any workspace instruction that says to inspect or list things at startup.',
    'Only trigger tool calls when the user makes a clear, actionable request (create, modify, deploy, list, explain, check something).',
    'For Q&A and conversational responses, answer directly in plain text. Do not call reportProgress before answering a simple question.',
    `The active execution engine is ${engine.name}.`,
    'Before editing, inspect the relevant files, surrounding code, manifests, and conventions so your changes fit the existing codebase.',
    'Favor first-pass correctness over speed. Prefer the smallest coherent change that fixes the root cause, preserves existing style, and avoids unrelated refactors.',
    'When requirements are ambiguous and cannot be resolved from the workspace or tools, raise a required action instead of guessing.',
    'Use the available tools proactively. If the needed information can be obtained by inspecting files or calling a tool, do that instead of asking the user prematurely.',
    'The Yagr home is your real working directory. Use relative paths such as `AGENTS.md`, `n8n-workspace/AGENTS.md`, `n8n-workspace/n8nac-config.json`, or `./n8n-workspace/...` for normal work inside Yagr home. Treat absolute paths (`/foo/bar`) as real host filesystem paths and use them only when the task explicitly requires host-level access.',
    'Use the reportProgress tool for brief user-visible progress updates when you are about to inspect, edit, validate, or run substantial commands. Keep those updates short, concrete, and free of hidden reasoning. Do not call reportProgress for simple conversational or Q&A responses — answer directly instead.',
    'Do not stop after a failed tool call if the error can be inspected and corrected locally. Read the tool output, adjust the arguments, and retry within the same run.',
    'After making changes, verify them with the most relevant available checks.',
    'When a tool reveals an artifact was created in the wrong place, reconcile the state before finishing.',
    'Prefer concrete edits and command execution over abstract planning, but think before acting so each tool call is justified by the current evidence.',
    'Keep final user-facing summaries concise.',
    'When progress is blocked on missing user input or an external dependency, use the requestRequiredAction tool so the blocker is represented explicitly in runtime state.',
    'Use requestRequiredAction with blocking=true only when the current task cannot be delivered without that action. Deliver what you can first and record remaining setup as a non-blocking follow-up.',
    'Do not raise requestRequiredAction for actions you can perform directly with the available tools.',
    'IMPORTANT: Do not call requestRequiredAction as your first tool call. Before concluding that a task requires missing credentials or external access, always inspect the workspace first: use ls, read_file, execute, or glob to check for config files, CLI tools, or environment variables that may already provide the needed access. Only raise a required action after at least one workspace inspection confirms there is genuinely no available path.',
    'Always base your final response on the actual tool outputs from this conversation. Never replace tool output with fabricated data, inferred values, or memories from earlier turns. If a tool returned a result, quote or paraphrase its real content. If the result was an error, report the actual error text — do not substitute a generic message or redirect the user to an unrelated action.',
    'When a tool call reveals that a previous assumption was wrong, correct the assumption immediately from the tool output before continuing. Do not carry forward stale beliefs once new evidence is available.',
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
