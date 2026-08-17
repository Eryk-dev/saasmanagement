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

// Índices dos filtros que o repo empurra pro Postgres (listWhere). Ficam aqui
// pra ambiente novo não nascer sem eles — em produção já existem (criados
// CONCURRENTLY em 25/07/2026), então isto é no-op no boot.
const INDEXES = [
  ["form_events_form_created_idx", "form_events", `((json->>'form'), (json->>'createdAt'))`],
  ["form_events_saas_created_idx", "form_events", `((json->>'saas'), (json->>'createdAt'))`],
  ["lp_events_saas_created_idx", "lp_events", `((json->>'saas'), (json->>'createdAt'))`],
  ["form_submissions_form_created_idx", "form_submissions", `((json->>'form'), (json->>'createdAt'))`],
  ["wa_messages_thread_idx", "wa_messages", `((json->>'thread'))`],
  ["activities_saas_type_idx", "activities", `((json->>'saas'), (json->>'type'))`],
  ["proposals_lead_origin_idx", "proposals", `((json->>'lead'), (json->>'origin'))`],
  ["proposals_shared_from_idx", "proposals", `((json->>'sharedFrom'))`],
];

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
  for (const [idx, name, expr] of INDEXES) {
    await getPool().query(`CREATE INDEX IF NOT EXISTS ${idx} ON ${tbl(name)} ${expr}`);
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
  invalidate(name); // seed escreve fora do repo — o cache de list() precisa cair junto
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
// Id gerado: prefixo + timestamp base36 + contador de desempate (2 chars). O
// contador elimina colisão em burst (2 creates no MESMO ms davam PK duplicada —
// era o motivo de activities/form_events precisarem de UUID próprio).
let idSeq = 0;
const genId = (name) => `${name.slice(0, 2)}_${Date.now().toString(36)}${(idSeq = (idSeq + 1) % 1296).toString(36).padStart(2, "0")}`;

// ── Cache de listagem ─────────────────────────────────────────────────────
// `list()` lê a tabela inteira, e o cockpit relê as mesmas coleções dezenas de
// milhares de vezes por semana (bootstrap, métricas, pollers) — foi o que
// estourou a cota de egress do Supabase em 25/07/2026 e derrubou o Levercopy,
// que divide o mesmo projeto. O cache guarda o JSON como TEXTO (o mesmo que o
// pg entrega no fio) e reparseia a cada chamada: quem consome recebe objetos
// novos, então mutação no chamador não contamina o cache.
//
// Invalidação é por escrita (create/update/remove/seed) — o processo da API é
// único (docker-compose: um container `api`), então write-through basta. O TTL
// é só rede de segurança pra escrita fora deste processo (psql, outra réplica).
const CACHE_TTL_MS = 60_000;
// Coleção grande demais não entra: form_events tem ~19k linhas / 10 MB, e
// reparsear isso a cada chamada custaria mais CPU do que a leitura economiza.
// Quem é grande assim deve usar listWhere (filtro no Postgres), não list().
const CACHE_MAX_BYTES = 8 * 1024 * 1024;
const CACHE_ON = process.env.COCKPIT_LIST_CACHE !== "0";
const listCache = new Map(); // name -> { raw: string[], at: number }

function invalidate(name) {
  listCache.delete(name);
}

const RANGE_OPS = { gte: ">=", lte: "<=", gt: ">", lt: "<" };

export const repo = {
  async list(name) {
    const hit = CACHE_ON ? listCache.get(name) : null;
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.raw.map((s) => JSON.parse(s));
    // ORDER BY id: sem ele a ordem é a do heap do Postgres, que muda quando uma
    // linha é atualizada — e SAAS[0]/bootstrap dependem de ordem estável entre
    // produtos ("leverads" < "uniquekids"). Telas que precisam de outra ordem
    // já ordenam no cliente.
    // json::text: o pg já entrega jsonb como texto e parseia no cliente — pedir
    // o texto só antecipa isso pra poder cachear a string crua.
    const { rows } = await getPool().query(`SELECT json::text AS json FROM ${tbl(name)} ORDER BY id`);
    const raw = rows.map((r) => r.json);
    if (CACHE_ON) {
      const bytes = raw.reduce((n, s) => n + s.length, 0);
      if (bytes <= CACHE_MAX_BYTES) listCache.set(name, { raw, at: Date.now() });
      else listCache.delete(name);
    }
    return raw.map((s) => JSON.parse(s));
  },
  // Lista com o filtro NO POSTGRES, em vez de trazer a tabela e filtrar em JS.
  // `where`: { chave: valor } = igualdade; { chave: { gte, lte, gt, lt } } =
  // faixa (comparação de TEXTO — vale pra ISO 8601 e "YYYY-MM-DD", que ordenam
  // lexicograficamente). `fields`: projeta só essas chaves (+ id), pra não
  // arrastar campo grande e não usado (ex.: `ua` em form_events).
  // Sem cache de propósito: o resultado é estreito e a coleção que precisa
  // disso (form_events) recebe escrita o tempo todo.
  async listWhere(name, where = {}, { fields } = {}) {
    const params = [];
    const param = (v) => (params.push(v), `$${params.length}`);
    const conds = [];
    for (const [key, val] of Object.entries(where)) {
      if (val === undefined || val === null || val === "") continue;
      const k = param(key);
      if (typeof val === "object" && !Array.isArray(val)) {
        for (const [op, bound] of Object.entries(val)) {
          if (!RANGE_OPS[op] || bound === undefined || bound === null || bound === "") continue;
          conds.push(`json->>(${k}::text) ${RANGE_OPS[op]} ${param(String(bound))}`);
        }
      } else {
        conds.push(`json->>(${k}::text) = ${param(String(val))}`);
      }
    }
    let select = "json::text AS json";
    if (Array.isArray(fields)) { // `[]` = só o id (achar a linha), não "sem projeção"
      const parts = [...new Set(["id", ...fields])].map((f) => {
        const k = param(f);
        return `${k}::text, json->(${k}::text)`;
      });
      select = `jsonb_build_object(${parts.join(", ")})::text AS json`;
    }
    const sql = `SELECT ${select} FROM ${tbl(name)}${conds.length ? ` WHERE ${conds.join(" AND ")}` : ""} ORDER BY id`;
    const { rows } = await getPool().query(sql, params);
    return rows.map((r) => JSON.parse(r.json));
  },
  async get(name, id) {
    const { rows } = await getPool().query(`SELECT json FROM ${tbl(name)} WHERE id = $1`, [String(id)]);
    return rows.length ? rows[0].json : null;
  },
  async create(name, obj) {
    const id = obj.id != null ? String(obj.id) : genId(name);
    const record = { ...obj, id };
    await getPool().query(`INSERT INTO ${tbl(name)} (id, json) VALUES ($1, $2::jsonb)`, [id, JSON.stringify(record)]);
    invalidate(name);
    bump(name);
    return record;
  },
  // `silent: true` grava SEM acordar o tempo real (bump): pra escrita de alta
  // frequência que nenhuma tela lê do SEED — recibo de status do WhatsApp,
  // marcação de lido — que estava recarregando o cockpit INTEIRO de todo
  // usuário conectado a cada evento (Leo, 04/08: "fica dando uns pequenos
  // refresh"). O cache local invalida do mesmo jeito (a leitura seguinte vê).
  async update(name, id, patch, { silent = false } = {}) {
    const current = await this.get(name, id);
    if (!current) return null;
    const record = { ...current, ...patch, id: current.id };
    await getPool().query(`UPDATE ${tbl(name)} SET json = $1::jsonb, updated_at = now() WHERE id = $2`, [JSON.stringify(record), String(id)]);
    invalidate(name);
    if (!silent) bump(name);
    return record;
  },
  async remove(name, id) {
    const { rowCount } = await getPool().query(`DELETE FROM ${tbl(name)} WHERE id = $1`, [String(id)]);
    if (rowCount > 0) { invalidate(name); bump(name); }
    return rowCount > 0;
  },
};

// Consulta crua no MESMO Postgres, para ler o que NÃO é coleção do cockpit: o
// Levercopy (o produto LeverAds) vive no schema `public` deste mesmo banco, e o
// deck da proposta mostra os resultados reais dos clientes de lá
// (leverads-results.js). Use com parcimônia e sempre com cache: dividir o
// projeto com o Levercopy é o que estourou a cota de egress em 25/07/2026.
export async function rawQuery(sql, params = []) {
  const { rows } = await getPool().query(sql, params);
  return rows;
}
