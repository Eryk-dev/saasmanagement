// Follow-up em 4 contatos (05/10/2026). Módulo PURO, compartilhado com a SPA
// (importado por caminho relativo e copiado nos Dockerfiles de build web, como
// lead-grade.js e plan-cycles.js).
//
// Regras:
// - Follow-up marca só o DIA ("YYYY-MM-DD" em lead.followupAt), nunca horário,
//   e nunca ocupa a agenda de ninguém.
// - A sequência é explícita: o operador registra Contato 1..4 (activity de
//   toque com meta.followupContact = N); lead.followupStep guarda quantos já
//   foram feitos nesta passagem pela etapa.
// - O prazo de cada contato é em DIAS ÚTEIS contados do contato anterior (o
//   Contato 1 conta da entrada no follow-up).
// - Depois do Contato 4 o card fica na fila sem dia, esperando o operador
//   escolher o destino (nada se move sozinho).
// - Mensagens e prazos são UMA configuração global (app_config/followup_contacts).

export const FOLLOWUP_CONTACTS_KEY = "followup_contacts";
export const FOLLOWUP_STEPS = 4;
export const FOLLOWUP_CHANNELS = [
  { id: "whatsapp", label: "WhatsApp" },
  { id: "call", label: "Ligação" },
  { id: "email", label: "E-mail" },
];

export const DEFAULT_FOLLOWUP_CONTACTS = [
  {
    titulo: "Retomar pelo combinado",
    mensagem: "Oi {{nome}}! Aqui é {{eu}}, da {{produto}}. Na nossa call a gente combinou: {{combinado_call}}. Como ficou aí do teu lado? Me fala com sinceridade o que ainda está pegando, que eu resolvo contigo agora.",
    prazoDias: 1,
  },
  {
    titulo: "Objeção respondida com prova",
    mensagem: "Oi {{nome}}! Não vou te deixar sem retorno. Sobre o que ficou no ar na nossa call: cliente nosso na mesma situação subiu 105% espelhando as contas, e o risco do teu lado é baixo, teus anúncios migram no primeiro dia.",
    prazoDias: 3,
  },
  {
    titulo: "Pedido objetivo",
    mensagem: "Oi {{nome}}, tudo bem? Me responde só com um 'bora' que eu já reservo teu horário pra fechar, ou me diz o que ainda está te segurando.",
    prazoDias: 3,
  },
  {
    titulo: "Saída elegante",
    mensagem: "Oi {{nome}}, vou parar de te chamar pra não virar chateação. Só me diz: resolver {{dor_call}} ainda é prioridade pra tua operação agora? Se for, eu retomo com prioridade. Se não for a hora, deixo a porta aberta pra quando quiser voltar.",
    prazoDias: 4,
  },
];

const MAX_PRAZO = 60;
const clampPrazo = (v, fallback) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_PRAZO, Math.max(0, n));
};

// Sempre 4 contatos: o que vier faltando (ou vazio) cai no padrão do código.
export function normalizeFollowupContacts(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.contacts) ? raw.contacts : [];
  return DEFAULT_FOLLOWUP_CONTACTS.map((def, i) => {
    const c = list[i] && typeof list[i] === "object" ? list[i] : {};
    const titulo = String(c.titulo ?? "").trim().slice(0, 120);
    const mensagem = String(c.mensagem ?? "").trim().slice(0, 4000);
    return {
      titulo: titulo || def.titulo,
      mensagem: mensagem || def.mensagem,
      prazoDias: clampPrazo(c.prazoDias, def.prazoDias),
    };
  });
}

// ── Dias (fuso do negócio: America/Sao_Paulo, UTC-3 fixo) ──────────────────
const HOUR = 3_600_000;
const DAY = 86_400_000;
const BRT = 3 * HOUR;
const YMD = /^(\d{4})-(\d{2})-(\d{2})/;

// "YYYY-MM-DD" de um valor de follow-up: aceita o dia puro, o legado com hora
// ("YYYY-MM-DDTHH:MM", hora de Brasília sem fuso) e ISO com fuso.
export function followupDayOf(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (/[Zz]|[+-]\d{2}:\d{2}$/.test(v)) {
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? todayBrt(d) : "";
  }
  const m = v.match(YMD);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

// Dia de hoje (ou de `now`) no relógio de Brasília.
export function todayBrt(now = new Date()) {
  return new Date(new Date(now).getTime() - BRT).toISOString().slice(0, 10);
}

const ymdToUtc = (ymd) => {
  const m = String(ymd || "").match(YMD);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
};
const utcToYmd = (ms) => new Date(ms).toISOString().slice(0, 10);
const isWeekend = (ms) => { const d = new Date(ms).getUTCDay(); return d === 0 || d === 6; };

// Soma N dias úteis (seg–sex). N = 0 devolve o próprio dia, rolado pra segunda
// se cair no fim de semana.
export function addBusinessDays(ymd, n) {
  let ms = ymdToUtc(ymd);
  if (!Number.isFinite(ms)) return "";
  let left = Math.max(0, Math.round(Number(n) || 0));
  while (left > 0) {
    ms += DAY;
    if (!isWeekend(ms)) left -= 1;
  }
  while (isWeekend(ms)) ms += DAY;
  return utcToYmd(ms);
}

// 00:00 de Brasília do dia, em ISO UTC — o GPS (nextActionAt) do follow-up:
// o dia inteiro conta como "hoje" na fila.
export function dayStartIso(ymd) {
  const ms = ymdToUtc(followupDayOf(ymd));
  return Number.isFinite(ms) ? new Date(ms + BRT).toISOString() : "";
}

// Contatos registrados na passagem atual pela etapa (0..4).
export function followupStepOf(lead) {
  const n = Math.round(Number(lead?.followupStep) || 0);
  return Math.min(FOLLOWUP_STEPS, Math.max(0, n));
}

// Dia do Contato 1 ao entrar no follow-up.
export function firstFollowupDay(contacts, now = new Date()) {
  const list = normalizeFollowupContacts(contacts);
  return addBusinessDays(todayBrt(now), list[0].prazoDias);
}

// Dia do contato seguinte ao Contato N registrado em `doneDay` ("" depois do 4º).
export function nextFollowupDay(contacts, n, doneDay) {
  if (n >= FOLLOWUP_STEPS) return "";
  const list = normalizeFollowupContacts(contacts);
  return addBusinessDays(followupDayOf(doneDay) || todayBrt(), list[n].prazoDias);
}
