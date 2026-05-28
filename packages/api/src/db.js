// SQLite document store. Each collection is a table of (id, json) rows — a
// deliberate choice: the design's core principle is heterogeneity (every SaaS
// defines its own funnel/fields), so a schemaless document per collection fits
// far better than rigid columns. The repo interface below is the only thing the
// rest of the app touches, so swapping to Postgres/Supabase later is one file.

import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { COLLECTIONS } from "./seed-data.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const DB_PATH = process.env.COCKPIT_DB_PATH || join(DATA_DIR, "cockpit.db");

export const COLLECTION_NAMES = Object.keys(COLLECTIONS);

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

function createTables() {
  for (const name of COLLECTION_NAMES) {
    db.prepare(
      `CREATE TABLE IF NOT EXISTS "${name}" (
        id TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    ).run();
  }
}

function isEmpty(name) {
  return db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n === 0;
}

// Seed a collection from the design data if (and only if) it is empty, so a
// restart never clobbers data your SaaS has pushed in.
export function seedCollection(name, { force = false } = {}) {
  const rows = COLLECTIONS[name];
  if (!rows) throw new Error(`Unknown collection: ${name}`);
  if (force) db.prepare(`DELETE FROM "${name}"`).run();
  if (!force && !isEmpty(name)) return 0;
  const insert = db.prepare(`INSERT OR REPLACE INTO "${name}" (id, json) VALUES (?, ?)`);
  const tx = db.transaction((items) => {
    for (const item of items) insert.run(item.id, JSON.stringify(item));
  });
  tx(rows);
  return rows.length;
}

export function seedAll({ force = false } = {}) {
  const report = {};
  for (const name of COLLECTION_NAMES) report[name] = seedCollection(name, { force });
  return report;
}

export function initDb() {
  createTables();
  seedAll();
  return db;
}

// ── Repository ────────────────────────────────────────────────────────────
function assertCollection(name) {
  if (!COLLECTION_NAMES.includes(name)) {
    const err = new Error(`Unknown collection: ${name}`);
    err.statusCode = 404;
    throw err;
  }
}

export const repo = {
  list(name) {
    assertCollection(name);
    return db.prepare(`SELECT json FROM "${name}"`).all().map((r) => JSON.parse(r.json));
  },
  get(name, id) {
    assertCollection(name);
    const row = db.prepare(`SELECT json FROM "${name}" WHERE id = ?`).get(id);
    return row ? JSON.parse(row.json) : null;
  },
  create(name, obj) {
    assertCollection(name);
    const id = obj.id != null ? String(obj.id) : `${name.slice(0, 2)}_${Date.now().toString(36)}${Math.floor(performance.now() % 1000)}`;
    const record = { ...obj, id };
    db.prepare(`INSERT INTO "${name}" (id, json, updated_at) VALUES (?, ?, datetime('now'))`).run(id, JSON.stringify(record));
    return record;
  },
  update(name, id, patch) {
    assertCollection(name);
    const current = this.get(name, id);
    if (!current) return null;
    const record = { ...current, ...patch, id: current.id };
    db.prepare(`UPDATE "${name}" SET json = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(record), id);
    return record;
  },
  remove(name, id) {
    assertCollection(name);
    const info = db.prepare(`DELETE FROM "${name}" WHERE id = ?`).run(id);
    return info.changes > 0;
  },
};

export default db;
