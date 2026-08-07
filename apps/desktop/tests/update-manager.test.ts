import { describe, expect, it } from 'vitest';

import { normalizeUpdateUrl } from '../src/update-manager.js';

describe('normalizeUpdateUrl', () => {
  it('accepte uniquement un canal HTTPS', () => {
    expect(normalizeUpdateUrl('https://example.com/releases/latest/download/')).toBe(
      'https://example.com/releases/latest/download',
    );
    expect(normalizeUpdateUrl('http://example.com/update')).toBeNull();
    expect(normalizeUpdateUrl('file:///tmp/update')).toBeNull();
  });

  it('désactive proprement une configuration absente ou invalide', () => {
    expect(normalizeUpdateUrl('')).toBeNull();
    expect(normalizeUpdateUrl(undefined)).toBeNull();
    expect(normalizeUpdateUrl('pas une url')).toBeNull();
  });
});
