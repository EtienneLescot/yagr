#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import pacote from 'pacote';
import { dependencyFields, getPackageGraph, topologicalPackages, workspaceRoot } from './workspace-packages.mjs';

const verificationRoot = path.join(workspaceRoot, '.tmp/package-verify');

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

function parsePackOutput(output) {
  const parsed = JSON.parse(output.trim());
  return Array.isArray(parsed) ? parsed[0] : parsed;
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

async function packPackage(pkg, tarballDir) {
  const output = run('pnpm', ['--dir', pkg.absolutePath, 'pack', '--pack-destination', tarballDir, '--json'], { capture: true });
  const packed = parsePackOutput(output);
  const tarballPath = path.isAbsolute(packed.filename) ? packed.filename : path.join(tarballDir, packed.filename);
  const files = new Set((packed.files || []).map(file => file.path || file));

  if (!files.has('dist/index.js')) throw new Error(`${pkg.name} tarball is missing dist/index.js`);
  if (!files.has('dist/index.d.ts')) throw new Error(`${pkg.name} tarball is missing dist/index.d.ts`);

  const manifest = await pacote.manifest(tarballPath);
  assertNoLocalDependencies(manifest, `${pkg.name}@${manifest.version}`);
  return tarballPath;
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

async function main() {
  run('pnpm', ['run', 'deps:check']);
  run('pnpm', ['run', 'build']);

  fs.rmSync(verificationRoot, { recursive: true, force: true });
  const tarballDir = path.join(verificationRoot, 'tarballs');
  fs.mkdirSync(tarballDir, { recursive: true });

  const tarballs = [];
  for (const pkg of topologicalPackages(getPackageGraph())) {
    tarballs.push(await packPackage(pkg, tarballDir));
  }

  smokeImport(tarballs);
  process.stdout.write('Workspace package publish verification succeeded.\n');
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
