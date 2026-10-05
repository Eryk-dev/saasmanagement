// Follow-up em 4 contatos, por DIA (05/10/2026) — lado da SPA. A régua é a do
// servidor (api/src/shared/followup-contacts.js, mesmo arquivo); aqui só a leitura da
// configuração global que chega no bootstrap e os rótulos das telas.

import {
  normalizeFollowupContacts, followupDayOf, followupStepOf, addBusinessDays, todayBrt,
  firstFollowupDay, nextFollowupDay, dayStartIso, FOLLOWUP_STEPS, FOLLOWUP_CHANNELS, DEFAULT_FOLLOWUP_CONTACTS,
} from "../../../api/src/shared/followup-contacts.js";

export {
  normalizeFollowupContacts, followupDayOf, followupStepOf, addBusinessDays, todayBrt,
  firstFollowupDay, nextFollowupDay, dayStartIso, FOLLOWUP_STEPS, FOLLOWUP_CHANNELS, DEFAULT_FOLLOWUP_CONTACTS,
};

// Mensagens e prazos vigentes (Configurações → Follow-up), já com os padrões.
export function followupContacts() {
  const raw = typeof window !== "undefined" ? window.SEED?.CONFIG?.followupContacts : null;
  return normalizeFollowupContacts(raw);
}

// Dia do próximo contato: followupAt; sem ele (sequência concluída ou legado),
// o dia do GPS.
export function followupDueDay(lead) {
  return followupDayOf(lead?.followupAt) || followupDayOf(lead?.nextActionAt);
}

// 00:00 LOCAL do dia (a fila compara com o "hoje" do navegador).
export function localDayStart(ymd) {
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : NaN;
}

// "YYYY-MM-DD" de uma data local.
export function ymdOf(date) {
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// "ter, 07/10" de um dia.
export function dayLabel(ymd) {
  const t = localDayStart(ymd);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }).replace(".", "");
}

// Próximo contato a fazer (1..4) ou 0 quando a sequência acabou.
export function followupNextContact(lead) {
  const step = followupStepOf(lead);
  return step >= FOLLOWUP_STEPS ? 0 : step + 1;
}

// Selo curto: "Contato 2/4" ou "4/4 feitos".
export function followupBadge(lead) {
  const n = followupNextContact(lead);
  return n ? `Contato ${n}/${FOLLOWUP_STEPS}` : `${FOLLOWUP_STEPS}/${FOLLOWUP_STEPS} feitos`;
}
