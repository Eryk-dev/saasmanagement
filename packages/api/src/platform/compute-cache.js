// Cache de RESULTADO dos cálculos caros do cockpit (pace do pipeline, placar
// por pessoa). Diferente do cache de list() do db.js (que guarda as linhas),
// este guarda a resposta pronta: computar o pace reparseia ~17 MB de JSON
// (leads + activities + wa_messages) e a Visão geral e a Análise de
// Desempenho pedem pace E placar ao mesmo tempo — e o placar chama o pace por
// dentro. Sem isto, cada abertura de tela fazia o mesmo cálculo 2–3 vezes.
//
// Validade: uma entrada vale enquanto (a) ninguém escreveu no banco por este
// processo (repo.writeRev(), db.js) e (b) não passou o TTL, rede de segurança
// pra escrita externa (psql, outra réplica) — o mesmo TTL do cache de list().
// Guarda a PROMISE, não o valor: duas chamadas iguais em voo compartilham um
// cálculo só. Erro não fica cacheado. Repo sem writeRev (double de teste
// antigo) passa direto, sem cache.
//
// Chave por repo (WeakMap): em produção há um repo só; nos testes cada app
// nasce com um mem-repo próprio e um não pode enxergar o cálculo do outro. O
// leitor de métricas (metrics-reader.js) é descartável por requisição, então a
// chave é o repo de baixo dele (`base`) — assim o pace calculado dentro do
// placar é o mesmo que a rota do pace devolve.

export const COMPUTE_TTL_MS = 60_000;
const byRepo = new WeakMap(); // repo -> Map(key -> { at, rev, promise })

export function memoCompute(repo, key, fn, { ttlMs = COMPUTE_TTL_MS, fresh = false } = {}) {
  if (typeof repo?.writeRev !== "function") return fn();
  const base = repo.base || repo;
  let table = byRepo.get(base);
  if (!table) { table = new Map(); byRepo.set(base, table); }
  const rev = repo.writeRev();
  const now = Date.now();
  const hit = table.get(key);
  if (!fresh && hit && hit.rev === rev && now - hit.at < ttlMs) return hit.promise;
  const promise = Promise.resolve().then(fn);
  table.set(key, { at: now, rev, promise });
  promise.catch(() => { if (table.get(key)?.promise === promise) table.delete(key); });
  return promise;
}

// Só pra teste/depuração: esquece tudo que foi calculado pra este repo.
export function forgetCompute(repo) {
  byRepo.delete(repo?.base || repo);
}
