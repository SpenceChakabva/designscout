import Database from 'better-sqlite3';
import type { DesignScoutConfig } from '../shared/types.js';
import { dbPath } from '../shared/config.js';

let _db: Database.Database | null = null;

export function getDb(config: DesignScoutConfig): Database.Database {
  if (_db) return _db;

  _db = new Database(dbPath(config));
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  migrate(_db);
  return _db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT,
      captured_at TEXT DEFAULT (datetime('now')),
      viewport TEXT DEFAULT '1440x900',
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS screenshots (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      scroll_position INTEGER NOT NULL,
      filepath TEXT NOT NULL,
      section_label TEXT,
      width INTEGER,
      height INTEGER
    );

    CREATE TABLE IF NOT EXISTS patterns (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      subcategory TEXT,
      data TEXT NOT NULL,
      description TEXT,
      confidence REAL DEFAULT 0.0
    );

    CREATE TABLE IF NOT EXISTS tokens (
      id TEXT PRIMARY KEY,
      site_id TEXT REFERENCES sites(id) ON DELETE SET NULL,
      token_set TEXT NOT NULL,
      format TEXT DEFAULT 'json',
      generated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_screenshots_site ON screenshots(site_id);
    CREATE INDEX IF NOT EXISTS idx_patterns_site ON patterns(site_id);
    CREATE INDEX IF NOT EXISTS idx_patterns_category ON patterns(category);
  `);
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
