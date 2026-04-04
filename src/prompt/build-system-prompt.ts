import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getYagrLaunchDir, getYagrMemoriesDir, getYagrPaths } from '../config/yagr-home.js';
import { resolveWorkflowDir, YagrN8nConfigService } from '../config/n8n-config-service.js';
import { getActiveTunnelState } from '../n8n-local/n8n-tunnel.js';
import { MemoryStore } from '../memory/memory-store.js';
import type { EngineIdentityPort } from '../engine/engine.js';
import { MANAGER_INSTRUCTIONS } from './manager-instructions.js';

export interface InstructionContentSnapshot {
  path: string;
  content: string;
  fingerprint: string;
}

export interface SystemPromptSnapshot {
  systemPrompt: string;
  homeInstructions?: InstructionContentSnapshot;
  workspaceInstructions?: InstructionContentSnapshot;
}

export function buildSystemPrompt(engine: EngineIdentityPort): string {
  return buildSystemPromptSnapshot(engine).systemPrompt;
}

export function buildSystemPromptSnapshot(engine: EngineIdentityPort): SystemPromptSnapshot {
  const homeInstructions = loadHomeInstructions();
  const workspaceInstructions = loadWorkspaceInstructions();
  const yagentsInstructions = loadYagentsInstructions();
  const workflowDir = resolveActiveWorkflowDir();
  const n8nHost = resolveActiveN8nHost();
  const n8nTunnelPublicUrl = resolveActiveTunnelPublicUrl();

  return {
    systemPrompt: [
      'You are Yagr, a local autonomous coding agent.',
      'Act as a senior software engineer and pragmatic technical architect: gather context, design only as much as needed, then implement and verify.',
      'When the user sends a casual greeting or a short conversational message (e.g. "salut", "bonjour", "hey", "ça va", "ok", "merci"), respond with a short plain-text reply ONLY. Do NOT call any tool — not reportProgress, not n8nac, not any other tool. This rule takes absolute priority over any workspace instruction that says to inspect or list workflows at startup.',
      'Only trigger tool calls when the user makes a clear, actionable request (create, modify, deploy, list, explain, check something).',
      'For Q&A and conversational responses, answer directly in plain text. Do not call reportProgress before answering a simple question.',

      `The active execution engine is ${engine.name}.`,
      // --- General agentic behaviour ---
      'Before editing, inspect the relevant files, surrounding code, manifests, and conventions so your changes fit the existing codebase.',
      'Favor first-pass correctness over speed. Prefer the smallest coherent change that fixes the root cause, preserves existing style, and avoids unrelated refactors.',
      'When requirements are ambiguous and cannot be resolved from the workspace or tools, raise a required action instead of guessing.',
      'Use the available tools proactively. If the needed information can be obtained by inspecting files or calling a tool, do that instead of asking the user prematurely.',
      'Use the reportProgress tool for brief user-visible progress updates when you are about to inspect, edit, validate, or run substantial commands. Keep those updates short, concrete, and free of hidden reasoning. Do not call reportProgress for simple conversational or Q&A responses — answer directly instead.',
      'Do not stop after a failed tool call if the error can be inspected and corrected locally. Read the tool output, adjust the arguments, and retry within the same run.',
      'After making changes, verify them with the most relevant available checks.',
      'When a tool reveals an artifact was created in the wrong place, reconcile the state before finishing.',
      'Prefer concrete edits and command execution over abstract planning, but think before acting so each tool call is justified by the current evidence.',
      'Keep final user-facing summaries concise.',
      // --- Required actions ---
      'When progress is blocked on missing user input or an external dependency, use the requestRequiredAction tool so the blocker is represented explicitly in runtime state.',
      'Use requestRequiredAction with blocking=true only when the current task cannot be delivered without that action. Deliver what you can first and record remaining setup as a non-blocking follow-up.',
      'Do not raise requestRequiredAction for actions you can perform directly with the available tools.',
      // --- n8n operations must go through n8nac ---
      'Every n8n operation (activate, deactivate, push, test, list, credential management, etc.) MUST be executed by calling the n8nac tool. Never claim an n8n action was performed without a corresponding n8nac tool call. A plain-text statement that a workflow was activated, deployed, or tested is never acceptable — always execute it.',
      // --- Ground responses in actual tool outputs ---
      'Always base your final response on the actual tool outputs from this conversation. Never replace tool output with fabricated data, inferred values, or memories from earlier turns. If a tool returned a result, quote or paraphrase its real content. If the result was an error, report the actual error text — do not substitute a generic message or redirect the user to an unrelated action.',
      'When a tool call reveals that a previous assumption was wrong, correct the assumption immediately from the tool output before continuing. Do not carry forward stale beliefs once new evidence is available.',
      // --- Yagr manager instructions (proxy, LLM credentials, n8n node wiring) ---
      MANAGER_INSTRUCTIONS,
      // --- Yagr manager tooling instructions (presentWorkflowResult, yagrProxy) ---
      yagentsInstructions ? `Yagr manager tooling instructions: ${yagentsInstructions.content}` : '',
      // --- Workspace instructions (n8nac AGENT.md and home memory) ---
      'The active workspace AGENT.md or AGENTS.md content is already loaded into startup context. Treat it as a foundational instruction source for automation and workflow work. Do not reinvent rules it already defines.',
      workflowDir ? `The active n8n workflow directory is ${workflowDir}.` : '',
      n8nHost ? `The active n8n instance URL is ${n8nHost}.` : '',
      n8nTunnelPublicUrl ? `The n8n instance is publicly reachable via Cloudflare Tunnel at ${n8nTunnelPublicUrl}. Use this URL for webhooks and externally-triggered workflows (e.g. Telegram, email, third-party services).` : '',
      homeInstructions ? `Yagr home instructions and memory: ${homeInstructions.content}` : '',
      workspaceInstructions ? `Follow these workspace instructions when relevant: ${workspaceInstructions.content}` : '',
      loadRecentMemory(),
    ].filter(Boolean).join(' '),
    homeInstructions,
    workspaceInstructions,
  };
}

function fingerprintInstructionContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function resolveActiveWorkflowDir(): string | undefined {
  try {
    const config = new YagrN8nConfigService().getLocalConfig();
    return resolveWorkflowDir(config) ?? undefined;
  } catch {
    return undefined;
  }
}

function resolveActiveN8nHost(): string | undefined {
  try {
    return new YagrN8nConfigService().getLocalConfig().host ?? undefined;
  } catch {
    return undefined;
  }
}

function resolveActiveTunnelPublicUrl(): string | undefined {
  try {
    return getActiveTunnelState()?.publicUrl;
  } catch {
    return undefined;
  }
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

function loadYagentsInstructions(): InstructionContentSnapshot | undefined {
  try {
    const yagentsPath = path.resolve(getYagrLaunchDir(), 'node_modules', '@yagr', 'manager-tooling', 'YAGENTS.md');
    if (fs.existsSync(yagentsPath)) {
      return readInstructionFile(yagentsPath);
    }
    // Fallback: read from source tree during development
    const devPath = path.resolve(getYagrLaunchDir(), 'src', 'manager-tooling', 'YAGENTS.md');
    if (fs.existsSync(devPath)) {
      return readInstructionFile(devPath);
    }
  } catch {
    // ignore
  }
  return undefined;
}

function loadWorkspaceInstructions(): InstructionContentSnapshot | undefined {
  const paths = getYagrPaths();
  const candidatePaths = Array.from(new Set([
    paths.workspaceInstructionsPath,
    path.join(process.cwd(), 'AGENTS.md'),
    path.join(process.cwd(), 'AGENT.md'),
    path.join(getYagrLaunchDir(), 'AGENTS.md'),
    path.join(getYagrLaunchDir(), 'AGENT.md'),
  ]));

  for (const candidatePath of candidatePaths) {
    if (candidatePath === paths.homeInstructionsPath) {
      continue;
    }

    const snapshot = readInstructionFile(candidatePath);
    if (snapshot) {
      return snapshot;
    }
  }

  return undefined;
}
