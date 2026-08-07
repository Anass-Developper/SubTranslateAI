import { describe, expect, it } from 'vitest';

import { resolveUpdateUrl } from '../scripts/release-config.mjs';

describe('resolveUpdateUrl', () => {
  it('dérive le canal depuis le dépôt public réservé aux binaires', () => {
    expect(resolveUpdateUrl({ RELEASES_REPOSITORY: 'anass/SubTranslateAI-releases' })).toBe(
      'https://github.com/anass/SubTranslateAI-releases/releases/latest/download',
    );
  });

  it('ne publie jamais implicitement depuis le dépôt source', () => {
    expect(resolveUpdateUrl({ GITHUB_REPOSITORY: 'anass/SubTranslateAI-source' })).toBe('');
    expect(resolveUpdateUrl({ RELEASES_REPOSITORY: 'nom invalide' })).toBe('');
  });

  it('accepte un hébergeur HTTPS explicite et refuse HTTP', () => {
    expect(resolveUpdateUrl({ SUBTRANSLATE_UPDATE_URL: 'https://updates.example/app/' })).toBe(
      'https://updates.example/app',
    );
    expect(() =>
      resolveUpdateUrl({ SUBTRANSLATE_UPDATE_URL: 'http://updates.example/app' }),
    ).toThrow(/HTTPS/u);
  });
});
