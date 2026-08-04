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
// Ampliado em 04/08 (Leo: "o cockpit fica dando uns pequenos refresh nele
// inteiro"): coleção cuja tela tem fetch PRÓPRIO (ou que é cache/telemetria)
// não pode recarregar o app de todo mundo a cada gravação —
//   wa_media       cache de binário de mídia (ninguém lê do SEED)
//   wa_calls       estado da ligação (o componente da chamada já faz poll)
//   wa_alerts      pop-up quente (o WaHotAlert tem poll próprio)
//   training_*     estudo é PESSOAL (uma carta respondida recarregava o
//                  cockpit do time inteiro; a fila é fetch próprio da tela)
//   mp_payments    espelho do Mercado Pago (poller de 10 min regrava; a baixa
//                  de fatura continua bumpando via `invoices`)
//   social_stories captura periódica de métricas de stories (tela tem load)
const SILENT = new Set([
  "sessions", "form_events", "ad_insights",
  "wa_media", "wa_calls", "wa_alerts",
  "training_states", "training_attempts",
  "mp_payments", "social_stories",
]);

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
