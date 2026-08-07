import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';

const MIGRATION_SQL = `
  CREATE TABLE IF NOT EXISTS translation_cache (
    cache_key TEXT PRIMARY KEY,
    normalized_text TEXT NOT NULL,
    source_language TEXT NOT NULL,
    target_languages TEXT NOT NULL,
    fr TEXT NOT NULL,
    zh TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL,
    hit_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_translation_cache_lookup
    ON translation_cache(normalized_text, target_languages, last_used_at DESC);

  CREATE TABLE IF NOT EXISTS server_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS counters (
    counter_key TEXT PRIMARY KEY,
    counter_value INTEGER NOT NULL DEFAULT 0
  );
`;

export class DatabaseConnection {
  public readonly handle: Database.Database;
  #closed = false;

  public constructor(databasePath: string) {
    if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
    this.handle = new Database(databasePath);
    this.handle.pragma('foreign_keys = ON');
    this.handle.pragma('busy_timeout = 5000');
    if (databasePath !== ':memory:') this.handle.pragma('journal_mode = WAL');
    this.handle.exec(MIGRATION_SQL);
  }

  public assertHealthy(): void {
    const row = this.handle.prepare('SELECT 1 AS healthy').get() as { healthy: number } | undefined;
    if (row?.healthy !== 1) throw new Error('La base SQLite ne répond pas');
  }

  public close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.handle.close();
  }
}
