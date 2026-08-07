import { readFile } from 'node:fs/promises';

import { NsisUpdater } from 'electron-updater';

import type { UpdateStatus } from './contracts.js';

interface UpdateConfig {
  updateUrl?: unknown;
}

export function normalizeUpdateUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:') return null;
    return url.toString().replace(/\/$/u, '');
  } catch {
    return null;
  }
}

export async function readUpdateUrl(path: string): Promise<string | null> {
  try {
    const config = JSON.parse(await readFile(path, 'utf8')) as UpdateConfig;
    return normalizeUpdateUrl(config.updateUrl);
  } catch {
    return null;
  }
}

export class UpdateManager {
  readonly #currentVersion: string;
  readonly #updater: NsisUpdater | null;
  readonly #notify: (status: UpdateStatus) => void;
  #enabled = true;
  #status: UpdateStatus;

  public constructor(options: {
    currentVersion: string;
    updateUrl: string | null;
    packaged: boolean;
    notify: (status: UpdateStatus) => void;
  }) {
    this.#currentVersion = options.currentVersion;
    this.#notify = options.notify;
    const supported = options.packaged && options.updateUrl !== null;
    this.#status = {
      supported,
      phase: supported ? 'idle' : 'disabled',
      currentVersion: options.currentVersion,
      availableVersion: null,
      progressPercent: null,
      message: supported
        ? 'Les mises à jour automatiques sont prêtes.'
        : 'Canal de mise à jour non configuré pour cette compilation.',
    };
    this.#updater = supported
      ? new NsisUpdater({ provider: 'generic', url: options.updateUrl! })
      : null;
    if (this.#updater) this.#registerEvents(this.#updater);
  }

  public getStatus(): UpdateStatus {
    return { ...this.#status };
  }

  public setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
    if (!enabled && this.#updater) {
      this.#setStatus({ phase: 'idle', message: 'Recherche automatique désactivée.' });
    }
  }

  public async check(manual = false): Promise<UpdateStatus> {
    if (!this.#updater) return this.getStatus();
    if (!this.#enabled && !manual) return this.getStatus();
    this.#setStatus({ phase: 'checking', message: 'Recherche d’une mise à jour…' });
    try {
      await this.#updater.checkForUpdates();
    } catch (error) {
      this.#setStatus({
        phase: 'error',
        message: `Recherche impossible : ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    return this.getStatus();
  }

  public install(): void {
    if (this.#status.phase !== 'downloaded' || !this.#updater) return;
    this.#updater.quitAndInstall(false, true);
  }

  #registerEvents(updater: NsisUpdater): void {
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.on('update-available', (info) => {
      this.#setStatus({
        phase: 'available',
        availableVersion: info.version,
        message: `Version ${info.version} trouvée. Téléchargement…`,
      });
    });
    updater.on('download-progress', (progress) => {
      this.#setStatus({
        phase: 'downloading',
        progressPercent: Math.max(0, Math.min(100, progress.percent)),
        message: `Téléchargement de la mise à jour : ${Math.round(progress.percent)} %`,
      });
    });
    updater.on('update-downloaded', (info) => {
      this.#setStatus({
        phase: 'downloaded',
        availableVersion: info.version,
        progressPercent: 100,
        message: `Version ${info.version} prête. Redémarre pour l’installer.`,
      });
    });
    updater.on('update-not-available', () => {
      this.#setStatus({
        phase: 'up-to-date',
        availableVersion: null,
        progressPercent: null,
        message: `SubTranslateAI ${this.#currentVersion} est à jour.`,
      });
    });
    updater.on('error', (error) => {
      this.#setStatus({ phase: 'error', message: `Mise à jour impossible : ${error.message}` });
    });
  }

  #setStatus(patch: Partial<UpdateStatus>): void {
    this.#status = { ...this.#status, ...patch };
    this.#notify(this.getStatus());
  }
}
