// Leitura compartilhada apenas durante UM cálculo de métricas. Os cálculos
// aninhados (placar → pace → bônus) reutilizam as promessas e os registros;
// a próxima requisição lê de novo, inclusive depois de uma escrita.
const readers = new WeakMap();

export function metricsReader(repo, saas) {
  if (readers.get(repo) === saas) return repo;
  const pending = new Map();
  const once = (key, read) => {
    if (!pending.has(key)) pending.set(key, Promise.resolve().then(read));
    return pending.get(key);
  };
  const reader = {
    list(name) {
      return once(`list:${name}`, () => {
        if (name === "activities") {
          return repo.listWhere(name, { saas }, { fields: ["saas", "lead", "type", "at", "author", "meta"] });
        }
        if (name === "wa_messages") {
          // Mensagens antigas podem não ter saas. Os helpers fazem o vínculo
          // pelo lead e preservam esse legado; conteúdo/mídia não são usados.
          return repo.listWhere(name, {}, { fields: ["saas", "leadId", "direction", "at", "author"] });
        }
        if (name === "proposals") {
          return repo.listWhere(name, { saas }, { fields: ["saas", "createdAt"] });
        }
        return repo.list(name);
      });
    },
    listWhere(...args) {
      return once(`where:${JSON.stringify(args)}`, () => repo.listWhere(...args));
    },
  };
  // O compute-cache.js precisa do repo de verdade (o leitor nasce por
  // requisição): `base` é a chave do cache e `writeRev` a régua de validade.
  reader.base = repo.base || repo;
  if (typeof reader.base.writeRev === "function") reader.writeRev = () => reader.base.writeRev();
  readers.set(reader, saas);
  return reader;
}
