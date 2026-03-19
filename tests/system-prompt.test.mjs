import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildSystemPrompt } from '../dist/prompt/build-system-prompt.js';

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

function writeMandatorySkill(homeDir, content) {
  const skillDir = path.join(homeDir, 'n8n-architect');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content, 'utf8');
}

test('system prompt includes generic coding-agent baseline and defers domain rules to workspace instructions', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-prompt-'));

  try {
    writeMandatorySkill(tempDir, '# Mandatory Skill\nremote n8n instance, you MUST run n8nac pull\nDo not present remote-only workflows from memory\n');
    const prompt = withTempInstructionRoots(tempDir, () => buildSystemPrompt({ name: 'test-engine' }));

    assert.match(prompt, /You are Yagr, a local coding agent\./);
    assert.match(prompt, /senior software engineer and pragmatic technical architect/i);
    assert.match(prompt, /single mode/i);
    assert.match(prompt, /AGENT\.md or AGENTS\.md file from the active Yagr workspace root as a foundational instruction file/i);
    assert.match(prompt, /generic coding-agent behavior/i);
    assert.match(prompt, /smallest coherent change that fixes the root cause/i);
    assert.match(prompt, /Favor first-pass correctness over speed/i);
    assert.match(prompt, /interdependent components/i);
    assert.match(prompt, /explicit linkage is present/i);
    assert.match(prompt, /verify them with the most relevant available checks/i);
    assert.match(prompt, /requestRequiredAction tool/i);
    assert.match(prompt, /Keep final user-facing summaries concise/i);
    assert.match(prompt, /Do not paste the full workflow file contents/i);
    assert.match(prompt, /Mandatory n8n\/n8nac operating instructions:/);
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
    writeMandatorySkill(tempDir, '# Mandatory Skill\nUse the n8n skill layer.\n');
    const filler = 'A'.repeat(12_500);
    fs.writeFileSync(
      path.join(tempDir, 'AGENTS.md'),
      `${filler}\n### Critical Example\nAiAgent.uses({ ai_languageModel: this.OpenaiModel.output })\n`,
      'utf8',
    );

    process.chdir(tempDir);
    const prompt = withTempInstructionRoots(tempDir, () => buildSystemPrompt({ name: 'test-engine' }));

    assert.match(prompt, /Critical Example/);
    assert.match(prompt, /AiAgent\.uses\(\{ ai_languageModel: this\.OpenaiModel\.output \}\)/);
    assert.doesNotMatch(prompt, /truncated/);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('system prompt inlines short AGENTS files without extra scaffolding', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-prompt-'));
  const previousCwd = process.cwd();

  try {
    writeMandatorySkill(tempDir, '# Mandatory Skill\nUse the n8n skill layer.\n');
    fs.writeFileSync(path.join(tempDir, 'AGENTS.md'), '# Short Rules\nUse exact examples.\n', 'utf8');

    process.chdir(tempDir);
    const prompt = withTempInstructionRoots(tempDir, () => buildSystemPrompt({ name: 'test-engine' }));

    assert.match(prompt, /# Short Rules/);
    assert.doesNotMatch(prompt, /truncated/);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('workspace AGENTS is distinct from the mandatory Yagr home n8n skill', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-prompt-'));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-home-'));
  const previousCwd = process.cwd();

  try {
    fs.writeFileSync(path.join(tempDir, 'AGENTS.md'), '# Workspace Rules\nUse workspace instructions first.\n', 'utf8');
    writeMandatorySkill(homeDir, '# Home Skill\nMandatory n8n operating layer.\n');

    process.chdir(tempDir);
    const prompt = withTempInstructionRoots(homeDir, () => buildSystemPrompt({ name: 'test-engine' }));

    assert.match(prompt, /# Workspace Rules/);
    assert.match(prompt, /# Home Skill/);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});