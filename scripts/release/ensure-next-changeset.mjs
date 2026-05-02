#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getPackageGraph, topologicalPackages, workspaceRoot } from './workspace-packages.mjs';

const changesetPath = path.join(workspaceRoot, '.changeset', 'next-snapshot.md');

function git(args) {
  const result = spawnSync('git', args, {
    cwd: workspaceRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  }

  return result.stdout.trim();
}

function listChangedFiles() {
  const baseRef = process.env.GITHUB_BASE_REF
    || process.env.NEXT_SNAPSHOT_BASE_REF
    || 'origin/main';
  const currentRef = process.env.GITHUB_SHA || 'HEAD';
  const mergeBase = git(['merge-base', baseRef, currentRef]);
  const output = git(['diff', '--name-only', `${mergeBase}...${currentRef}`]);
  return output ? output.split('\n').filter(Boolean) : [];
}

function packageOwnsFile(pkg, file) {
  if (pkg.path === '.') {
    return file === 'package.json'
      || file.startsWith('src/')
      || file.startsWith('tests/')
      || file.startsWith('res/')
      || file.startsWith('scripts/')
      || file.startsWith('tsconfig');
  }

  return file === `${pkg.path}/package.json` || file.startsWith(`${pkg.path}/src/`);
}

function collectChangedPackages(files) {
  const packages = topologicalPackages(getPackageGraph());
  const changed = new Set();

  for (const pkg of packages) {
    if (files.some(file => packageOwnsFile(pkg, file))) {
      changed.add(pkg.name);
    }
  }

  let propagated = true;
  while (propagated) {
    propagated = false;
    for (const pkg of packages) {
      if (changed.has(pkg.name)) continue;
      if (pkg.internalDependencies.some(name => changed.has(name))) {
        changed.add(pkg.name);
        propagated = true;
      }
    }
  }

  return packages.filter(pkg => changed.has(pkg.name));
}

function writeSnapshotChangeset(packages) {
  if (packages.length === 0) {
    fs.rmSync(changesetPath, { force: true });
    process.stdout.write('No package changes detected for next snapshot.\n');
    return;
  }

  const frontmatter = packages.map(pkg => `"${pkg.name}": patch`).join('\n');
  const body = 'Automated next snapshot release.';
  fs.writeFileSync(changesetPath, `---\n${frontmatter}\n---\n\n${body}\n`);
  process.stdout.write(`Prepared next snapshot changeset for ${packages.map(pkg => pkg.name).join(', ')}.\n`);
}

try {
  writeSnapshotChangeset(collectChangedPackages(listChangedFiles()));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
