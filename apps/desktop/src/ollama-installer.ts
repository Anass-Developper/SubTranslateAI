import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const execFileAsync = promisify(execFile);

export const OLLAMA_INSTALLER_URL = 'https://ollama.com/download/OllamaSetup.exe';

export function authenticodeVerificationScript(): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    '$installerPath = $env:SUBTRANSLATE_OLLAMA_INSTALLER',
    "if ([string]::IsNullOrWhiteSpace($installerPath)) { throw 'Installer path is missing.' }",
    '$signature = Get-AuthenticodeSignature -LiteralPath $installerPath',
    "$subject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { '' }",
    '[pscustomobject]@{',
    '  Status = $signature.Status.ToString()',
    '  Subject = $subject',
    '} | ConvertTo-Json -Compress',
  ].join('\n');
}

export function downloadPercent(receivedBytes: number, totalBytes: number | null): number | null {
  if (totalBytes === null || totalBytes <= 0) return null;
  return Math.max(0, Math.min(100, (receivedBytes / totalBytes) * 100));
}

export async function downloadOllamaInstaller(
  destination: string,
  onProgress: (percent: number | null) => void,
): Promise<void> {
  const response = await fetch(OLLAMA_INSTALLER_URL, {
    redirect: 'follow',
    signal: AbortSignal.timeout(30 * 60_000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Téléchargement d’Ollama refusé (HTTP ${response.status}).`);
  }
  const totalHeader = Number(response.headers.get('content-length'));
  const total = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : null;
  let received = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      onProgress(downloadPercent(received, total));
      callback(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(response.body), counter, createWriteStream(destination));
  } catch (error) {
    await rm(destination, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function verifyOllamaInstaller(destination: string): Promise<void> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', authenticodeVerificationScript()],
      {
        windowsHide: true,
        timeout: 60_000,
        env: { ...process.env, SUBTRANSLATE_OLLAMA_INSTALLER: destination },
      },
    ));
  } catch (error) {
    const details =
      typeof error === 'object' && error !== null && 'stderr' in error
        ? String(error.stderr).trim()
        : error instanceof Error
          ? error.message
          : String(error);
    throw new Error(
      `La vérification PowerShell de l’installateur Ollama a échoué${details ? ` : ${details}` : '.'}`,
      { cause: error },
    );
  }
  const signature = JSON.parse(stdout.trim()) as { Status?: unknown; Subject?: unknown };
  if (
    signature.Status !== 'Valid' ||
    typeof signature.Subject !== 'string' ||
    !signature.Subject.includes('Ollama Inc.')
  ) {
    throw new Error('La signature numérique de l’installateur Ollama est invalide.');
  }
}

export async function runOllamaInstaller(destination: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(destination, ['/SILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], {
      windowsHide: true,
      shell: false,
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`L’installation d’Ollama s’est arrêtée avec le code ${code ?? '?'}.`));
    });
  });
}
