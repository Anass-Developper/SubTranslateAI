import { readFile } from 'node:fs/promises';

import { NsisUpdater } from 'electron-updater';

import type { UpdateStatus } from './contracts.js';
import { translate, type InterfaceLocale, type MessageKey } from './i18n.js';

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
  #errorDetails = '';
  #errorMessageKey: MessageKey = 'updateFailed';
  #locale: InterfaceLocale;
  #status: UpdateStatus;

  public constructor(options: {
    currentVersion: string;
    updateUrl: string | null;
    packaged: boolean;
    locale: InterfaceLocale;
    notify: (status: UpdateStatus) => void;
  }) {
    this.#currentVersion = options.currentVersion;
    this.#notify = options.notify;
    this.#locale = options.locale;
    const supported = options.packaged && options.updateUrl !== null;
    this.#status = {
      supported,
      phase: supported ? 'idle' : 'disabled',
      currentVersion: options.currentVersion,
      availableVersion: null,
      progressPercent: null,
      message: translate(options.locale, supported ? 'updatesReady' : 'updatesUnsupported'),
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
      this.#setStatus({ phase: 'idle' });
    }
  }

  public setLocale(locale: InterfaceLocale): void {
    this.#locale = locale;
    this.#setStatus({});
  }

  public async check(manual = false): Promise<UpdateStatus> {
    if (!this.#updater) return this.getStatus();
    if (!this.#enabled && !manual) return this.getStatus();
    this.#setStatus({ phase: 'checking' });
    try {
      await this.#updater.checkForUpdates();
    } catch (error) {
      this.#errorDetails = error instanceof Error ? error.message : String(error);
      this.#errorMessageKey = 'updateCheckFailed';
      this.#setStatus({ phase: 'error' });
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
      });
    });
    updater.on('download-progress', (progress) => {
      this.#setStatus({
        phase: 'downloading',
        progressPercent: Math.max(0, Math.min(100, progress.percent)),
      });
    });
    updater.on('update-downloaded', (info) => {
      this.#setStatus({
        phase: 'downloaded',
        availableVersion: info.version,
        progressPercent: 100,
      });
    });
    updater.on('update-not-available', () => {
      this.#setStatus({
        phase: 'up-to-date',
        availableVersion: null,
        progressPercent: null,
      });
    });
    updater.on('error', (error) => {
      this.#errorDetails = error.message;
      this.#errorMessageKey = 'updateFailed';
      this.#setStatus({ phase: 'error' });
    });
  }

  #setStatus(patch: Partial<UpdateStatus>): void {
    this.#status = { ...this.#status, ...patch };
    this.#status.message = this.#localizedMessage();
    this.#notify(this.getStatus());
  }

  #localizedMessage(): string {
    switch (this.#status.phase) {
      case 'disabled':
        return translate(this.#locale, 'updatesUnsupported');
      case 'idle':
        return translate(this.#locale, this.#enabled ? 'updatesReady' : 'automaticUpdatesDisabled');
      case 'checking':
        return translate(this.#locale, 'updateChecking');
      case 'available':
        return translate(this.#locale, 'updateAvailable', {
          version: this.#status.availableVersion ?? '',
        });
      case 'downloading':
        return translate(this.#locale, 'updateDownloading', {
          percent: Math.round(this.#status.progressPercent ?? 0),
        });
      case 'downloaded':
        return translate(this.#locale, 'updateDownloaded', {
          version: this.#status.availableVersion ?? '',
        });
      case 'up-to-date':
        return translate(this.#locale, 'updateCurrent', { version: this.#currentVersion });
      case 'error':
        return translate(this.#locale, this.#errorMessageKey, { error: this.#errorDetails });
    }
  }
}
