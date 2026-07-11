// Barramento de mudanças pro tempo real do cockpit: toda escrita no repo (db.js)
// incrementa `rev` e notifica os assinantes; /api/events (routes.js) transforma
// isso num stream SSE que o SPA escuta pra recarregar sem refresh manual.
//
// Fora do broadcast: `sessions` (login/logout não é dado de tela), `form_events`
// (telemetria de drop-off dos forms públicos — alta frequência, recarregaria o
// cockpit de todo mundo a cada pageview de form) e `ad_insights` (o auto-sync
// da Meta regrava o gasto do dia a cada ~3 min; a tela de Publicidade tem
// refresh próprio de 60s — sem isso, o app inteiro "dava refresh" pra todo
// mundo, o tempo todo, sem nenhum dado de tela ter mudado).
const SILENT = new Set(["sessions", "form_events", "ad_insights"]);

let rev = 0;
const listeners = new Set();

export function bump(collection) {
  if (SILENT.has(collection)) return;
  rev++;
  for (const fn of listeners) {
    try { fn(rev, collection); } catch { /* assinante morto não derruba o resto */ }
  }
}

export function currentRev() {
  return rev;
}

// Retorna o unsubscribe.
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
