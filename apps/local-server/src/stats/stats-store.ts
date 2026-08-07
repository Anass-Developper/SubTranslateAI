import type { Stats } from '@dual-subtitles/shared';

import type { TranslationCache } from '../cache/translation-cache.js';
import type { DatabaseConnection } from '../database/database.js';

export type CounterName =
  'translatedLines' | 'cacheHits' | 'cacheMisses' | 'apiRequests' | 'errors';

const COUNTERS: readonly CounterName[] = [
  'translatedLines',
  'cacheHits',
  'cacheMisses',
  'apiRequests',
  'errors',
];

export class StatsStore {
  readonly #database: DatabaseConnection;
  readonly #cache: TranslationCache;
  readonly #startedAt = Date.now();

  public constructor(database: DatabaseConnection, cache: TranslationCache) {
    this.#database = database;
    this.#cache = cache;
  }

  public increment(counter: CounterName, amount = 1): void {
    this.#database.handle
      .prepare(
        `INSERT INTO counters (counter_key, counter_value) VALUES (?, ?)
         ON CONFLICT(counter_key) DO UPDATE
         SET counter_value = counter_value + excluded.counter_value`,
      )
      .run(counter, amount);
  }

  public get(): Stats {
    const storedRows = this.#database.handle
      .prepare('SELECT counter_key, counter_value FROM counters')
      .all() as Array<{ counter_key: string; counter_value: number }>;
    const stored = new Map(storedRows.map((row) => [row.counter_key, row.counter_value]));
    const values = Object.fromEntries(COUNTERS.map((key) => [key, stored.get(key) ?? 0])) as Record<
      CounterName,
      number
    >;
    const lookups = values.cacheHits + values.cacheMisses;
    return {
      ...values,
      cacheEntries: this.#cache.count(),
      uptimeSeconds: Math.max(0, Math.floor((Date.now() - this.#startedAt) / 1_000)),
      cacheHitRate: lookups === 0 ? 0 : values.cacheHits / lookups,
    };
  }
}
