import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  disableOllamaLaunchAtLogin,
  ollamaShutdownCommands,
  ollamaStartupShortcutPaths,
} from '../src/ollama-lifecycle.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('arrêt d’Ollama', () => {
  it('ferme immédiatement l’application et le serveur Ollama sous Windows', () => {
    expect(
      ollamaShutdownCommands(
        'C:\\Ollama\\ollama.exe',
        'hf.co/tencent/Hy-MT2-7B-GGUF:Q4_K_M',
        'win32',
        'C:\\Windows',
      ),
    ).toEqual([
      {
        executable: 'C:\\Windows\\System32\\taskkill.exe',
        args: ['/IM', 'ollama app.exe', '/T', '/F'],
      },
      {
        executable: 'C:\\Windows\\System32\\taskkill.exe',
        args: ['/IM', 'ollama.exe', '/T', '/F'],
      },
      {
        executable: 'C:\\Windows\\System32\\taskkill.exe',
        args: ['/IM', 'llama-server.exe', '/T', '/F'],
      },
    ]);
  });

  it('décharge proprement le modèle sur les autres systèmes', () => {
    expect(ollamaShutdownCommands('/opt/ollama', 'model', 'linux')).toEqual([
      { executable: '/opt/ollama', args: ['stop', 'model'] },
    ]);
  });

  it('peut quand même fermer les processus Windows si le chemin Ollama est introuvable', () => {
    expect(ollamaShutdownCommands(null, 'model', 'win32', 'C:\\Windows')).toHaveLength(3);
  });

  it('désactive le raccourci de démarrage Ollama sans le perdre', async () => {
    const appData = await mkdtemp(join(tmpdir(), 'subtranslate-ollama-startup-'));
    temporaryDirectories.push(appData);
    const paths = ollamaStartupShortcutPaths(appData);
    await mkdir(dirname(paths.active), { recursive: true });
    await writeFile(paths.active, 'raccourci de test');

    await expect(disableOllamaLaunchAtLogin(appData, 'win32')).resolves.toBe(true);
    await expect(disableOllamaLaunchAtLogin(appData, 'win32')).resolves.toBe(false);
    await expect(readFile(paths.disabled, 'utf8')).resolves.toBe('raccourci de test');
  });
});
