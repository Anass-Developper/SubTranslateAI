import { describe, expect, it } from 'vitest';

import { DEFAULT_APP_PREFERENCES, normalizePreferences } from '../src/preferences.js';

describe('normalizePreferences', () => {
  it('retombe sur des valeurs simples et sûres pour un fichier invalide', () => {
    expect(normalizePreferences(null)).toEqual(DEFAULT_APP_PREFERENCES);
    expect(
      normalizePreferences({
        automaticUpdates: 'oui',
        launchAtLogin: 1,
        interfaceLanguage: 'de',
      }),
    ).toEqual(DEFAULT_APP_PREFERENCES);
  });

  it('conserve uniquement les booléens reconnus', () => {
    expect(
      normalizePreferences({
        automaticUpdates: false,
        launchAtLogin: false,
        interfaceLanguage: 'en',
      }),
    ).toEqual({
      automaticUpdates: false,
      launchAtLogin: false,
      interfaceLanguage: 'en',
    });
  });

  it('désactive une ancienne préférence de démarrage avec Windows', () => {
    expect(normalizePreferences({ automaticUpdates: true, launchAtLogin: true })).toEqual({
      automaticUpdates: true,
      launchAtLogin: false,
      interfaceLanguage: 'auto',
    });
  });
});
