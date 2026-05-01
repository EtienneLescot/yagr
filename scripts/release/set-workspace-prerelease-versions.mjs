#!/usr/bin/env node

import { loadWorkspacePackages, parseArgs, writeJson } from './workspace-packages.mjs';

function main() {
  const args = parseArgs();
  const sequence = args.sequence || `${process.env.GITHUB_RUN_NUMBER || '0'}.${process.env.GITHUB_RUN_ATTEMPT || '0'}`;
  if (!sequence || sequence === '0.0') {
    throw new Error('Missing prerelease sequence. Pass --sequence or run in GitHub Actions.');
  }

  for (const pkg of loadWorkspacePackages()) {
    const manifest = pkg.manifest;
    const baseVersion = String(manifest.version).split('-')[0];
    manifest.version = `${baseVersion}-next.${sequence}`;
    writeJson(pkg.packageJsonPath, manifest);
  }

  process.stdout.write(`Workspace prerelease versions set to next.${sequence}.\n`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
