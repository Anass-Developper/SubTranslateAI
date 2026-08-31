import { createHash } from 'node:crypto';

import type { ProviderTranslation, TargetLanguage } from '@dual-subtitles/shared';

import type { DatabaseConnection } from '../database/database.js';
import { MemoryLru } from './memory-lru.js';

interface CacheRow {
  cache_key: string;
  normalized_text: string;
  source_language: string;
  target_languages: string;
  fr: string;
  zh: string;
  created_at: number;
  last_used_at: number;
  hit_count: number;
}

export interface CachedTranslation extends ProviderTranslation {
  readonly cacheKey: string;
}

export function createTranslationCacheKey(
  normalizedText: string,
  sourceLanguage: string,
  targetLanguages: readonly TargetLanguage[],
): string {
  const stableTargets = [...targetLanguages].sort().join(',');
  return createHash('sha256')
    .update(`${normalizedText}\u0000${sourceLanguage}\u0000${stableTargets}`, 'utf8')
    .digest('hex');
}

function targetsKey(targetLanguages: readonly TargetLanguage[]): string {
  return [...targetLanguages].sort().join(',');
}

function fromRow(row: CacheRow): CachedTranslation {
  return {
    cacheKey: row.cache_key,
    sourceLanguage: row.source_language,
    fr: row.fr,
    zh: row.zh,
  };
}

export class TranslationCache {
  readonly #database: DatabaseConnection;
  readonly #memory: MemoryLru<string, CachedTranslation>;

  public constructor(database: DatabaseConnection, memoryEntries: number) {
    this.#database = database;
    this.#memory = new MemoryLru(memoryEntries);
  }

  public get(cacheKey: string): CachedTranslation | undefined {
    const memoryValue = this.#memory.get(cacheKey);
    if (memoryValue) {
      this.#touch(cacheKey);
      return memoryValue;
    }

    const row = this.#database.handle
      .prepare('SELECT * FROM translation_cache WHERE cache_key = ?')
      .get(cacheKey) as CacheRow | undefined;
    if (!row) return undefined;

    const value = fromRow(row);
    this.#memory.set(cacheKey, value);
    this.#touch(cacheKey);
    return value;
  }

  public findUniqueSourceLanguage(normalizedText: string): string | undefined {
    const rows = this.#database.handle
      .prepare(
        `SELECT DISTINCT source_language
         FROM translation_cache
         WHERE normalized_text = ?
         LIMIT 2`,
      )
      .all(normalizedText) as Array<{ source_language: string }>;
    return rows.length === 1 ? rows[0]?.source_language : undefined;
  }

  public set(
    normalizedText: string,
    sourceLanguage: string,
    targetLanguages: readonly TargetLanguage[],
    translation: ProviderTranslation,
  ): CachedTranslation {
    const cacheKey = createTranslationCacheKey(normalizedText, sourceLanguage, targetLanguages);
    const now = Date.now();
    this.#database.handle
      .prepare(
        `INSERT INTO translation_cache (
           cache_key, normalized_text, source_language, target_languages,
           fr, zh, created_at, last_used_at, hit_count
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(cache_key) DO UPDATE SET
           fr = excluded.fr,
           zh = excluded.zh,
           last_used_at = excluded.last_used_at`,
      )
      .run(
        cacheKey,
        normalizedText,
        sourceLanguage,
        targetsKey(targetLanguages),
        translation.fr,
        translation.zh,
        now,
        now,
      );
    const cached = { cacheKey, ...translation, sourceLanguage };
    this.#memory.set(cacheKey, cached);
    return cached;
  }

  public clear(): number {
    const result = this.#database.handle.prepare('DELETE FROM translation_cache').run();
    this.#memory.clear();
    return result.changes;
  }

  public delete(cacheKey: string): boolean {
    this.#memory.delete(cacheKey);
    return (
      this.#database.handle
        .prepare('DELETE FROM translation_cache WHERE cache_key = ?')
        .run(cacheKey).changes > 0
    );
  }

  public count(): number {
    const row = this.#database.handle
      .prepare('SELECT COUNT(*) AS count FROM translation_cache')
      .get() as { count: number };
    return row.count;
  }

  public resizeMemory(maximumEntries: number): void {
    this.#memory.resize(maximumEntries);
  }

  #touch(cacheKey: string): void {
    this.#database.handle
      .prepare(
        `UPDATE translation_cache
         SET hit_count = hit_count + 1, last_used_at = ?
         WHERE cache_key = ?`,
      )
      .run(Date.now(), cacheKey);
  }
}
