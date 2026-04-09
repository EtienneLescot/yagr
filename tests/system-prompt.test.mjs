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

    assert.match(prompt, /You are Yagr, a local autonomous coding agent\./);
    assert.match(prompt, /senior software engineer and pragmatic technical architect/i);
    assert.match(prompt, /smallest coherent change that fixes the root cause/i);
    assert.match(prompt, /Favor first-pass correctness over speed/i);
    assert.match(prompt, /verify them with the most relevant available checks/i);
    assert.match(prompt, /requestRequiredAction tool/i);
    assert.match(prompt, /Keep final user-facing summaries concise/i);
    // domain-specific workflow rules must come from workspace instructions, not Yagr source
    assert.doesNotMatch(prompt, /responsesApiEnabled/i);
    assert.doesNotMatch(prompt, /yagr_proxy_relay_start/i);
    assert.doesNotMatch(prompt, /custom baseURL/i);
    assert.doesNotMatch(prompt, /yagr yagrProxy/i);
    assert.doesNotMatch(prompt, /n8n AI Agent or LangChain workflow/i);
    assert.match(prompt, /Instruction hierarchy for this run:/);
    assert.match(prompt, /Do not assume that workspace instructions are already injected into this system prompt/i);
    assert.doesNotMatch(prompt, /<workspace-instructions>/);
    assert.doesNotMatch(prompt, /remote n8n instance, you MUST run n8nac pull/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('system prompt does not inline workspace AGENTS sections even when they are large', () => {
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

    assert.doesNotMatch(prompt, /Critical Example/);
    assert.doesNotMatch(prompt, /AiAgent\.uses\(\{ ai_languageModel: this\.OpenaiModel\.output \}\)/);
    assert.doesNotMatch(prompt, /ROUTING MAP/);
    assert.doesNotMatch(prompt, /AI CONNECTIONS/);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('system prompt does not inline short workspace AGENTS files either', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-prompt-'));
  const previousCwd = process.cwd();

  try {
    writeWorkspaceInstructions(tempDir, '# Short Rules\nUse exact examples.\n');

    process.chdir(tempDir);
    const prompt = withTempInstructionRoots(tempDir, () => buildSystemPrompt({ name: 'test-engine' }));

    assert.doesNotMatch(prompt, /# Short Rules/);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('workspace AGENTS is no longer injected into the system prompt', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-home-'));
  const previousCwd = process.cwd();

  try {
    writeWorkspaceInstructions(homeDir, '# Workspace Rules\nUse workspace instructions first.\n');
    fs.writeFileSync(path.join(homeDir, 'AGENTS.md'), '# Home Notes\nKeep responses terse.\n', 'utf8');

    process.chdir(homeDir);
    const prompt = withTempInstructionRoots(homeDir, () => buildSystemPrompt({ name: 'test-engine' }));

    assert.match(prompt, /# Home Notes/);
    assert.match(prompt, /Yagr home instructions source:/);
    assert.match(prompt, /<yagr-home-instructions>[\s\S]*# Home Notes[\s\S]*<\/yagr-home-instructions>/);
    assert.doesNotMatch(prompt, /Workspace instructions source:/);
    assert.doesNotMatch(prompt, /# Workspace Rules/);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test('home AGENTS can teach manager CLI behaviors without changing the built-in tool surface', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-home-'));
  const previousCwd = process.cwd();

  try {
    writeWorkspaceInstructions(homeDir, '# Workspace Rules\nUse n8nac CLI commands in the workspace.\n');
    fs.writeFileSync(path.join(homeDir, 'AGENTS.md'), '# Home Notes\nUse yagr presentWorkflowResult and yagr yagrProxy through the shell tool.\n', 'utf8');

    process.chdir(homeDir);
    const prompt = withTempInstructionRoots(homeDir, () => buildSystemPrompt({ name: 'test-engine' }));

    assert.match(prompt, /Use yagr presentWorkflowResult and yagr yagrProxy through the shell tool/i);
    assert.doesNotMatch(prompt, /Use n8nac CLI commands in the workspace/i);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test('home AGENTS can forbid raw n8n REST calls when n8nac workspace access exists', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-home-'));
  const previousCwd = process.cwd();

  try {
    writeWorkspaceInstructions(homeDir, '# Workspace Rules\nUse n8nac CLI commands in the workspace.\n');
    fs.writeFileSync(
      path.join(homeDir, 'AGENTS.md'),
      '# Home Notes\nDo not use raw /rest/workflows HTTP calls when n8nac-config.json already exists.\n',
      'utf8',
    );

    process.chdir(homeDir);
    const prompt = withTempInstructionRoots(homeDir, () => buildSystemPrompt({ name: 'test-engine' }));

    assert.match(prompt, /Do not use raw \/rest\/workflows HTTP calls when n8nac-config\.json already exists/i);
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
    assert.doesNotMatch(prompt, /Workspace instructions source:[\s\S]*# Home Notes/);
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

    assert.deepEqual(Object.keys(firstSnapshot).sort(), ['homeInstructions', 'systemPrompt']);
    assert.deepEqual(Object.keys(secondSnapshot).sort(), ['homeInstructions', 'systemPrompt']);
    assert.doesNotMatch(secondSnapshot.systemPrompt, /Use the second routing pattern/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('system prompt states that manager home policy overrides workspace rules for manager behavior', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-home-'));
  const previousCwd = process.cwd();

  try {
    writeWorkspaceInstructions(homeDir, '# Workspace Rules\nUse generic credential selection.\n');
    fs.writeFileSync(path.join(homeDir, 'AGENTS.md'), '# Home Notes\nUse manager-owned commands for manager behavior.\n', 'utf8');

    process.chdir(homeDir);
    const prompt = withTempInstructionRoots(homeDir, () => buildSystemPrompt({ name: 'test-engine' }));

    assert.match(prompt, /When home instructions send you to a managed workspace such as n8n-workspace/i);
    assert.match(prompt, /Do not assume that workspace instructions are already injected into this system prompt/i);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});