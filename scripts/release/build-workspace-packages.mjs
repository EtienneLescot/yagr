#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { getPackageGraph, topologicalPackages, workspaceRoot } from './workspace-packages.mjs';

const packages = topologicalPackages(getPackageGraph()).filter(pkg => pkg.path !== '.');

for (const pkg of packages) {
  process.stdout.write(`\n> Building ${pkg.name}\n`);
  const result = spawnSync('pnpm', ['--filter', pkg.name, 'run', 'build'], {
    cwd: workspaceRoot,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}
