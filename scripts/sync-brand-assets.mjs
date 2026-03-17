#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const generatedAssets = [
  {
    source: path.join(repoRoot, 'res', 'logo.png'),
    targets: [path.join(repoRoot, 'docs', 'static', 'img', 'logo.png')],
  },
  {
    source: path.join(repoRoot, 'res', 'holon-logo.png'),
    targets: [path.join(repoRoot, 'docs', 'static', 'img', 'holon-logo.png')],
  },
];

function ensureFileExists(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${path.relative(repoRoot, filePath)}`);
  }
}

function copyIfChanged(sourcePath, targetPath) {
  const source = fs.readFileSync(sourcePath);
  const targetExists = fs.existsSync(targetPath);
  const target = targetExists ? fs.readFileSync(targetPath) : null;

  if (targetExists && Buffer.compare(source, target) === 0) {
    return false;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, source);
  return true;
}

let changedCount = 0;

for (const asset of generatedAssets) {
  ensureFileExists(asset.source);

  for (const target of asset.targets) {
    if (copyIfChanged(asset.source, target)) {
      changedCount += 1;
      console.log(`Synced ${path.relative(repoRoot, target)}`);
    }
  }
}

if (changedCount === 0) {
  console.log('Brand assets already up to date.');
}