// Expediente do time comercial, em UM lugar só. Quem pergunta "o time está na
// operação agora?" pergunta aqui: o fluxo de ligação (qual saudação mandar) e o
// plantão fora do horário (quem atende e se o robô fala) precisam responder
// exatamente a mesma coisa, senão existe um intervalo em que o time já saiu mas
// o cockpit ainda acha que não.
//
// Seg a sex, 8h às 18h por padrão, configurável por produto em
// product.waCallFlow.hourStart/hourEnd. Fim de semana nunca é expediente.
//
// Relógio do negócio em UTC-3 fixo (mesma convenção do marketing/lead-flow):
// São Paulo não tem horário de verão desde 2019.
const BRT = 3 * 3_600_000;

export const hourOf = (v, fallback) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n < 24 ? n : fallback; };
export const businessClock = (at) => new Date(new Date(at).getTime() - BRT); // campos UTC = relógio de Brasília

export function isBusinessHours(product, at = new Date()) {
  const cfg = product?.waCallFlow || {};
  const clock = businessClock(at);
  const dow = clock.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const h = clock.getUTCHours() + clock.getUTCMinutes() / 60;
  return h >= hourOf(cfg.hourStart, 8) && h < hourOf(cfg.hourEnd, 18);
}
