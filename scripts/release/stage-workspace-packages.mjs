#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {
  dependencyFields,
  getPackageGraph,
  parseArgs,
  sortObjectKeys,
  topologicalPackages,
  workspaceRoot,
} from './workspace-packages.mjs';

export const defaultStageRoot = path.join(workspaceRoot, '.tmp/npm-publish');

function copyDirectory(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function getVersionPlan(packages) {
  return new Map(packages.map(pkg => [pkg.name, pkg.version]));
}

function normalizeRepositoryForProvenance(repository) {
  if (!repository?.url) return repository;
  return {
    ...repository,
    url: repository.url.replace(/^git\+/, '').replace(/\.git$/, ''),
  };
}

function transformManifest(pkg, packageMap, versionPlan, rootManifest) {
  const manifest = structuredClone(pkg.manifest);
  manifest.files = ['dist/'];
  manifest.repository = normalizeRepositoryForProvenance(manifest.repository || rootManifest.repository);
  manifest.publishConfig = { ...(manifest.publishConfig || {}), access: 'public' };

  for (const field of dependencyFields) {
    if (!manifest[field]) continue;
    for (const dependencyName of Object.keys(manifest[field])) {
      if (!packageMap.has(dependencyName)) continue;
      const version = versionPlan.get(dependencyName);
      if (!version) throw new Error(`Missing staged version for ${dependencyName}`);
      manifest[field][dependencyName] = version;
    }
    manifest[field] = sortObjectKeys(manifest[field]);
  }

  return manifest;
}

export function stageWorkspacePackages({ stageRoot = defaultStageRoot, includeRoot = true } = {}) {
  const packages = topologicalPackages(getPackageGraph()).filter(pkg => includeRoot || pkg.path !== '.');
  const packageMap = new Map(packages.map(pkg => [pkg.name, pkg]));
  const rootManifest = packageMap.get('@yagr/agent')?.manifest;
  if (!rootManifest?.repository?.url) {
    throw new Error('Root package repository.url is required for provenance-compatible staged packages.');
  }
  const versionPlan = getVersionPlan(packages);
  fs.rmSync(stageRoot, { recursive: true, force: true });
  fs.mkdirSync(stageRoot, { recursive: true });

  const staged = [];
  for (const pkg of packages) {
    const distPath = path.join(pkg.absolutePath, 'dist');
    const jsEntry = path.join(distPath, 'index.js');
    const typesEntry = path.join(distPath, 'index.d.ts');
    if (!fs.existsSync(jsEntry)) throw new Error(`Missing build output: ${path.relative(workspaceRoot, jsEntry)}`);
    if (!fs.existsSync(typesEntry)) throw new Error(`Missing type output: ${path.relative(workspaceRoot, typesEntry)}`);

    const target = path.join(stageRoot, pkg.name.replace('/', '__'));
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'package.json'), `${JSON.stringify(transformManifest(pkg, packageMap, versionPlan, rootManifest), null, 2)}\n`);
    copyDirectory(distPath, path.join(target, 'dist'));

    staged.push({ name: pkg.name, version: pkg.version, path: target });
  }

  fs.writeFileSync(path.join(stageRoot, 'manifest.json'), `${JSON.stringify(staged, null, 2)}\n`);
  return staged;
}

function main() {
  const args = parseArgs();
  const staged = stageWorkspacePackages({ includeRoot: args.root !== false });
  process.stdout.write(`${JSON.stringify(staged, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
