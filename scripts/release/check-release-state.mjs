#!/usr/bin/env node

import { dependencyFields, loadWorkspacePackages, parseArgs } from './workspace-packages.mjs';

function assertStableVersions(packages) {
  for (const pkg of packages) {
    if (String(pkg.version).includes('-')) {
      throw new Error(`${pkg.name} has prerelease version ${pkg.version}; stable releases require stable semver in source manifests.`);
    }
  }
}

function assertWorkspaceDependencies(packages) {
  const internalNames = new Set(packages.map(pkg => pkg.name));
  for (const pkg of packages) {
    for (const field of dependencyFields) {
      for (const [name, spec] of Object.entries(pkg.manifest[field] || {})) {
        if (!internalNames.has(name)) continue;
        if (spec !== 'workspace:*') {
          throw new Error(`${pkg.packageJsonPath} must declare internal dependency ${name} as workspace:*; found ${spec}`);
        }
      }
    }
  }
}

function main() {
  const args = parseArgs();
  const packages = loadWorkspacePackages();

  assertWorkspaceDependencies(packages);
  if (args.stable) {
    assertStableVersions(packages);
  }

  process.stdout.write('Release state checks passed.\n');
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
