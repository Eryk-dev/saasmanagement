// Conversas fictícias para conferir o Inbox; nunca entra no build de produção.
const ago = (hours) => new Date(Date.now() - hours * 3600000).toISOString();
const messages = new Map();
let rows = [];
const templates = [
  { name: "retomar_conversa", language: "pt_BR", status: "APPROVED", params: 1, body: "Oi {{1}}, podemos retomar nossa conversa?" },
  { name: "confirmar_call", language: "pt_BR", status: "APPROVED", params: 1, body: "Oi {{1}}, está tudo certo para nossa call?" },
];

export function setupInboxPreview(seed, params) {
  seed.CONFIG.whatsapp = { configured: true, health: { level: "ok", messages: [] } };
  seed.SAAS[0].waPhoneId = "preview-number";
  const people = [
    ["l5", "Carla Nunes", "Casa Bela Utilidades", 3, "in"],
    ["l7", "Pedro Rocha", "Leões do Bebê", 26, "in"],
    ["l6", "Diego Martins", "Eletro Sul", 0.5, "in", "sdr-bot"],
    ["l3", "Fernanda Dias", "Casa & Cia", 1, "out", "sdr-bot"],
    [null, "Contato novo", "", 2, "in"],
    ["l8", "Rafael Duarte", "Ferragens Duarte", 48, "out", "", "closed"],
  ];
  rows = people.map(([leadId, name, company, hours, direction, author = "", status = "open"], i) => {
    const lead = seed.LEADS.find((l) => l.id === leadId);
    const id = lead?.phone || "5541999900099";
    if (lead) lead.recapNote = "Quer replicar o catálogo entre as contas e reduzir o trabalho manual. Decide junto com o sócio.";
    const msgs = [
      { id: `${id}-1`, direction: "in", text: "Olá! Quero entender como funciona para as minhas contas.", at: ago(hours + 0.8) },
      { id: `${id}-2`, direction: "out", author: author || "leo", text: "Claro! Hoje vocês sobem os anúncios manualmente em cada conta?", at: ago(hours + 0.4), status: "read" },
      { id: `${id}-3`, direction, author: direction === "out" ? author : "", text: direction === "in" ? "Sim, são três contas. Podemos conversar amanhã?" : "Qual o melhor horário para conversarmos?", at: ago(hours), status: direction === "out" ? "delivered" : "received" },
    ];
    messages.set(id, msgs);
    return { id, phone: id, name, company, leadId, saas: "leverads", waPhoneId: "preview-number", stage: lead?.stage, status, unread: direction === "in" ? 2 : 0, hasIn: true, lastAt: ago(hours), lastDir: direction, lastText: msgs.at(-1).text, lastOutAuthor: author || "leo", sdrHandoffAt: i === 2 ? ago(0.2) : null };
  });
  // Reproduz a qualificação longa do card lateral com dados fictícios.
  // ?shell=1&inbox=1&qualification=full#whatsapp (ou empty/note).
  const qualification = params.get("qualification");
  if (qualification) {
    const product = seed.SAAS[0];
    product.leadQuestions = [
      { key: "accounts", label: "Quantas contas de marketplace você opera?", options: [{ value: "1", label: "1 conta" }, { value: "2", label: "2 contas" }] },
      { key: "listings", label: "Quantos anúncios publicados na maior conta?", options: [{ value: "0-500", label: "0–500" }] },
      { key: "storeType", label: "Você vende só online ou também tem loja física?", options: [{ value: "both", label: "Online + loja física" }] },
      { key: "stores", label: "Quantas unidades?" },
      { key: "motivation", label: "O que fez você procurar uma solução agora?" },
      { key: "orders", label: "Quantos pedidos por mês, aproximadamente?" },
      { key: "ticket", label: "Qual seu ticket médio?" },
    ];
    product.painMap = { OEM: "Anunciar pelo código OEM sem montar ficha nem compatibilidade" };
    for (const lead of seed.LEADS) {
      lead.recapNote = qualification === "note" ? "Conversar com o sócio antes da call.\nRetomar na quinta-feira." : "";
      if (qualification === "empty") {
        for (const key of ["company", "accounts", "listings", "email", "sourcePain"]) delete lead[key];
      } else {
        Object.assign(lead, { accounts: "1", listings: "0-500", storeType: "both", stores: "1 loja", orders: "Até 200", ticket: "R$ 150 a 300", sourcePain: "OEM", email: "contato.qualificacao@example.com",
          motivation: "Uma empresa que cadastre meu estoque no Mercado Livre de forma estratégica.\nQuero vender por lá e reduzir o trabalho manual.",
        });
      }
    }
  }
  if (params.has("empty")) rows = [];
}

function send(id, text) {
  const message = { id: `${id}-${Date.now()}`, direction: "out", author: "leo", text, at: ago(0), status: "sent" };
  messages.set(id, [...(messages.get(id) || []), message]);
  rows = rows.map((t) => t.id === id ? { ...t, lastAt: message.at, lastDir: "out", lastText: text, lastOutAuthor: "leo", unread: 0 } : t);
  return { ok: true };
}

export const inboxMock = {
  create: (col, payload) => {
    const row = { id: `preview-${Date.now()}`, createdAt: ago(0), stage: window.SEED.SAAS[0].funnel[0].stage, ...payload };
    (window.SEED[col.toUpperCase()] ||= []).push(row);
    return row;
  },
  waNumber: () => ({ ok: true, display: "+55 (41) 99900-0000", name: "LeverAds", quality: "GREEN", tier: "TIER_250", platform: "CLOUD_API", throughput: "STANDARD" }),
  waThreads: () => ({ threads: rows.map((t) => ({ ...t })) }),
  waThread: (id) => ({ thread: id, messages: [...(messages.get(id) || [])] }),
  waThreadRead: (id) => { rows = rows.map((t) => t.id === id ? { ...t, unread: 0 } : t); return { ok: true }; },
  waThreadClose: (id, closed) => { rows = rows.map((t) => t.id === id ? { ...t, status: closed ? "closed" : "open" } : t); return { ok: true }; },
  waThreadSend: send,
  waThreadSendTemplate: (id, { params }) => send(id, `Oi ${params[0]}, podemos retomar nossa conversa?`),
  waInsights: () => {
    const open = rows.filter((t) => t.status !== "closed");
    const waiting = open.filter((t) => t.lastDir === "in");
    return { days: 7, awaiting: waiting.length, oldestWaitHours: waiting.length ? Math.max(...waiting.map((t) => (Date.now() - new Date(t.lastAt)) / 3600000)) : null, medianReplyMinutes: 18, openWindow: open.filter((t) => (messages.get(t.id) || []).some((m) => m.direction === "in" && Date.now() - new Date(m.at) < 86400000)).length, activeThreads: open.length, unread: open.reduce((sum, t) => sum + t.unread, 0), inbound: 98, outbound: 214, withoutLead: open.filter((t) => !t.leadId).length, costs: { cost: 41.8 } };
  },
  waMetaTemplates: () => ({ templates, unsupported: 0 }),
  waLinkThread: (id, leadId) => { rows = rows.map((t) => t.id === id ? { ...t, leadId } : t); return { ok: true }; },
  sequenceMetrics: () => ({ sequences: [] }),
  socialDms: () => ({ threads: [], errors: { setup: "Este canal não está conectado. Conecte a conta em Configurações → Integrações." } }),
};
