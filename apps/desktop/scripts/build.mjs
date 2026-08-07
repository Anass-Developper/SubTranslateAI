import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(packageDirectory, 'dist');

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

await Promise.all([
  build({
    entryPoints: [resolve(packageDirectory, 'src/main.ts')],
    outfile: resolve(outputDirectory, 'main.cjs'),
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node24',
    external: ['electron', 'better-sqlite3', 'electron-updater'],
    sourcemap: true,
  }),
  build({
    entryPoints: [resolve(packageDirectory, 'src/preload.ts')],
    outfile: resolve(outputDirectory, 'preload.cjs'),
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node24',
    external: ['electron'],
    sourcemap: true,
  }),
  build({
    entryPoints: [resolve(packageDirectory, 'src/renderer.ts')],
    outfile: resolve(outputDirectory, 'renderer.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome140',
    sourcemap: true,
  }),
  copyFile(resolve(packageDirectory, 'src/index.html'), resolve(outputDirectory, 'index.html')),
  copyFile(resolve(packageDirectory, 'build/icon-v2.png'), resolve(outputDirectory, 'icon.png')),
]);
