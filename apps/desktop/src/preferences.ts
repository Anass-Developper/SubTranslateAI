import { readFile, writeFile } from 'node:fs/promises';

import type { AppPreferences } from './contracts.js';
import { isInterfaceLanguage } from './i18n.js';

export const DEFAULT_APP_PREFERENCES: Readonly<AppPreferences> = Object.freeze({
  automaticUpdates: true,
  launchAtLogin: false,
  interfaceLanguage: 'auto',
});

export function normalizePreferences(value: unknown): AppPreferences {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_APP_PREFERENCES };
  const candidate = value as Partial<AppPreferences>;
  return {
    automaticUpdates:
      typeof candidate.automaticUpdates === 'boolean'
        ? candidate.automaticUpdates
        : DEFAULT_APP_PREFERENCES.automaticUpdates,
    launchAtLogin: false,
    interfaceLanguage: isInterfaceLanguage(candidate.interfaceLanguage)
      ? candidate.interfaceLanguage
      : DEFAULT_APP_PREFERENCES.interfaceLanguage,
  };
}

export async function readPreferences(path: string): Promise<AppPreferences> {
  try {
    return normalizePreferences(JSON.parse(await readFile(path, 'utf8')) as unknown);
  } catch {
    return { ...DEFAULT_APP_PREFERENCES };
  }
}

export async function writePreferences(path: string, preferences: AppPreferences): Promise<void> {
  await writeFile(path, `${JSON.stringify(normalizePreferences(preferences), null, 2)}\n`, 'utf8');
}
