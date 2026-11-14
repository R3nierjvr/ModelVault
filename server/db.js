import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

export function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'modelvault.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS models (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      designer TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      cover TEXT,
      thumb TEXT,
      source TEXT NOT NULL DEFAULT 'upload',
      managed INTEGER NOT NULL DEFAULT 1,
      favorite INTEGER NOT NULL DEFAULT 0,
      file_count INTEGER NOT NULL DEFAULT 0,
      size INTEGER NOT NULL DEFAULT 0,
      kinds TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      builtin INTEGER NOT NULL DEFAULT 0,
      sort INTEGER NOT NULL DEFAULT 100
    );
    CREATE TABLE IF NOT EXISTS group_values (
      id INTEGER PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      name TEXT NOT NULL COLLATE NOCASE,
      UNIQUE(group_id, name)
    );
    CREATE TABLE IF NOT EXISTS model_values (
      model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
      value_id INTEGER NOT NULL REFERENCES group_values(id) ON DELETE CASCADE,
      PRIMARY KEY (model_id, value_id)
    );
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE
    );
    CREATE TABLE IF NOT EXISTS model_tags (
      model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (model_id, tag_id)
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  `);

  for (const sql of ['ALTER TABLE models ADD COLUMN year INTEGER', "ALTER TABLE models ADD COLUMN source_url TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE models ADD COLUMN stay INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE models ADD COLUMN archive_meta TEXT NOT NULL DEFAULT '{}'",
    'ALTER TABLE models ADD COLUMN no_ams INTEGER NOT NULL DEFAULT 0']) { // stay: left where it is by choice; archive_meta: part and scale chosen by hand per archive
    try { db.exec(sql); } catch { /* column already exists */ }
  }
  const seeded = db.prepare(`SELECT value FROM settings WHERE key='seeded'`).get();
  if (!seeded) {
    const builtins = {
      Type: ['Miniature', 'Bust', 'Figure & Statue', 'Terrain & Scenery', 'Functional / Tool', 'Household',
        'Organizer & Storage', 'Toy & Game', 'Articulated / Print-in-place', 'Cosplay & Prop', 'Decor & Art', 'Vehicle', 'Kit / Multi-part'],
      Franchise: ['Original', 'Warhammer', 'Dungeons & Dragons', 'Star Wars', 'Marvel', 'DC', 'Pokémon',
        'The Lord of the Rings', 'Harry Potter', 'Halo', 'Zelda', 'Transformers'],
      'Print Type': ['FDM', 'Resin', 'FDM & Resin'],
      Status: ['To print', 'Printing', 'Printed', 'Painted'],
    };
    let sort = 0;
    const insG = db.prepare('INSERT OR IGNORE INTO groups(name, builtin, sort) VALUES (?, 1, ?)');
    const getG = db.prepare('SELECT id FROM groups WHERE name = ?');
    const insV = db.prepare('INSERT OR IGNORE INTO group_values(group_id, name) VALUES (?, ?)');
    for (const [g, vals] of Object.entries(builtins)) {
      insG.run(g, sort++);
      const { id } = getG.get(g);
      for (const v of vals) insV.run(id, v);
    }
    db.prepare(`INSERT INTO settings(key, value) VALUES ('seeded', '1')`).run();
  }
  return db;
}

export function tx(db, fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
