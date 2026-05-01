#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { dependencyFields, getPackageGraph, topologicalPackages, workspaceRoot } from './workspace-packages.mjs';
import { defaultStageRoot, stageWorkspacePackages } from './stage-workspace-packages.mjs';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || workspaceRoot,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.status !== 0) {
    if (options.capture) {
      process.stderr.write(result.stderr || result.stdout || '');
    }
    throw new Error(`${command} ${args.join(' ')} failed`);
  }
  return result.stdout || '';
}

function assertNoLocalDependencies(manifest, manifestPath) {
  for (const field of dependencyFields) {
    for (const [name, spec] of Object.entries(manifest[field] || {})) {
      if (/^(file|link|workspace):/.test(spec)) {
        throw new Error(`${manifestPath} contains local dependency ${name}: ${spec}`);
      }
    }
  }
}

function packStagedPackage(stagedPackage, tarballDir) {
  const output = run('npm', ['pack', stagedPackage.path, '--pack-destination', tarballDir, '--json'], { capture: true });
  const [packed] = JSON.parse(output);
  const files = new Set(packed.files.map(file => file.path));
  if (!files.has('dist/index.js')) throw new Error(`${stagedPackage.name} tarball is missing dist/index.js`);
  if (!files.has('dist/index.d.ts')) throw new Error(`${stagedPackage.name} tarball is missing dist/index.d.ts`);
  return path.join(tarballDir, packed.filename);
}

function smokeImport(tarballs) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-package-smoke-'));
  fs.writeFileSync(path.join(tempDir, 'package.json'), '{"type":"module"}\n');
  run('npm', ['install', '--ignore-scripts', ...tarballs], { cwd: tempDir });

  const packages = topologicalPackages(getPackageGraph());
  const imports = packages.map(pkg => `await import(${JSON.stringify(pkg.name)});`).join('\n');
  run('node', ['--input-type=module', '--eval', `${imports}\nconsole.log('workspace package imports ok');`], { cwd: tempDir });

  run('node', ['--input-type=module', '--eval', "await import('@yagr/runtime'); await import('@yagr/runtime-events'); await import('@yagr/plugin-runtime'); console.log('primary public bricks ok');"], { cwd: tempDir });
}

function main() {
  run('npm', ['run', 'deps:check']);
  run('npm', ['run', 'build:packages']);
  run('npm', ['run', 'build:root']);

  const staged = stageWorkspacePackages({ stageRoot: defaultStageRoot, includeRoot: true });
  const tarballDir = path.join(defaultStageRoot, 'tarballs');
  fs.mkdirSync(tarballDir, { recursive: true });

  const tarballs = [];
  for (const stagedPackage of staged) {
    const manifestPath = path.join(stagedPackage.path, 'package.json');
    assertNoLocalDependencies(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), manifestPath);
    tarballs.push(packStagedPackage(stagedPackage, tarballDir));
  }

  smokeImport(tarballs);
  process.stdout.write('Workspace package publish verification succeeded.\n');
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
