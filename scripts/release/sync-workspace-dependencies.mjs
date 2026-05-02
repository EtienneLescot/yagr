#!/usr/bin/env node

import {
  dependencyFields,
  detectInternalImports,
  expectedLocalDependencySpec,
  getInternalPackageMap,
  getPackageGraph,
  loadWorkspacePackages,
  parseArgs,
  sortObjectKeys,
  topologicalPackages,
  writeJson,
} from './workspace-packages.mjs';

const repository = {
  type: 'git',
  url: 'git+https://github.com/EtienneLescot/yagr.git',
};

function ensurePackageMetadata(manifest, pkg) {
  let changed = false;

  if (JSON.stringify(manifest.repository) !== JSON.stringify(repository)) {
    manifest.repository = repository;
    changed = true;
  }

  if (pkg.path !== '.' && JSON.stringify(manifest.files) !== JSON.stringify(['dist/'])) {
    manifest.files = ['dist/'];
    changed = true;
  }

  if (!manifest.publishConfig || manifest.publishConfig.access !== 'public') {
    manifest.publishConfig = { ...(manifest.publishConfig || {}), access: 'public' };
    changed = true;
  }

  return changed;
}

function syncPackage(manifest, pkg, packageMap, internalNames, check) {
  let changed = ensurePackageMetadata(manifest, pkg);
  const detected = new Set(detectInternalImports(pkg, internalNames));
  const declared = new Set();

  for (const field of dependencyFields) {
    const dependencies = manifest[field];
    if (!dependencies) continue;

    for (const [dependencyName, dependencySpec] of Object.entries(dependencies)) {
      if (!internalNames.has(dependencyName)) continue;
      if (!detected.has(dependencyName)) {
        if (check) {
          throw new Error(`${pkg.packageJsonPath} declares unused internal dependency ${dependencyName}. Run pnpm run deps:sync.`);
        }
        delete dependencies[dependencyName];
        changed = true;
        continue;
      }
      declared.add(dependencyName);
      const dependencyPackage = packageMap.get(dependencyName);
      const expected = expectedLocalDependencySpec(pkg, dependencyPackage);
      if (dependencySpec !== expected) {
        dependencies[dependencyName] = expected;
        changed = true;
      }
    }
  }

  for (const dependencyName of detected) {
    if (declared.has(dependencyName)) continue;
    manifest.dependencies ||= {};
    manifest.dependencies[dependencyName] = expectedLocalDependencySpec(pkg, packageMap.get(dependencyName));
    changed = true;
  }

  for (const field of dependencyFields) {
    if (!manifest[field]) continue;
    if (Object.keys(manifest[field]).length === 0) {
      delete manifest[field];
      changed = true;
    } else {
      manifest[field] = sortObjectKeys(manifest[field]);
    }
  }

  if (check && changed) {
    throw new Error(`${pkg.packageJsonPath} is not synchronized. Run pnpm run deps:sync.`);
  }

  if (!check && changed) {
    writeJson(pkg.packageJsonPath, manifest);
  }

  return changed;
}

function main() {
  const args = parseArgs();
  const check = Boolean(args.check);
  const packages = loadWorkspacePackages();
  const packageMap = getInternalPackageMap(packages);
  const internalNames = new Set(packageMap.keys());

  topologicalPackages(getPackageGraph(packages));

  let changed = false;
  for (const pkg of packages) {
    changed = syncPackage(pkg.manifest, pkg, packageMap, internalNames, check) || changed;
  }

  if (check) {
    process.stdout.write('Workspace dependency metadata is synchronized.\n');
  } else {
    process.stdout.write(changed ? 'Workspace dependency metadata synchronized.\n' : 'Workspace dependency metadata already synchronized.\n');
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
