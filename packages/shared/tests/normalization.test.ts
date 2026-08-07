import { describe, expect, it } from 'vitest';

import { SubtitleDeduplicator, isDuplicateSubtitle, normalizeSubtitleText } from '../src/index.js';

describe('normalizeSubtitleText', () => {
  it('retire les balises techniques et stabilise les espaces', () => {
    expect(normalizeSubtitleText('  <i>Hello</i>\r\n<c.yellow> world </c>\u200b ')).toBe(
      'Hello world',
    );
  });

  it('décode les entités usuelles sans perdre la ponctuation', () => {
    expect(normalizeSubtitleText('Tom &amp; Jerry: &quot;Hi!&quot;')).toBe('Tom & Jerry: "Hi!"');
  });
});

describe('déduplication', () => {
  it('compare une forme normalisée', () => {
    expect(isDuplicateSubtitle('<i>BONJOUR</i>', 'bonjour')).toBe(true);
  });

  it('laisse repasser une réplique après le TTL', () => {
    const deduplicator = new SubtitleDeduplicator(100);
    expect(deduplicator.isDuplicate('Encore', 0)).toBe(false);
    expect(deduplicator.isDuplicate(' encore ', 50)).toBe(true);
    expect(deduplicator.isDuplicate('Encore', 200)).toBe(false);
  });
});
