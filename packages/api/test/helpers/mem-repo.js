// In-memory repo double for tests — mirrors the async db.js repo interface so the
// route/levercopy tests run offline (no Postgres). Same semantics as db.js: async,
// stores plain JSON records, same id generation, returns clones.
export function makeMemRepo() {
  const store = new Map(); // name -> Map(id -> record)
  const col = (name) => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name);
  };
  return {
    async list(name) {
      return [...col(name).values()].map((r) => ({ ...r }));
    },
    async get(name, id) {
      const r = col(name).get(String(id));
      return r ? { ...r } : null;
    },
    async create(name, obj) {
      const id = obj.id != null ? String(obj.id) : `${name.slice(0, 2)}_${Date.now().toString(36)}${Math.floor(performance.now() % 1000)}`;
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
