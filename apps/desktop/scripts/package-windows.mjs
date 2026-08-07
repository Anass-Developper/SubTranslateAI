import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { resolveUpdateUrl } from './release-config.mjs';

const desktopDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceDirectory = resolve(desktopDirectory, '../..');
const nativeModule = resolve(
  workspaceDirectory,
  'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
);
const electronRebuild = resolve(workspaceDirectory, 'node_modules/@electron/rebuild/lib/cli.js');
const electronBuilder = resolve(workspaceDirectory, 'node_modules/electron-builder/cli.js');
const updateUrl = resolveUpdateUrl(process.env);

await writeFile(
  resolve(desktopDirectory, 'dist/update-config.json'),
  `${JSON.stringify({ updateUrl }, null, 2)}\n`,
  'utf8',
);

const developmentBinary = await readFile(nativeModule);

try {
  await run(process.execPath, [
    electronRebuild,
    '--force',
    '--which-module',
    'better-sqlite3',
    '--version',
    '43.3.0',
  ]);
  await run(process.execPath, [electronBuilder, '--win', 'nsis']);
} finally {
  // electron-rebuild modifies the hoisted workspace dependency in place. Restore
  // the Node-compatible binary so tests and the development server still work.
  await writeFile(nativeModule, developmentBinary);
}

function run(command, arguments_) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, {
      cwd: desktopDirectory,
      stdio: 'inherit',
      shell: false,
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} s'est arrêté avec le code ${code ?? 'inconnu'}.`));
    });
  });
}
