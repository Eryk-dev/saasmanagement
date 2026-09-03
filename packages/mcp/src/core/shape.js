// Corte e agregação das listas ANTES de responder. A API devolve a coleção
// inteira em /api/:collection (sem paginação nem projeção), então quem tem que
// recortar é o MCP — e é bom que seja aqui: o MCP roda no mesmo container da
// API, então filtrar mil leads custa memória local e economiza uma resposta
// gigante que ninguém consegue ler nem citar direito num relatório.

export const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export const round2 = (n) => Math.round(n * 100) / 100;

// Caminho com ponto ("customer.name") — vários registros aninham.
export function at(obj, path) {
  if (!obj || !path) return undefined;
  if (!String(path).includes(".")) return obj[path];
  return String(path).split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
}

export function pick(obj, fields) {
  if (!Array.isArray(fields) || !fields.length) return obj;
  const out = {};
  for (const f of fields) {
    const v = at(obj, f);
    if (v !== undefined) out[f] = v;
  }
  if (obj?.id !== undefined && out.id === undefined) out.id = obj.id;
  return out;
}

const asText = (v) => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

// where: { campo: valor } | { campo: { in:[], not:, gte:, lte:, gt:, lt:, contains:, exists: } }
export function matches(row, where = {}) {
  for (const [key, cond] of Object.entries(where || {})) {
    if (cond === undefined || cond === null || cond === "") continue;
    const v = at(row, key);
    if (cond && typeof cond === "object" && !Array.isArray(cond)) {
      if (cond.exists !== undefined && (v === undefined || v === null || v === "") === !!cond.exists) return false;
      if (cond.in && !cond.in.map(String).includes(String(v))) return false;
      if (cond.not !== undefined && String(v) === String(cond.not)) return false;
      if (cond.gte !== undefined && !(asText(v) >= String(cond.gte))) return false;
      if (cond.lte !== undefined && !(asText(v) <= String(cond.lte))) return false;
      if (cond.gt !== undefined && !(asText(v) > String(cond.gt))) return false;
      if (cond.lt !== undefined && !(asText(v) < String(cond.lt))) return false;
      if (cond.contains && !asText(v).toLowerCase().includes(String(cond.contains).toLowerCase())) return false;
    } else if (Array.isArray(cond)) {
      if (!cond.map(String).includes(String(v))) return false;
    } else if (String(v) !== String(cond)) return false;
  }
  return true;
}

// Busca livre: varre os campos indicados (ou o registro inteiro) — é como o
// humano procura ("acha o lead da Drift") sem saber em que campo está.
export function search(rows, q, fields) {
  if (!q) return rows;
  const needle = String(q).toLowerCase();
  return rows.filter((r) =>
    (fields?.length ? fields.map((f) => asText(at(r, f))) : [JSON.stringify(r)])
      .join(" ").toLowerCase().includes(needle));
}

// sort: "campo" | "campo:desc" | ["a:desc","b"]
export function sortRows(rows, sort) {
  const specs = (Array.isArray(sort) ? sort : [sort]).filter(Boolean).map((s) => {
    const [field, dir] = String(s).split(":");
    return { field, desc: String(dir || "").toLowerCase() === "desc" };
  });
  if (!specs.length) return rows;
  return [...rows].sort((a, b) => {
    for (const { field, desc } of specs) {
      const x = at(a, field);
      const y = at(b, field);
      const bothNum = Number.isFinite(Number(x)) && Number.isFinite(Number(y)) && x !== "" && y !== "" && x != null && y != null;
      const cmp = bothNum ? Number(x) - Number(y) : asText(x).localeCompare(asText(y), "pt-BR");
      if (cmp) return desc ? -cmp : cmp;
    }
    return 0;
  });
}

// O recorte completo. Devolve as linhas e o bloco `page` — que diz em voz alta
// quando cortou, porque silêncio aqui vira relatório com número errado.
export function select(all, { where, q, qFields, sort, fields, limit = 50, offset = 0 } = {}) {
  let rows = Array.isArray(all) ? all : [];
  const total0 = rows.length;
  if (where) rows = rows.filter((r) => matches(r, where));
  if (q) rows = search(rows, q, qFields);
  const matched = rows.length;
  if (sort) rows = sortRows(rows, sort);
  const lim = Math.max(0, Math.min(Number(limit) || 50, 1000));
  const off = Math.max(0, Number(offset) || 0);
  const page = rows.slice(off, off + lim);
  return {
    rows: fields?.length ? page.map((r) => pick(r, fields)) : page,
    page: {
      total: matched,
      totalBeforeFilter: total0,
      returned: page.length,
      limit: lim,
      offset: off,
      truncated: matched > off + page.length,
    },
  };
}

// Agrupa e soma: a base de qualquer tabela de relatório ("gasto por campanha").
// `derive` recebe o grupo somado e devolve as métricas calculadas (CPL, ROAS…),
// que é o que evita o consumidor dividir errado.
export function groupBy(rows, { by, sum = [], count = "count", label, derive } = {}) {
  const keyOf = typeof by === "function" ? by : (r) => asText(at(r, by)) || "—";
  const map = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    let g = map.get(k);
    if (!g) { g = { [label || (typeof by === "string" ? by : "grupo")]: k, [count]: 0 }; map.set(k, g); }
    g[count] += 1;
    for (const f of sum) g[f] = round2((g[f] || 0) + num(at(r, f)));
  }
  const out = [...map.values()];
  return derive ? out.map((g) => ({ ...g, ...derive(g) })) : out;
}

export function totalsOf(rows, fields) {
  const t = {};
  for (const f of fields) t[f] = round2(rows.reduce((a, r) => a + num(at(r, f)), 0));
  return t;
}
