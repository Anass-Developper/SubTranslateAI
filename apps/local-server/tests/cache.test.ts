import { afterEach, describe, expect, it } from 'vitest';

import { TranslationCache, createTranslationCacheKey } from '../src/cache/translation-cache.js';
import { DatabaseConnection } from '../src/database/database.js';

describe('TranslationCache', () => {
  const connections: DatabaseConnection[] = [];
  afterEach(() => {
    for (const connection of connections.splice(0)) connection.close();
  });

  function setup(memoryEntries = 10): { database: DatabaseConnection; cache: TranslationCache } {
    const database = new DatabaseConnection(':memory:');
    connections.push(database);
    return { database, cache: new TranslationCache(database, memoryEntries) };
  }

  it('persiste et relit une traduction avec sa clé stable', () => {
    const { database, cache } = setup();
    const stored = cache.set('hello', 'en', ['fr', 'zh'], {
      sourceLanguage: 'en',
      fr: 'bonjour',
      zh: '你好',
    });
    expect(stored.cacheKey).toBe(createTranslationCacheKey('hello', 'en', ['zh', 'fr']));

    const freshMemory = new TranslationCache(database, 10);
    expect(freshMemory.get(stored.cacheKey)).toMatchObject({ fr: 'bonjour', zh: '你好' });
    expect(freshMemory.count()).toBe(1);
  });

  it("retrouve une langue source seulement lorsqu'elle est non ambiguë", () => {
    const { cache } = setup();
    cache.set('ciao', 'it', ['fr', 'zh'], {
      sourceLanguage: 'it',
      fr: 'salut',
      zh: '你好',
    });
    expect(cache.findUniqueSourceLanguage('ciao')).toBe('it');

    cache.set('ciao', 'fr', ['zh'], {
      sourceLanguage: 'fr',
      fr: 'ciao',
      zh: '你好',
    });
    expect(cache.findUniqueSourceLanguage('ciao')).toBeUndefined();
  });

  it('vide SQLite et la LRU', () => {
    const { cache } = setup();
    const item = cache.set('hello', 'en', ['fr', 'zh'], {
      sourceLanguage: 'en',
      fr: 'bonjour',
      zh: '你好',
    });
    expect(cache.clear()).toBe(1);
    expect(cache.get(item.cacheKey)).toBeUndefined();
    expect(cache.count()).toBe(0);
  });
});
