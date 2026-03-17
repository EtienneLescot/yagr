import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildSystemPrompt } from '../dist/prompt/build-system-prompt.js';

test('system prompt includes generic coding-agent baseline and defers domain rules to workspace instructions', () => {
  const prompt = buildSystemPrompt({ name: 'test-engine' });

  assert.match(prompt, /You are Holon, a local coding agent\./);
  assert.match(prompt, /senior software engineer and pragmatic technical architect/i);
  assert.match(prompt, /single mode/i);
  assert.match(prompt, /AGENT\.md or AGENTS\.md file from the active Holon workspace root as a foundational instruction file/i);
  assert.match(prompt, /generic coding-agent behavior/i);
  assert.match(prompt, /smallest coherent change that fixes the root cause/i);
  assert.match(prompt, /Favor first-pass correctness over speed/i);
  assert.match(prompt, /interdependent components/i);
  assert.match(prompt, /explicit linkage is present/i);
  assert.match(prompt, /verify them with the most relevant available checks/i);
  assert.match(prompt, /requestRequiredAction tool/i);
});

test('system prompt includes later AGENTS sections beyond the old truncation boundary', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'holon-prompt-'));
  const previousCwd = process.cwd();

  try {
    const filler = 'A'.repeat(12_500);
    fs.writeFileSync(
      path.join(tempDir, 'AGENTS.md'),
      `${filler}\n### Critical Example\nAiAgent.uses({ ai_languageModel: this.OpenaiModel.output })\n`,
      'utf8',
    );

    process.chdir(tempDir);
    const prompt = buildSystemPrompt({ name: 'test-engine' });

    assert.match(prompt, /Critical Example/);
    assert.match(prompt, /AiAgent\.uses\(\{ ai_languageModel: this\.OpenaiModel\.output \}\)/);
    assert.doesNotMatch(prompt, /truncated/);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('system prompt inlines short AGENTS files without extra scaffolding', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'holon-prompt-'));
  const previousCwd = process.cwd();

  try {
    fs.writeFileSync(path.join(tempDir, 'AGENTS.md'), '# Short Rules\nUse exact examples.\n', 'utf8');

    process.chdir(tempDir);
    const prompt = buildSystemPrompt({ name: 'test-engine' });

    assert.match(prompt, /# Short Rules/);
    assert.doesNotMatch(prompt, /truncated/);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});