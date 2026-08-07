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
    'produit une commande PowerShell valide avec un chemin Unicode séparé',
    async () => {
      const installerPath = 'C:\\Users\\测试 Profile\\OllamaSetup.exe';
      const script = [
        'function Get-AuthenticodeSignature {',
        '  param([string]$LiteralPath)',
        "  if ($LiteralPath -ne $env:SUBTRANSLATE_EXPECTED_INSTALLER) { throw 'Unexpected installer path.' }",
        "  [pscustomobject]@{ Status = 'Valid'; SignerCertificate = [pscustomobject]@{ Subject = 'CN=Ollama Inc.' } }",
        '}',
        authenticodeVerificationScript(),
      ].join('\n');
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        {
          windowsHide: true,
          timeout: 60_000,
          env: {
            ...process.env,
            SUBTRANSLATE_OLLAMA_INSTALLER: installerPath,
            SUBTRANSLATE_EXPECTED_INSTALLER: installerPath,
          },
        },
      );
      const signature = JSON.parse(stdout.trim()) as { Status?: unknown; Subject?: unknown };
      expect(signature).toEqual({ Status: 'Valid', Subject: 'CN=Ollama Inc.' });
    },
    60_000,
  );
});
