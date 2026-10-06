// Prévia das etapas atuais (06/10/2026): ?shell&etapas#today monta as
// Atividades com o funil no formato de hoje (Ganho só para cards antigos; a
// venda vai do Follow-up/Call direto para a Integração) e um lead com histórico
// em cada etapa, para conferir a seção "Etapa" da ficha do lead. Só preview:
// nenhum dado real é lido ou gravado.
const params = new URLSearchParams(location.search);
export const etapasPreview = params.has("etapas");

const DIA = 86400000;
const hoje = new Date();
const emHoras = (h, m = 0) => { const d = new Date(hoje); d.setHours(h, m, 0, 0); return d.toISOString(); };
const emDias = (n, h = 9) => { const d = new Date(hoje.getTime() + n * DIA); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const dia = (n) => emDias(n).slice(0, 10);

export const ETAPAS_FUNNEL = [
  { stage: "Novo lead", kind: "novo", color: "#8b95a7" },
  { stage: "Qualificando", kind: "qualificacao", color: "#5b8def" },
  { stage: "Call agendada", kind: "call", color: "#7c5cff" },
  { stage: "No show", kind: "contato", color: "#e08a3c" },
  { stage: "Proposta enviada", kind: "proposta", color: "#a35cd6" },
  { stage: "Follow-up", kind: "followup", color: "#d6a21e" },
  { stage: "Ganho", kind: "ganho", color: "#2f9e6b" },
  { stage: "Integração", kind: "integracao", color: "#1f8f8a" },
  { stage: "Acompanhamento", kind: "posvenda", color: "#3aa57a" },
  { stage: "Nutrição", kind: "contato", color: "#9aa37a", cadence: { maxAttempts: 3, retryDays: 7, firstTouchHours: 168 } },
  { stage: "Perdido", kind: "perdido", color: "#c4524a" },
  { stage: "Desqualificado", kind: "desqualificado", color: "#9b6b6b" },
];

const base = { saas: "leverads", owner: "leo", closer: "leo", accounts: "2", listings: "2-10k" };
const LEADS = [
  { id: "e1", name: "Fernanda Dias", company: "Casa & Cia", stage: "Novo lead", phone: "5541999990101", amount: 1900, createdAt: emDias(0, 8), nextActionAt: emHoras(9, 0), closer: "" },
  { id: "e2", name: "Carla Nunes", company: "Casa Bela Utilidades", stage: "Qualificando", phone: "5541999990102", amount: 2300, createdAt: emDias(-6), stageSince: emDias(-2), stageAttempts: 2, nextActionAt: emHoras(9, 30), closer: "" },
  { id: "e3", name: "Bruno Teixeira", company: "Auto Peças Já", stage: "Call agendada", phone: "5541999990103", amount: 2600, createdAt: emDias(-5), stageSince: emDias(-2), callAt: emHoras(16, 0) },
  { id: "e4", name: "Juliana Alves", company: "Sul Importados", stage: "No show", phone: "5541999990104", amount: 3100, createdAt: emDias(-7), stageSince: emDias(-1), stageAttempts: 1, nextActionAt: emHoras(10, 0) },
  { id: "e5", name: "Pedro Rocha", company: "Leões do Bebê", stage: "Proposta enviada", phone: "5541999990105", amount: 5400, createdAt: emDias(-12), stageSince: emDias(-3), stageAttempts: 1, nextActionAt: emHoras(11, 0) },
  { id: "e6", name: "Rafael Duarte", company: "Ferragens Duarte", stage: "Follow-up", phone: "5541999990106", amount: 3300, createdAt: emDias(-15), stageSince: emDias(-4), followupStep: 1, followupAt: dia(0), nextActionAt: `${dia(0)}T03:00:00.000Z` },
  { id: "e7", name: "Otávio Braga", company: "Braga Ferramentas", stage: "Ganho", phone: "5541999990107", amount: 2850, createdAt: emDias(-20), stageSince: emDias(-2), wonAt: emDias(-2), dealProduct: "ads_essencial", planClosed: "anual", nextActionAt: emHoras(13, 0) },
  { id: "e8", name: "Sandra Melo", company: "Melo Cosméticos", stage: "Integração", phone: "5541999990108", amount: 3300, createdAt: emDias(-25), stageSince: emDias(-1), wonAt: emDias(-1), integrator: "leo", integrationAt: emHoras(14, 0), dealProduct: "ads_essencial", planClosed: "anual" },
  { id: "e9", name: "Ricardo Nunes", company: "RN Distribuidora", stage: "Acompanhamento", phone: "5541999990109", amount: 4800, createdAt: emDias(-40), stageSince: emDias(-10), wonAt: emDias(-12), nextActionAt: emHoras(15, 0) },
  { id: "e10", name: "Diego Martins", company: "Eletro Sul", stage: "Nutrição", phone: "5541999990110", amount: 1500, createdAt: emDias(-30), stageSince: emDias(-7), stageAttempts: 1, nextActionAt: emHoras(17, 0), closer: "" },
  { id: "e11", name: "Lívia Castro", company: "Castro Bebidas", stage: "Perdido", phone: "5541999990111", amount: 4800, createdAt: emDias(-18), stageSince: emDias(-3), lostReason: "budget" },
  { id: "e12", name: "Thiago Barros", company: "Barros Ferramentas", stage: "Desqualificado", phone: "5541999990112", amount: 0, createdAt: emDias(-11), stageSince: emDias(-6), lostReason: "fora_icp", closer: "" },
].map((l) => ({ ...base, ...l }));

// Histórico curto por lead: o caminho até a etapa atual, com um contato no meio.
const caminho = {
  e2: ["Novo lead", "Qualificando"],
  e3: ["Novo lead", "Qualificando", "Call agendada"],
  e4: ["Qualificando", "Call agendada", "No show"],
  e5: ["Qualificando", "Call agendada", "Proposta enviada"],
  e6: ["Call agendada", "Proposta enviada", "Follow-up"],
  e7: ["Proposta enviada", "Follow-up", "Ganho"],
  e8: ["Call agendada", "Follow-up", "Integração"],
  e9: ["Follow-up", "Integração", "Acompanhamento"],
  e10: ["Qualificando", "Follow-up", "Nutrição"],
  e11: ["Call agendada", "Follow-up", "Perdido"],
  e12: ["Novo lead", "Qualificando", "Desqualificado"],
};
let activities = [];
function seedActivities() {
  activities = [];
  for (const l of LEADS) {
    const path = caminho[l.id] || [];
    activities.push({ id: `${l.id}-c`, lead: l.id, saas: "leverads", type: "whatsapp", by: "leo", at: emDias(-path.length - 1, 10), text: `Primeiro contato com ${l.name.split(" ")[0]} pelo WhatsApp.` });
    path.slice(1).forEach((to, i) => activities.push({
      id: `${l.id}-s${i}`, lead: l.id, saas: "leverads", type: "stage", by: "leo", at: emDias(-path.length + i, 11),
      meta: { from: path[i], to, ...(to === "Perdido" || to === "Desqualificado" ? { lostReason: l.lostReason } : {}) },
    }));
    if (l.stage === "Follow-up") activities.push({ id: `${l.id}-f1`, lead: l.id, saas: "leverads", type: "whatsapp", by: "leo", at: emDias(-2, 15), text: "Contato 1 do follow-up: retomei o combinado da call.", meta: { followupContact: 1 } });
  }
}

export function setupEtapasPreview(seed) {
  const product = seed.SAAS[0];
  product.funnel = ETAPAS_FUNNEL.map((f) => ({ ...f }));
  product.lossReasons = [{ id: "budget", label: "Sem orçamento" }, { id: "fora_icp", label: "Fora do ICP" }];
  seed.USERS.push({ id: "eryk", name: "Eryk", roles: ["integrator"], saas: "" });
  seed.LEADS = LEADS.map((l) => ({ ...l }));
  seedActivities();
  window.__etapasMoves = [];
  window.__etapasPatches = [];
}

export const etapasMock = {
  list: (col) => Promise.resolve(col === "leads" ? window.SEED.LEADS : []),
  get: (col, id) => Promise.resolve((window.SEED[String(col).toUpperCase()] || []).find((r) => r.id === id) || null),
  listActivities: (id) => Promise.resolve(activities.filter((a) => a.lead === id).sort((a, b) => b.at.localeCompare(a.at))),
  update: (col, id, patch) => Promise.resolve().then(() => {
    const row = (window.SEED[String(col).toUpperCase()] || []).find((r) => r.id === id);
    if (row && patch.stage && patch.stage !== row.stage) {
      activities.push({ id: `mv-${activities.length}`, lead: id, saas: "leverads", type: "stage", by: "leo", at: new Date().toISOString(), meta: { from: row.stage, to: patch.stage } });
      window.__etapasMoves.push({ id, from: row.stage, to: patch.stage });
    }
    window.__etapasPatches.push({ id, patch });
    if (row) Object.assign(row, patch, patch.stage ? { stageSince: new Date().toISOString(), stageAttempts: 0 } : {});
    return row;
  }),
  logActivity: (data) => Promise.resolve().then(() => {
    const row = { ...data, id: `log-${activities.length}`, at: new Date().toISOString() };
    activities.push(row);
    return row;
  }),
};
