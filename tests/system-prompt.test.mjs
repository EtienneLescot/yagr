import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildSystemPrompt, buildSystemPromptSnapshot } from '../dist/prompt/build-system-prompt.js';

function withTempInstructionRoots(tempDir, callback) {
  const previousHome = process.env.YAGR_HOME;
  const previousLaunchCwd = process.env.YAGR_LAUNCH_CWD;

  process.env.YAGR_HOME = tempDir;
  process.env.YAGR_LAUNCH_CWD = tempDir;

  try {
    return callback();
  } finally {
    if (previousHome === undefined) {
      delete process.env.YAGR_HOME;
    } else {
      process.env.YAGR_HOME = previousHome;
    }

    if (previousLaunchCwd === undefined) {
      delete process.env.YAGR_LAUNCH_CWD;
    } else {
      process.env.YAGR_LAUNCH_CWD = previousLaunchCwd;
    }
  }
}

function writeWorkspaceInstructions(homeDir, content) {
  const workspaceDir = path.join(homeDir, 'n8n-workspace');
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.writeFileSync(path.join(workspaceDir, 'AGENTS.md'), content, 'utf8');
}

test('system prompt includes generic coding-agent baseline and defers domain rules to workspace instructions', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-prompt-'));

  try {
    writeWorkspaceInstructions(tempDir, '# Workspace Rules\nremote n8n instance, you MUST run n8nac pull\nDo not present remote-only workflows from memory\n');
    const prompt = withTempInstructionRoots(tempDir, () => buildSystemPrompt({ name: 'test-engine' }));

    assert.match(prompt, /You are Yagr, a local coding agent\./);
    assert.match(prompt, /senior software engineer and pragmatic technical architect/i);
    assert.match(prompt, /single mode/i);
    assert.match(prompt, /workspace AGENT\.md or AGENTS\.md content is already loaded into startup context/i);
    assert.match(prompt, /generic coding-agent behavior/i);
    assert.match(prompt, /smallest coherent change that fixes the root cause/i);
    assert.match(prompt, /Favor first-pass correctness over speed/i);
    assert.match(prompt, /interdependent components/i);
    assert.match(prompt, /explicit linkage is present/i);
    assert.match(prompt, /verify them with the most relevant available checks/i);
    assert.match(prompt, /requestRequiredAction tool/i);
    assert.match(prompt, /Keep final user-facing summaries concise/i);
    assert.match(prompt, /Do not paste the full workflow file contents/i);
    assert.match(prompt, /remote n8n instance, you MUST run n8nac pull/i);
    assert.match(prompt, /Do not present remote-only workflows from memory/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('system prompt includes later AGENTS sections beyond the old truncation boundary', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-prompt-'));
  const previousCwd = process.cwd();

  try {
    const filler = 'A'.repeat(12_500);
    writeWorkspaceInstructions(
      tempDir,
      [
        filler,
        '### Critical Example',
        'AiAgent.uses({ ai_languageModel: this.OpenaiModel.output })',
        '',
        '## Connection Rules',
        '// Nodes   : 6  |  Connections: 1',
        '// ROUTING MAP',
        '// Start',
        '//   → Transform',
        '// AI CONNECTIONS',
        '> Key rule: Regular nodes connect with source.out(0).to(target.in(0)).',
      ].join('\n'),
    );

    process.chdir(tempDir);
    const prompt = withTempInstructionRoots(tempDir, () => buildSystemPrompt({ name: 'test-engine' }));

    assert.match(prompt, /Critical Example/);
    assert.match(prompt, /AiAgent\.uses\(\{ ai_languageModel: this\.OpenaiModel\.output \}\)/);
    assert.match(prompt, /ROUTING MAP/);
    assert.match(prompt, /AI CONNECTIONS/);
    assert.match(prompt, /Connections: 1/);
    assert.match(prompt, /source\.out\(0\)\.to\(target\.in\(0\)\)/);
    assert.doesNotMatch(prompt, /workspace instructions compacted for startup/);
    assert.doesNotMatch(prompt, /truncated/);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('system prompt inlines short workspace AGENTS files without extra scaffolding', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-prompt-'));
  const previousCwd = process.cwd();

  try {
    writeWorkspaceInstructions(tempDir, '# Short Rules\nUse exact examples.\n');

    process.chdir(tempDir);
    const prompt = withTempInstructionRoots(tempDir, () => buildSystemPrompt({ name: 'test-engine' }));

    assert.match(prompt, /# Short Rules/);
    assert.doesNotMatch(prompt, /truncated/);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('workspace AGENTS is distinct from Yagr home instructions', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-home-'));
  const previousCwd = process.cwd();

  try {
    writeWorkspaceInstructions(homeDir, '# Workspace Rules\nUse workspace instructions first.\n');
    fs.writeFileSync(path.join(homeDir, 'AGENTS.md'), '# Home Notes\nKeep responses terse.\n', 'utf8');

    process.chdir(homeDir);
    const prompt = withTempInstructionRoots(homeDir, () => buildSystemPrompt({ name: 'test-engine' }));

    assert.match(prompt, /# Workspace Rules/);
    assert.match(prompt, /# Home Notes/);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test('home AGENTS does not replace missing workspace instructions', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-prompt-'));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-home-'));
  const previousCwd = process.cwd();

  try {
    fs.writeFileSync(path.join(homeDir, 'AGENTS.md'), '# Home Notes\nPersonal reminders only.\n', 'utf8');

    process.chdir(tempDir);
    const prompt = withTempInstructionRoots(homeDir, () => buildSystemPrompt({ name: 'test-engine' }));

    assert.match(prompt, /# Home Notes/);
    assert.doesNotMatch(prompt, /Follow these workspace instructions when relevant: # Home Notes/);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test('system prompt snapshot fingerprint changes when workspace instructions change', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-prompt-'));

  try {
    writeWorkspaceInstructions(tempDir, '# Workspace Rules\nUse the first routing pattern.\n');
    const firstSnapshot = withTempInstructionRoots(tempDir, () => buildSystemPromptSnapshot({ name: 'test-engine' }));

    writeWorkspaceInstructions(tempDir, '# Workspace Rules\nUse the second routing pattern.\n');
    const secondSnapshot = withTempInstructionRoots(tempDir, () => buildSystemPromptSnapshot({ name: 'test-engine' }));

    assert.notEqual(firstSnapshot.workspaceInstructions?.fingerprint, secondSnapshot.workspaceInstructions?.fingerprint);
    assert.match(secondSnapshot.systemPrompt, /Use the second routing pattern/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});