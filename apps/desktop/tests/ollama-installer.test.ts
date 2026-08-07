import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { authenticodeVerificationScript, downloadPercent } from '../src/ollama-installer.js';

const execFileAsync = promisify(execFile);

describe('downloadPercent', () => {
  it('calcule et borne la progression', () => {
    expect(downloadPercent(50, 100)).toBe(50);
    expect(downloadPercent(200, 100)).toBe(100);
    expect(downloadPercent(-10, 100)).toBe(0);
  });

  it('gère une taille serveur inconnue', () => {
    expect(downloadPercent(10, null)).toBeNull();
    expect(downloadPercent(10, 0)).toBeNull();
  });

  it.runIf(process.platform === 'win32')(
    'produit une commande PowerShell valide avec un chemin séparé',
    async () => {
      const executable = process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe';
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', authenticodeVerificationScript()],
        {
          windowsHide: true,
          timeout: 60_000,
          env: { ...process.env, SUBTRANSLATE_OLLAMA_INSTALLER: executable },
        },
      );
      const signature = JSON.parse(stdout.trim()) as { Status?: unknown; Subject?: unknown };
      expect(typeof signature.Status).toBe('string');
      expect(typeof signature.Subject).toBe('string');
    },
  );
});
