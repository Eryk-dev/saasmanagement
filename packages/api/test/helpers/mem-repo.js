// In-memory repo double for tests — mirrors the async db.js repo interface so the
// route/levercopy tests run offline (no Postgres). Same semantics as db.js: async,
// stores plain JSON records, same id generation, returns clones.
export function makeMemRepo() {
  const store = new Map(); // name -> Map(id -> record)
  let seq = 0;             // desempate de ids criados no mesmo ms (espelha db.js)
  const col = (name) => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name);
  };
  return {
    async list(name) {
      // Mesma semântica do db.js: ORDER BY id (ordem estável entre produtos).
      return [...col(name).values()].map((r) => ({ ...r })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    },
    // Espelha listWhere do db.js: igualdade por chave e faixa { gte, lte, gt, lt }
    // comparadas como TEXTO (é o que `json->>` faz no Postgres), + projeção.
    async listWhere(name, where = {}, { fields } = {}) {
      const CMP = { gte: (a, b) => a >= b, lte: (a, b) => a <= b, gt: (a, b) => a > b, lt: (a, b) => a < b };
      const rows = (await this.list(name)).filter((r) =>
        Object.entries(where).every(([key, val]) => {
          if (val === undefined || val === null || val === "") return true;
          const got = r[key] === undefined || r[key] === null ? null : String(r[key]);
          if (typeof val === "object" && !Array.isArray(val)) {
            return Object.entries(val).every(([op, bound]) =>
              !CMP[op] || bound === undefined || bound === null || bound === "" ? true : got !== null && CMP[op](got, String(bound)));
          }
          return got === String(val);
        }));
      if (!Array.isArray(fields)) return rows; // `[]` = só o id (espelha o db.js)
      const keys = [...new Set(["id", ...fields])];
      return rows.map((r) => Object.fromEntries(keys.map((k) => [k, r[k] === undefined ? null : r[k]])));
    },
    async get(name, id) {
      const r = col(name).get(String(id));
      return r ? { ...r } : null;
    },
    async create(name, obj) {
      // Espelha o genId do db.js: timestamp + contador de desempate (sem colisão em burst).
      const id = obj.id != null ? String(obj.id) : `${name.slice(0, 2)}_${Date.now().toString(36)}${(seq = (seq + 1) % 1296).toString(36).padStart(2, "0")}`;
      const record = { ...obj, id };
      col(name).set(id, record);
      return { ...record };
    },
    async update(name, id, patch) {
      const cur = col(name).get(String(id));
      if (!cur) return null;
      const record = { ...cur, ...patch, id: cur.id };
      col(name).set(String(id), record);
      return { ...record };
    },
    async remove(name, id) {
      return col(name).delete(String(id));
    },
  };
}
