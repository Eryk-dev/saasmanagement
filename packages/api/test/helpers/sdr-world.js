// Mundo de teste do robô SDR, COPIADO de test/sdr-brain.test.js (L1-75) em
// 15/10/2026 pra o corpus de cenas (test/sdr-corpus/) reaproveitar o mesmo
// mem-repo, os mesmos fakes (IA enfileirada, WhatsApp que grava sent[]) e o
// mesmo relógio. Mudou lá, muda aqui (sdr-corpus.test.js compara os dois).



import { makeMemRepo } from "./mem-repo.js";
import { makeSdrBrain } from "../../src/sdr/sdr-brain.js";

// Relógio dos testes: quarta 19/08/2026, 10h BRT (13h UTC). Com o closer livre
// o primeiro horário OFERTÁVEL é 09:00 do próximo dia útil.
export const NOW = new Date("2026-08-19T13:00:00Z");
export const ISO = (s) => new Date(s).toISOString();
export const SLOT1 = "2026-08-20T09:00";

export const FUNNEL = [
  { stage: "Novo lead", kind: "novo" },
  { stage: "Qualificando", kind: "qualificacao" },
  { stage: "Call agendada", kind: "call" },
  { stage: "No show", kind: "contato" },
  { stage: "Ganho", kind: "ganho" },
];

// A oferta espontânea cobre HOJE + o próximo dia útil (Leo, 30/09). A maior
// parte dos casos aqui foi escrita com a oferta começando amanhã às 9h, então
// o mundo padrão BLOQUEIA a agenda de hoje (19/08); `todayFree: true` abre.
export async function world({ lead = {}, messages = [], sdrBot = {}, users, todayFree = false } = {}) {
  const repo = makeMemRepo();
  await repo.create("products", {
    id: "leverads", name: "LeverAds", funnel: FUNNEL,
    leadQuestions: [{ key: "accounts", label: "Contas", options: [{ value: "3-5", label: "3 a 5 contas" }] }],
    painMap: { B: "Conta banida, precisa anunciar em conta nova", OEM: "Anunciar pelo código OEM sem montar ficha" },
    sdrBot: { enabled: true, enabledAt: ISO("2026-08-01T00:00:00Z"), conversation: true, ...sdrBot },
  });
  for (const u of users || [
    { id: "sdr", name: "Manuela", roles: ["sdr"] },
    { id: "leonardo", name: "Leonardo", roles: ["admin"] },
    { id: "pl", name: "Jonathan", roles: ["closer"], compLevel: 2 },
  ]) await repo.create("users", u);
  if (!todayFree) await repo.create("agenda_blocks", { id: "hoje-cheio", users: ["pl", "leonardo", "jonan", "jonathan", "vit"], recur: "once", date: "2026-08-19", allDay: true });
  await repo.create("leads", {
    id: "L1", saas: "leverads", owner: "sdr", name: "Rafael Silva", phone: "41999990000",
    stage: "Qualificando", accounts: "3-5", createdAt: ISO("2026-08-19T12:00:00Z"), ...lead,
  });
  await repo.create("wa_threads", { id: "5541999990000", phone: "5541999990000", leadId: "L1", saas: "leverads", name: "Rafael" });
  let seq = 0;
  for (const m of messages) {
    await repo.create("wa_messages", { id: "m" + (++seq), thread: "5541999990000", leadId: "L1", saas: "leverads", ...m });
  }
  return repo;
}

export function makeFakes({ decisions = [], approved = [] } = {}) {
  const sent = [];
  const calls = [];
  const meets = [];
  const meetCancels = [];
  const queue = [...decisions];
  const wa = {
    configured: () => true,
    sendText: async (to, text) => { sent.push({ to, text }); return { messageId: "wm_" + sent.length }; },
    // Template (indicação, R-043): grava como texto "[template nome] params".
    sendTemplate: async (to, name, lang, components) => {
      const params = (components.find((c) => c.type === "body")?.parameters || []).map((p) => p.text);
      sent.push({ to, text: `[template ${name}] ${params.join(" | ")}`, template: name, params });
      return { messageId: "wm_t" + sent.length };
    },
    listTemplates: async () => approved.map((n) => ({ name: n })),
    tokenWabaIds: async () => ["waba_test"],
  };
  const anthropic = {
    configured: () => true,
    sdrDecide: async (ctx) => {
      calls.push(ctx);
      const d = queue.shift() || { acao: "silencio" };
      return { acao: "silencio", mensagem: "", horario: "", email: "", motivoHumano: "", ...d };
    },
  };
  const autoCallMeet = async (id) => { meets.push(id); return null; };
  const cancelCallMeet = async (id) => { meetCancels.push(id); return null; };
  return { wa, anthropic, autoCallMeet, cancelCallMeet, sent, calls, meets, meetCancels };
}

export const brainOf = (repo, fakes) => makeSdrBrain({
  repo, whatsapp: fakes.wa, anthropic: fakes.anthropic, autoCallMeet: fakes.autoCallMeet, cancelCallMeet: fakes.cancelCallMeet,
  log: { warn: () => {} }, now: () => NOW, replyDelayMs: 0, sleep: async () => {},
});
