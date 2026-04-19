import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');
const outdir = path.join(packageRoot, 'dist', 'webui');
const staticAssets = [
  'favicon.ico',
  'favicon-16x16.png',
  'favicon-32x32.png',
  'apple-touch-icon.png',
];

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
    '.png': 'dataurl',
  },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
});

await Promise.all(
  staticAssets.map((fileName) => copyFile(path.join(packageRoot, 'src', 'webui', fileName), path.join(outdir, fileName))),
);
