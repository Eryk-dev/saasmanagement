// Cache de leitura no cliente com stale-while-revalidate (SWR), sem lib.
//
// Pra que: a tela que sai e volta (ou troca de período e volta) mostrava
// "carregando…" e refazia o fetch inteiro, mesmo quando o dado tinha segundos
// de idade. Aqui o dado guardado aparece NA HORA e a revalidação corre atrás.
//
// - `key` identifica a leitura (inclua o produto: "social/summary/leverads/30").
//   null/"" desliga o hook (data undefined, loading false).
// - `ttl` (ms): mais novo que isso não refaz o fetch ao montar.
// - `revalidateOn`: mudou (ex.: `version` do SSE) → revalida mesmo dentro do ttl.
// - concorrentes na mesma chave dividem a promise (o StrictMode em dev também
//   deixa de bater duas vezes).
// - erro com dado guardado mantém o dado e expõe `error`; sem dado, `error`.
//
// No SSR (smoke) o efeito não roda: `data` fica undefined, como o estado
// inicial de antes.
import React from "react";

const store = new Map(); // key -> { at, value, error, promise }
const listeners = new Map(); // key -> Set<fn>

function emit(key) {
  for (const fn of listeners.get(key) || []) fn();
}

function revalidate(key, fetcher) {
  const e = store.get(key) || { at: 0, value: undefined, error: null, promise: null };
  if (e.promise) return e.promise;
  e.promise = Promise.resolve()
    .then(fetcher)
    .then((value) => { store.set(key, { at: Date.now(), value, error: null, promise: null }); emit(key); return value; })
    .catch((error) => { store.set(key, { ...e, error, promise: null }); emit(key); throw error; });
  store.set(key, e);
  emit(key);
  return e.promise;
}

export function useSwr(key, fetcher, { ttl = 60_000, revalidateOn } = {}) {
  const [, tick] = React.useReducer((n) => n + 1, 0);
  const fetcherRef = React.useRef(fetcher);
  fetcherRef.current = fetcher;

  React.useEffect(() => {
    if (!key) return;
    const fn = () => tick();
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(fn);
    const e = store.get(key);
    const fresh = e && e.at && Date.now() - e.at < ttl;
    if (!fresh || revalidateOn !== undefined) revalidate(key, () => fetcherRef.current()).catch(() => {});
    else tick();
    return () => { listeners.get(key)?.delete(fn); };
  }, [key, ttl, revalidateOn]);

  const e = key ? store.get(key) : null;
  const refresh = React.useCallback(() => (key ? revalidate(key, () => fetcherRef.current()).catch(() => {}) : Promise.resolve()), [key]);
  return {
    data: e?.value,
    error: e?.error || null,
    loading: !!key && !(e && e.at),
    refreshing: !!(e && e.at && e.promise),
    refresh,
  };
}

// Escreve um valor na mão (ex.: resposta de uma ação que já devolve o dado novo).
export function swrSet(key, value) {
  store.set(key, { at: Date.now(), value, error: null, promise: null });
  emit(key);
}

// Some com as chaves que começam por `prefix` (ex.: "social/" após publicar).
export function swrInvalidate(prefix) {
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) { store.delete(k); emit(k); }
}
