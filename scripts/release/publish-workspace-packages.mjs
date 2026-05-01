#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, workspaceRoot } from './workspace-packages.mjs';
import { defaultStageRoot, stageWorkspacePackages } from './stage-workspace-packages.mjs';

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

function isPublished(name, version) {
  const result = spawnSync('npm', ['view', `${name}@${version}`, 'version'], {
    cwd: workspaceRoot,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  return result.status === 0;
}

function main() {
  const args = parseArgs();
  const tag = args.tag ? String(args.tag) : null;
  const provenance = args.provenance !== false;
  const skipExisting = args['skip-existing'] !== false;
  const staged = fs.existsSync(path.join(defaultStageRoot, 'manifest.json'))
    ? JSON.parse(fs.readFileSync(path.join(defaultStageRoot, 'manifest.json'), 'utf8'))
    : stageWorkspacePackages({ includeRoot: true });

  for (const pkg of staged) {
    if (skipExisting && isPublished(pkg.name, pkg.version)) {
      process.stdout.write(`\n> Skipping ${pkg.name}@${pkg.version}; already published\n`);
      continue;
    }
    const publishArgs = ['publish', '--access', 'public'];
    if (provenance) publishArgs.push('--provenance');
    if (tag) publishArgs.push('--tag', tag);
    process.stdout.write(`\n> Publishing ${pkg.name}@${pkg.version}\n`);
    run('npm', publishArgs, path.resolve(workspaceRoot, pkg.path));
  }
}

main();
