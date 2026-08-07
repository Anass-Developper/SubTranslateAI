import { describe, expect, it } from 'vitest';

import { DEFAULT_APP_PREFERENCES, normalizePreferences } from '../src/preferences.js';

describe('normalizePreferences', () => {
  it('retombe sur des valeurs simples et sûres pour un fichier invalide', () => {
    expect(normalizePreferences(null)).toEqual(DEFAULT_APP_PREFERENCES);
    expect(normalizePreferences({ automaticUpdates: 'oui', launchAtLogin: 1 })).toEqual(
      DEFAULT_APP_PREFERENCES,
    );
  });

  it('conserve uniquement les booléens reconnus', () => {
    expect(normalizePreferences({ automaticUpdates: false, launchAtLogin: false })).toEqual({
      automaticUpdates: false,
      launchAtLogin: false,
    });
  });
});
