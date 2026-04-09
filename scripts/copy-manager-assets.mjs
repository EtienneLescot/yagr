import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');

const source = path.join(packageRoot, 'src', 'manager-tooling', 'YAGENTS.md');
const destinationDir = path.join(packageRoot, 'dist', 'manager-tooling');
const destination = path.join(destinationDir, 'YAGENTS.md');

await mkdir(destinationDir, { recursive: true });
await copyFile(source, destination);