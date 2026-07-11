// Postgres (Supabase) document store. Each collection is a table of (id, json) rows
// in the dedicated `cockpit` schema — a deliberate choice: the design's core principle
// is heterogeneity (every SaaS defines its own funnel/fields), so a schemaless jsonb
// document per collection fits far better than rigid columns. The repo interface below
// is the only thing the rest of the app touches, so the storage engine stays swappable.

import pg from "pg";
import { COLLECTIONS } from "./seed-data.js";
import { bump } from "./changes.js";

const SCHEMA = "cockpit";

// Lazy pool: created on first query, not at import. Keeps `import` side-effect-free
// (so importing COLLECTION_NAMES/repo never connects or throws), and fails fast with a
// clear message the moment something actually needs the DB without COCKPIT_DB_URL set.
let _pool;
function getPool() {
  if (!_pool) {
    if (!process.env.COCKPIT_DB_URL) {
      throw new Error("COCKPIT_DB_URL is required (Supabase Postgres connection string).");
    }
    // Strip any `sslmode`/`ssl` query param so the explicit ssl option below wins — newer
    // pg treats sslmode=require as verify-full, which rejects Supabase's CA chain. We
    // encrypt without chain verification (same posture as the copylever app's asyncpg DSN).
    const url = new URL(process.env.COCKPIT_DB_URL);
    const sslDisabled = url.searchParams.get("sslmode") === "disable";
    url.searchParams.delete("sslmode");
    url.searchParams.delete("ssl");
    _pool = new pg.Pool({
      connectionString: url.toString(),
      // sslmode=disable permite Postgres local (dev) sem SSL.
      ssl: sslDisabled ? false : { rejectUnauthorized: false },
    });
  }
  return _pool;
}

export const COLLECTION_NAMES = Object.keys(COLLECTIONS);

// Schema-qualified, quoted table name — only ever for a known collection, which guards
// the dynamic identifier against injection (the table name is never user input).
function tbl(name) {
  if (!COLLECTION_NAMES.includes(name)) {
    const err = new Error(`Unknown collection: ${name}`);
    err.statusCode = 404;
    throw err;
  }
  return `${SCHEMA}."${name}"`;
}

async function createTables() {
  await getPool().query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  for (const name of COLLECTION_NAMES) {
    await getPool().query(
      `CREATE TABLE IF NOT EXISTS ${tbl(name)} (
        id TEXT PRIMARY KEY,
        json JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    );
  }
}

async function isEmpty(name) {
  const { rows } = await getPool().query(`SELECT COUNT(*)::int AS n FROM ${tbl(name)}`);
  return rows[0].n === 0;
}

// Seed a collection from the design data if (and only if) it is empty, so a restart
// never clobbers data your SaaS has pushed in.
export async function seedCollection(name, { force = false, rows } = {}) {
  const items = rows ?? COLLECTIONS[name];
  if (!items) throw new Error(`Unknown collection: ${name}`);
  if (force) await getPool().query(`DELETE FROM ${tbl(name)}`);
  if (!force && !(await isEmpty(name))) return 0;
  for (const item of items) {
    await getPool().query(
      `INSERT INTO ${tbl(name)} (id, json) VALUES ($1, $2::jsonb)
       ON CONFLICT (id) DO UPDATE SET json = EXCLUDED.json, updated_at = now()`,
      [String(item.id), JSON.stringify(item)]
    );
  }
  return items.length;
}

export async function seedAll({ force = false } = {}) {
  const report = {};
  for (const name of COLLECTION_NAMES) report[name] = await seedCollection(name, { force });
  return report;
}

// Force-load an arbitrary collections object (e.g. the demo dataset). Tables already
// exist (createTables uses the default COLLECTIONS keys, which match).
export async function seedExternal(collectionsObj, { force = true } = {}) {
  const report = {};
  for (const name of Object.keys(collectionsObj)) {
    if (!COLLECTION_NAMES.includes(name)) continue;
    report[name] = await seedCollection(name, { force, rows: collectionsObj[name] });
  }
  return report;
}

export async function initDb() {
  await createTables();
  await seedAll();
  return getPool();
}

// ── Repository ────────────────────────────────────────────────────────────
export const repo = {
  async list(name) {
    // ORDER BY id: sem ele a ordem é a do heap do Postgres, que muda quando uma
    // linha é atualizada — e SAAS[0]/bootstrap dependem de ordem estável entre
    // produtos ("leverads" < "uniquekids"). Telas que precisam de outra ordem
    // já ordenam no cliente.
    const { rows } = await getPool().query(`SELECT json FROM ${tbl(name)} ORDER BY id`);
    return rows.map((r) => r.json);
  },
  async get(name, id) {
    const { rows } = await getPool().query(`SELECT json FROM ${tbl(name)} WHERE id = $1`, [String(id)]);
    return rows.length ? rows[0].json : null;
  },
  async create(name, obj) {
    const id = obj.id != null ? String(obj.id) : `${name.slice(0, 2)}_${Date.now().toString(36)}${Math.floor(performance.now() % 1000)}`;
    const record = { ...obj, id };
    await getPool().query(`INSERT INTO ${tbl(name)} (id, json) VALUES ($1, $2::jsonb)`, [id, JSON.stringify(record)]);
    bump(name);
    return record;
  },
  async update(name, id, patch) {
    const current = await this.get(name, id);
    if (!current) return null;
    const record = { ...current, ...patch, id: current.id };
    await getPool().query(`UPDATE ${tbl(name)} SET json = $1::jsonb, updated_at = now() WHERE id = $2`, [JSON.stringify(record), String(id)]);
    bump(name);
    return record;
  },
  async remove(name, id) {
    const { rowCount } = await getPool().query(`DELETE FROM ${tbl(name)} WHERE id = $1`, [String(id)]);
    if (rowCount > 0) bump(name);
    return rowCount > 0;
  },
};
