// Horário das salas do Meet (call, integração, reunião de registro) e quem
// pode organizar a sala com a conta do time. Saiu de routes.google.js para os
// outros módulos (calls/record-meetings.js) usarem sem importar um arquivo de rotas.

export const TZ = "America/Sao_Paulo";

// Horário de call/integração → INSTANTE (Date), aceitando os dois formatos que
// existem na base: "YYYY-MM-DDTHH:MM[:SS]" (naive, do input datetime-local, que
// significa hora de Brasília) e ISO com fuso ("…Z" ou "…±HH:MM", de lead que
// entrou por integração). Devolve null pra vazio ou lixo — quem chama decide o
// fallback, em vez de estourar RangeError lá na frente.
export function callMoment(whenRaw) {
  const raw = String(whenRaw || "").trim();
  if (!raw) return null;
  const hasZone = /([Zz]|[+-]\d{2}:?\d{2})$/.test(raw);
  const d = new Date(hasZone ? raw : `${raw}${raw.length === 16 ? ":00" : ""}-03:00`);
  return Number.isFinite(d.getTime()) ? d : null;
}

// Hora de PAREDE em São Paulo ("YYYY-MM-DDTHH:MM:SS"), pro Calendar receber o
// horário cru + timeZone. Sai do fuso de verdade, não do fuso do servidor: com
// getHours() o mesmo instante virava horário diferente em máquina UTC.
export function wallClockBrt(date) {
  const p = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(date);
  return p.replace(" ", "T");
}

// A conta do TIME (contato@uniquebox) só organiza sala da UniqueKids — é o
// Workspace dela. Nos demais produtos a operação vive nos @leverads (decisão
// do Leo, 01/09/2026): sala organizada pela uniquebox com closer @leverads
// dentro conta como convidado externo e o Google NÃO grava nem transcreve.
// Sem a conta pessoal do responsável pronta, é melhor call sem sala do que
// sala que não grava — o erro/aviso aponta o conserto.
const TEAM_ORGANIZER_SAAS = new Set(["uniquekids"]);
export const teamMayOrganize = (saas) => TEAM_ORGANIZER_SAAS.has(String(saas || ""));
