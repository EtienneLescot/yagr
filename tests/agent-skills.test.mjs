import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  getDeepAgentSkillSourcePaths,
  installAgentSkills,
  listAgentSkills,
  removeAgentSkill,
} from '../dist/skills/agent-skills.js';

async function withTempSkillEnv(run) {
  const previousHome = process.env.YAGR_HOME;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-agent-skills-'));
  const homeDir = path.join(tempRoot, 'home');
  const contextRoot = path.join(tempRoot, 'workspace');
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(contextRoot, { recursive: true });
  process.env.YAGR_HOME = homeDir;
  try {
    await run({ tempRoot, homeDir, contextRoot });
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function writeSkill(parentDir, name, description = `Use ${name} when testing Yagr Agent Skills.`) {
  const skillDir = path.join(parentDir, name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`);
  return skillDir;
}

test('installAgentSkills installs a local skill globally', async () => {
  await withTempSkillEnv(async ({ tempRoot }) => {
    const sourceRoot = path.join(tempRoot, 'source');
    writeSkill(sourceRoot, 'demo-skill');

    const installed = await installAgentSkills(sourceRoot);
    assert.equal(installed.length, 1);
    assert.equal(installed[0].name, 'demo-skill');
    assert.equal(installed[0].scope, 'global');
    assert.equal(fs.existsSync(installed[0].path), true);

    const listed = listAgentSkills();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].name, 'demo-skill');
    assert.equal(listed[0].effective, true);
  });
});

test('installAgentSkills rejects a directory without SKILL.md', async () => {
  await withTempSkillEnv(async ({ tempRoot }) => {
    const sourceRoot = path.join(tempRoot, 'empty-source');
    fs.mkdirSync(path.join(sourceRoot, 'not-a-skill'), { recursive: true });

    await assert.rejects(() => installAgentSkills(sourceRoot), /No installable Agent Skills/);
  });
});

test('installAgentSkills rejects a skill name that does not match its directory', async () => {
  await withTempSkillEnv(async ({ tempRoot }) => {
    const skillDir = path.join(tempRoot, 'source', 'folder-name');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: other-name\ndescription: Invalid name mismatch.\n---\n');

    await assert.rejects(() => installAgentSkills(path.dirname(skillDir)), /must match directory name/);
  });
});

test('workspace skills override global skills in listing and Deep Agents source order', async () => {
  await withTempSkillEnv(async ({ tempRoot, contextRoot }) => {
    const globalSource = path.join(tempRoot, 'global-source');
    const workspaceSource = path.join(tempRoot, 'workspace-source');
    writeSkill(globalSource, 'shared-skill', 'Global version.');
    writeSkill(workspaceSource, 'shared-skill', 'Workspace version.');

    await installAgentSkills(globalSource);
    await installAgentSkills(workspaceSource, { scope: 'workspace', contextRoot });

    const listed = listAgentSkills({ contextRoot });
    assert.equal(listed.length, 2);
    assert.equal(listed.find((skill) => skill.scope === 'global')?.effective, false);
    assert.equal(listed.find((skill) => skill.scope === 'workspace')?.effective, true);

    const sources = getDeepAgentSkillSourcePaths({ contextRoot });
    assert.equal(sources.length, 2);
    assert.ok(sources[0].endsWith('/skills'), 'global source first');
    assert.ok(sources[1].endsWith('/.agents/skills'), 'workspace source last');
  });
});

test('removeAgentSkill removes only the requested scope', async () => {
  await withTempSkillEnv(async ({ tempRoot, contextRoot }) => {
    const source = path.join(tempRoot, 'source');
    writeSkill(source, 'remove-skill');
    await installAgentSkills(source);
    await installAgentSkills(source, { scope: 'workspace', contextRoot });

    const result = await removeAgentSkill('remove-skill', { scope: 'workspace', contextRoot });
    assert.equal(result.removed, true);

    const listed = listAgentSkills({ contextRoot });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].scope, 'global');
  });
});
