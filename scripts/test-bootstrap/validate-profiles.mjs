#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProfileFromPath } from './load-profile.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(__dirname, 'profiles');

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.yaml'));

for (const name of files) {
  loadProfileFromPath(path.join(dir, name));
  process.stdout.write(`OK ${name}\n`);
}

process.stdout.write(`Validated ${files.length} profile(s).\n`);
