import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const CLI_PATH = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'dist', 'cli.js');

function runCli(args, env) {
  return execFileSync(process.execPath, [CLI_PATH, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('skills CLI installs, lists, prints paths, and removes a local skill', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-skills-cli-'));
  const homeDir = path.join(tempRoot, 'home');
  const workspaceDir = path.join(tempRoot, 'workspace');
  const sourceDir = path.join(tempRoot, 'source', 'cli-skill');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.writeFileSync(
    path.join(sourceDir, 'SKILL.md'),
    '---\nname: cli-skill\ndescription: Use when testing the Yagr skills CLI.\n---\n\n# CLI Skill\n',
  );

  const env = {
    YAGR_HOME: homeDir,
    YAGR_LAUNCH_CWD: workspaceDir,
  };

  try {
    const installed = JSON.parse(runCli(['skills', 'install', sourceDir], env));
    assert.equal(installed[0].name, 'cli-skill');

    const listed = JSON.parse(runCli(['skills', 'list'], env));
    assert.equal(listed.length, 1);
    assert.equal(listed[0].name, 'cli-skill');

    const paths = JSON.parse(runCli(['skills', 'path'], env));
    assert.ok(paths.deepAgentSkillSourcePaths.includes(path.join(homeDir, 'skills')));

    const removed = JSON.parse(runCli(['skills', 'remove', 'cli-skill'], env));
    assert.equal(removed.removed, true);

    const afterRemove = JSON.parse(runCli(['skills', 'list'], env));
    assert.equal(afterRemove.length, 0);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
