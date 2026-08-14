import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  hasStaticTextTranslation,
  resolveInterfaceLocale,
  translate,
  translateStaticText,
} from '../src/i18n.js';

describe('desktop interface localization', () => {
  it('honors a manual language choice', () => {
    expect(resolveInterfaceLocale('fr', ['en-US'])).toBe('fr');
    expect(resolveInterfaceLocale('en', ['fr-FR'])).toBe('en');
  });

  it('detects French and defaults every other system language to English', () => {
    expect(resolveInterfaceLocale('auto', ['fr-CA', 'en-US'])).toBe('fr');
    expect(resolveInterfaceLocale('auto', ['de-DE', 'en-US'])).toBe('en');
  });

  it('translates dynamic placeholders and static interface text', () => {
    expect(translate('en', 'updateDownloading', { percent: 42 })).toBe('Downloading update: 42%');
    expect(translateStaticText('en', '  Réglages\n')).toBe('  Settings\n');
    expect(translateStaticText('fr', 'Settings')).toBe('Réglages');
  });

  it('covers every language-dependent text node in the desktop HTML', () => {
    const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
    const body = html.split('<body>')[1]?.split('</body>')[0] ?? '';
    const textNodes = [...body.matchAll(/>([^<]+)</gs)]
      .map((match) => match[1].replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const translatedAttributes = [...body.matchAll(/aria-label="([^"]+)"/g)].map(
      (match) => match[1],
    );
    const neutralText =
      /^(?:SubTranslateAI|译|v—|—|\.|\d|Chrome|Edge|Application|(?:chrome|edge):\/\/extensions)$/;
    const missing = [...textNodes, ...translatedAttributes].filter(
      (text) => !neutralText.test(text) && !hasStaticTextTranslation(text),
    );
    expect(missing).toEqual([]);
  });
});
