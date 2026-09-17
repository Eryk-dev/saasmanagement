// Cache em memória por chave com TTL e stale-while-revalidate.
//
// Serve pra resposta de serviço externo (Graph do Instagram/Meta, Cloud API do
// WhatsApp) que custa segundos e muda devagar: a tela não pode esperar a rede
// a cada abertura. A API roda em processo único (ver db.js), então o Map basta.
//
// Regras:
// - fresco (idade < ttl): devolve o valor guardado, sem chamar o loader.
// - velho (ttl <= idade < staleTtl): devolve o valor velho NA HORA e dispara o
//   loader atrás pra renovar (uma revalidação por vez por chave).
// - vencido ou ausente: espera o loader.
// - chamadas concorrentes na mesma chave dividem a mesma promise.
// - loader falhou com valor guardado: mantém o velho (não envenena o cache);
//   sem valor guardado: rejeita e a chave some (a próxima tenta de novo).
// - `force` ignora o TTL (o botão "atualizar" da tela).
//
// `now` é injetável pra testar TTL sem esperar o relógio.
export function makeTtlCache({ ttl, staleTtl = ttl * 10, now = Date.now } = {}) {
  if (!(ttl > 0)) throw new Error("makeTtlCache: ttl em ms é obrigatório");
  const map = new Map(); // key -> { at, value, promise }

  function load(key, loader, prev) {
    const p = Promise.resolve()
      .then(loader)
      .then((value) => {
        map.set(key, { at: now(), value, promise: null });
        return value;
      })
      .catch((err) => {
        if (prev && prev.at) { prev.promise = null; return prev.value; }
        map.delete(key);
        throw err;
      });
    return p;
  }

  // Devolve { value, status } com status = hit | stale | miss (vira o header
  // x-cache nas rotas, pra medir no DevTools sem log).
  async function getWithMeta(key, loader, { force = false } = {}) {
    const hit = map.get(key);
    const age = hit && hit.at ? now() - hit.at : Infinity;
    if (hit && hit.at && !force && age < ttl) return { value: hit.value, status: "hit" };
    // Revalidação já em curso: quem tem valor recebe o velho, quem não tem espera.
    if (hit && hit.promise) {
      if (hit.at) return { value: hit.value, status: "stale" };
      return { value: await hit.promise, status: "miss" };
    }
    if (hit && hit.at) {
      // Tem valor guardado: renova por trás. Dentro do staleTtl responde o
      // velho na hora; vencido (ou `force`) espera o novo, mas a falha ainda
      // cai no velho em vez de estourar.
      hit.promise = load(key, loader, hit);
      if (!force && age < staleTtl) return { value: hit.value, status: "stale" };
      return { value: await hit.promise, status: "miss" };
    }
    const entry = { at: 0, value: undefined, promise: null };
    map.set(key, entry);
    entry.promise = load(key, loader, null);
    return { value: await entry.promise, status: "miss" };
  }

  const get = (key, loader, opts) => getWithMeta(key, loader, opts).then((r) => r.value);
  return {
    get,
    getWithMeta,
    has: (key) => { const h = map.get(key); return !!(h && h.at); },
    invalidate: (key) => map.delete(key),
    clear: () => map.clear(),
  };
}
