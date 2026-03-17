import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');
const outdir = path.join(packageRoot, 'dist', 'webui');

await mkdir(outdir, { recursive: true });

await build({
  absWorkingDir: packageRoot,
  entryPoints: ['src/webui/app.tsx', 'src/webui/styles.css'],
  outdir,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  sourcemap: true,
  minify: false,
  loader: {
    '.css': 'css',
  },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
});