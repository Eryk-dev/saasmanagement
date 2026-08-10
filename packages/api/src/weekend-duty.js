// Plantão de fim de semana: da sexta 18h até a segunda 8h o time comercial não
// está na operação, e quem atende é UMA pessoa, no número dela. Nessa janela:
//
//   1. o botão do formulário manda o lead falar com o número do PLANTÃO em vez
//      do número comercial de sempre (routes.forms.js);
//   2. a saudação automática do fluxo de ligação fica calada (wa-call-flow.js)
//      — quem responde é gente, e o robô dizendo "voltamos segunda" atropelaria
//      o plantonista e entregaria a sensação contrária da que ele quer passar.
//
// As duas pontas leem a MESMA janela daqui: número novo e robô calado sempre
// começam e terminam juntos, sem uma metade do fim de semana em cada regra.
//
// Configuração por PRODUTO (product.weekendDuty), porque o plantão é de quem
// vende aquele produto: o fim de semana da LeverAds é o Leo, o da UniqueKids
// seria a Ana. Sem a config, o produto segue como sempre foi (desligado).
//
//   weekendDuty: {
//     enabled: true,
//     phone: "5541995063622",   // dígitos E.164 sem "+"
//     fromDow: 5, fromHour: 18, // sexta 18h  (0 = domingo)
//     toDow: 1,   toHour: 8,    // segunda 8h
//     silenceAuto: true,        // cala a saudação automática na janela
//   }
//
// Relógio do negócio em UTC-3 fixo (mesma convenção do marketing/lead-flow/
// wa-call-flow): São Paulo não tem horário de verão desde 2019.
const BRT = 3 * 3_600_000;
const businessClock = (at) => new Date(new Date(at).getTime() - BRT); // campos UTC = relógio de Brasília

const DEFAULTS = { fromDow: 5, fromHour: 18, toDow: 1, toHour: 8, silenceAuto: true };

const dowOf = (v, fallback) => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= 6 ? n : fallback; };
const hourOf = (v, fallback) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n < 24 ? n : fallback; };

// Minuto da semana (domingo 00:00 = 0), a escala que deixa a janela virar uma
// comparação só mesmo quando ela atravessa o domingo.
const minuteOfWeek = (dow, hour) => dow * 1440 + Math.round(hour * 60);

// Config normalizada, ou null quando o produto não tem plantão: sem `enabled` e
// sem número não existe pra onde mandar o lead, então não há janela nenhuma.
export function weekendDuty(product) {
  const cfg = product?.weekendDuty;
  if (!cfg?.enabled) return null;
  const phone = String(cfg.phone || "").replace(/\D/g, "");
  if (!phone) return null;
  return {
    phone,
    fromDow: dowOf(cfg.fromDow, DEFAULTS.fromDow),
    fromHour: hourOf(cfg.fromHour, DEFAULTS.fromHour),
    toDow: dowOf(cfg.toDow, DEFAULTS.toDow),
    toHour: hourOf(cfg.toHour, DEFAULTS.toHour),
    silenceAuto: cfg.silenceAuto !== false,
  };
}

export function isWeekendDuty(product, at = new Date()) {
  const cfg = weekendDuty(product);
  if (!cfg) return false;
  const start = minuteOfWeek(cfg.fromDow, cfg.fromHour);
  const end = minuteOfWeek(cfg.toDow, cfg.toHour);
  if (start === end) return false; // janela vazia (ou a semana inteira): trata como sem plantão
  const clock = businessClock(at);
  const cur = minuteOfWeek(clock.getUTCDay(), clock.getUTCHours() + clock.getUTCMinutes() / 60);
  // A janela padrão ATRAVESSA o domingo (sexta → segunda), então ela é o lado de
  // fora do intervalo, não o de dentro.
  return start < end ? cur >= start && cur < end : cur >= start || cur < end;
}

// Número que atende AGORA, ou "" quando o plantão não está valendo — o chamador
// só troca quando vem número, e nunca precisa saber que dia é hoje.
export function weekendDutyPhone(product, at = new Date()) {
  return isWeekendDuty(product, at) ? weekendDuty(product).phone : "";
}

// A saudação automática deve ficar calada agora? Só dentro da janela, e só
// quando o plantão pediu silêncio (dá pra ter plantão com o robô ligado).
export function isAutoSilenced(product, at = new Date()) {
  const cfg = weekendDuty(product);
  return !!cfg?.silenceAuto && isWeekendDuty(product, at);
}
