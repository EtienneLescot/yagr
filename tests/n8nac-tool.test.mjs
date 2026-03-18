import assert from 'node:assert/strict';
import test from 'node:test';

import { createN8nAcTool } from '../dist/tools/n8nac.js';

test('n8nac tool schema accepts legacy skills action aliases', () => {
  const tool = createN8nAcTool();

  const withSkillsArgs = tool.parameters.safeParse({
    action: 'skillsArgs',
    skillsArgs: 'examples search "creative fun unusual"',
  });
  const withSkillsArgv = tool.parameters.safeParse({
    action: 'skillsArgv',
    skillsArgv: ['examples', 'search', 'creative fun unusual'],
  });

  assert.equal(withSkillsArgs.success, true);
  assert.equal(withSkillsArgv.success, true);
});

test('n8nac tool schema still accepts the canonical skills action', () => {
  const tool = createN8nAcTool();

  const parsed = tool.parameters.safeParse({
    action: 'skills',
    skillsArgs: 'search telegram',
  });

  assert.equal(parsed.success, true);
});