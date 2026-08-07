import {
  DEFAULT_SERVER_SETTINGS,
  ServerSettingsSchema,
  type ServerSettings,
  type UpdateServerSettings,
} from '@dual-subtitles/shared';

import type { DatabaseConnection } from '../database/database.js';

interface SettingRow {
  setting_key: string;
  setting_value: string;
}

export class SettingsStore {
  readonly #database: DatabaseConnection;
  readonly #environmentDefaults: Partial<ServerSettings>;

  public constructor(
    database: DatabaseConnection,
    environmentDefaults: Partial<ServerSettings> = {},
  ) {
    this.#database = database;
    this.#environmentDefaults = environmentDefaults;
  }

  public get(): ServerSettings {
    const values: Record<string, unknown> = {
      ...DEFAULT_SERVER_SETTINGS,
      ...this.#environmentDefaults,
    };
    const rows = this.#database.handle
      .prepare('SELECT setting_key, setting_value FROM server_settings')
      .all() as SettingRow[];
    for (const row of rows) values[row.setting_key] = JSON.parse(row.setting_value) as unknown;
    return ServerSettingsSchema.parse(values);
  }

  public update(patch: UpdateServerSettings): ServerSettings {
    const current = this.get();
    const next = ServerSettingsSchema.parse({ ...current, ...patch });
    const statement = this.#database.handle.prepare(
      `INSERT INTO server_settings (setting_key, setting_value)
       VALUES (?, ?)
       ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`,
    );
    const save = this.#database.handle.transaction(() => {
      for (const [key, value] of Object.entries(patch)) {
        statement.run(key, JSON.stringify(value));
      }
    });
    save();
    return next;
  }
}
