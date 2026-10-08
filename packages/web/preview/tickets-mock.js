// Dublê do Suporte pro preview (14/09). Fora do build de produção: só o
// vite.preview.config.js troca lib/api.js pelo api-mock.js, que espalha isto.
// Cenários fictícios: um estourado, um vencendo, um pausado esperando o
// cliente, um sem responsável e um resolvido — nenhum e-mail sai daqui.
const H = 3_600_000;
const agora = Date.now();
const iso = (deltaH) => new Date(agora + deltaH * H).toISOString();

const sla = (createdH, frH, resH, extra = {}) => ({
  firstResponseDue: iso(createdH + frH), resolutionDue: iso(createdH + resH),
  firstResponseWarnAt: iso(createdH + frH * 0.8), resolutionWarnAt: iso(createdH + resH * 0.8),
  firstResponseAt: "", resolvedAt: "", pausedAt: "", pausedMs: 0,
  breached: { firstResponse: false, resolution: false }, ...extra,
});

let tickets = [
  { id: "tk1", number: 1042, saas: "leverads", subject: "Painel não carrega os anúncios do Mercado Livre", description: "Desde ontem à tarde o painel fica girando e não mostra nada.", status: "new", priority: "urgent", category: "Problema técnico", channel: "portal", customerId: "c1", requester: { name: "Marianna Reis", email: "marianna@zpack.com.br", phone: "" }, assignee: "", followers: [], createdAt: iso(-3), updatedAt: iso(-3), sla: sla(-3, 1, 8, { breached: { firstResponse: true, resolution: false } }), attachments: [], messages: [], portalToken: "demo1042" },
  { id: "tk2", number: 1041, saas: "leverads", subject: "Dúvida sobre a cobrança do plano trimestral", description: "Fui cobrado duas vezes este mês?", status: "open", priority: "high", category: "Financeiro", channel: "internal", customerId: "c3", requester: { name: "Otávio Braga", email: "otavio@braga.com.br", phone: "" }, assignee: "lucas", followers: ["lucas"], createdAt: iso(-3.5), updatedAt: iso(-1), sla: sla(-3.5, 4, 24, { firstResponseAt: iso(-2) }), attachments: [], portalToken: "demo1041",
    messages: [{ id: "m1", kind: "reply", author: { type: "agent", id: "lucas" }, text: "Oi, Otávio! Estou conferindo com o financeiro e já te retorno.", at: iso(-2) }, { id: "m2", kind: "note", author: { type: "agent", id: "lucas" }, text: "@Leonardo você consegue ver no MP se houve estorno?", at: iso(-1.9), mentions: ["leo"] }] },
  { id: "tk3", number: 1039, saas: "leverads", subject: "Como integrar uma segunda conta da Shopee", description: "", status: "pending_customer", priority: "normal", category: "Dúvida", channel: "internal", customerId: "c4", requester: { name: "Ricardo Nunes", email: "", phone: "" }, assignee: "tiago", followers: ["tiago"], createdAt: iso(-30), updatedAt: iso(-5), sla: sla(-30, 8, 48, { firstResponseAt: iso(-26), pausedAt: iso(-5) }), attachments: [], portalToken: "demo1039",
    messages: [{ id: "m3", kind: "reply", author: { type: "agent", id: "tiago" }, text: "Ricardo, me envia o print da tela de contas conectadas?", at: iso(-5) }] },
  { id: "tk4", number: 1043, saas: "leverads", subject: "Pedido de relatório mensal em PDF", description: "Queria receber o relatório por e-mail todo mês.", status: "new", priority: "low", category: "Sugestão", channel: "portal", customerId: "", requester: { name: "Carla Nunes", email: "carla@casabela.com", phone: "" }, assignee: "", followers: [], createdAt: iso(-0.5), updatedAt: iso(-0.5), sla: sla(-0.5, 24, 120), attachments: [], messages: [], portalToken: "demo1043" },
  { id: "tk5", number: 1040, saas: "leverads", subject: "Erro ao importar planilha de anúncios", description: "", status: "open", priority: "urgent", category: "Problema técnico", channel: "internal", customerId: "c5", requester: { name: "Pedro Rocha", email: "", phone: "" }, assignee: "leo", followers: ["leo"], createdAt: iso(-7), updatedAt: iso(-0.2), sla: sla(-7, 1, 8, { firstResponseAt: iso(-6.5) }), attachments: [{ id: "a1", name: "planilha-erro.xlsx", mime: "application/vnd.ms-excel", size: 48211, public: true }], portalToken: "demo1040",
    messages: [{ id: "m4", kind: "reply", author: { type: "agent", id: "leo" }, text: "Recebi a planilha, estou reproduzindo aqui.", at: iso(-6.5), attachments: ["a1"] }, { id: "m5", kind: "reply", author: { type: "customer", name: "Pedro Rocha" }, text: "Consegui importar metade, o resto continua dando erro na coluna de preço.", at: iso(-0.2) }] },
  { id: "tk6", number: 1035, saas: "leverads", subject: "Troca do e-mail de acesso", description: "", status: "resolved", priority: "normal", category: "Dúvida", channel: "internal", customerId: "c6", requester: { name: "Sandra Melo", email: "", phone: "" }, assignee: "leo", followers: ["leo"], createdAt: iso(-72), updatedAt: iso(-40), sla: sla(-72, 8, 48, { firstResponseAt: iso(-70), resolvedAt: iso(-40) }), attachments: [], messages: [], portalToken: "demo1035" },
];

// Hermes (?hermes): cards do agente de correção em cada momento do guia —
// esperando validação, com pergunta, no ar e passado para o time. Nada sai
// daqui pro Linear.
const comHermes = () => typeof location !== "undefined" && new URLSearchParams(location.search).has("hermes");
const hist = (...fases) => fases.map(([phase, h]) => ({ phase, at: iso(h) }));
const hermesTickets = [
  { id: "tk7", number: 1044, saas: "leverads", subject: "[Loja Sul] preço subiu dobrado na Shopee", description: "", status: "open", priority: "high", category: "Código · Bug", channel: "internal", customerId: "", requester: { name: "Loja Sul", email: "", phone: "" }, assignee: "", followers: [], createdAt: iso(-20), updatedAt: iso(-0.3), sla: sla(-20, 4, 24, { firstResponseAt: iso(-19) }), attachments: [], messages: [], portalToken: "demo1044",
    linear: { issueId: "iss_999", identifier: "LEV-999", url: "https://linear.app/leverads/issue/LEV-999", stateName: "Validar", stateType: "started" },
    hermes: { labeled: true, active: true, holding: true, needsHuman: true, phase: "validar", phaseSince: iso(-0.3), version: 2, history: hist(["relato", -20], ["trabalhando", -18], ["revisao", -2], ["validar", -0.3]) } },
  { id: "tk8", number: 1045, saas: "leverads", subject: "[Auto Center RP] estoque não sincroniza", description: "", status: "open", priority: "normal", category: "Código · Bug", channel: "internal", customerId: "", requester: { name: "Auto Center RP", email: "", phone: "" }, assignee: "", followers: [], createdAt: iso(-6), updatedAt: iso(-1), sla: sla(-6, 8, 48, { firstResponseAt: iso(-5) }), attachments: [], messages: [], portalToken: "demo1045",
    linear: { issueId: "iss_1000", identifier: "LEV-1000", url: "https://linear.app/leverads/issue/LEV-1000", stateName: "Aguardando resposta", stateType: "started" },
    hermes: { labeled: true, active: true, holding: true, needsHuman: true, phase: "pergunta", phaseSince: iso(-1), history: hist(["relato", -6], ["trabalhando", -5], ["pergunta", -1]) } },
  { id: "tk9", number: 1036, saas: "leverads", subject: "[MegaPeças] título cortado na réplica", description: "", status: "resolved", priority: "normal", category: "Código · Bug", channel: "internal", customerId: "", requester: { name: "MegaPeças", email: "", phone: "" }, assignee: "", followers: [], createdAt: iso(-50), updatedAt: iso(-10), sla: sla(-50, 8, 48, { firstResponseAt: iso(-49), resolvedAt: iso(-10) }), attachments: [], messages: [], portalToken: "demo1036",
    linear: { issueId: "iss_990", identifier: "LEV-990", url: "https://linear.app/leverads/issue/LEV-990", stateName: "Done", stateType: "completed" },
    hermes: { labeled: true, active: true, holding: false, needsHuman: false, phase: "no_ar", phaseSince: iso(-10), version: 1, liveAt: "23:07", approvedBy: "leo", approvedVersion: 1, history: hist(["relato", -50], ["trabalhando", -48], ["validar", -30], ["aprovado", -28], ["no_ar", -10]) } },
  { id: "tk10", number: 1046, saas: "leverads", subject: "[Casa Bela] relatório de vendas zerado", description: "", status: "open", priority: "normal", category: "Código · Bug", channel: "internal", customerId: "", requester: { name: "Casa Bela", email: "", phone: "" }, assignee: "tiago", followers: ["tiago"], createdAt: iso(-8), updatedAt: iso(-2), sla: sla(-8, 8, 48, { firstResponseAt: iso(-7) }), attachments: [], messages: [], portalToken: "demo1046",
    linear: { issueId: "iss_1001", identifier: "LEV-1001", url: "https://linear.app/leverads/issue/LEV-1001", stateName: "In Progress", stateType: "started" },
    hermes: { labeled: true, active: false, holding: false, needsHuman: false, phase: "trabalhando", phaseSince: iso(-7), handoff: { at: iso(-2), to: "Tiago" }, history: hist(["relato", -8], ["trabalhando", -7]) } },
];
const CARD_FIELDS_MOCK = {
  problema: "Na cópia do Mercado Livre para a Shopee, o desconto da regra era aplicado duas vezes.",
  prova: "Anúncio de R$ 99,90 subia a **R$ 199,80** → agora sobe a **R$ 99,90**.",
  tela: "print ANTES · print DEPOIS · DEPOIS no celular (dados simulados)",
  banco: "Não.", risco: "Baixo: 2 arquivos, só a cópia para a Shopee.", publica: "Hoje, entre 23h e 04h.",
  aviso: "“Oi! Corrigimos o preço dobrado nas cópias para a Shopee. Pode testar replicando um anúncio?”",
};
const cardHermes = (v) => [`**Validar · v${v}**`, "", ...Object.entries({ "O que acontecia": "problema", Prova: "prova", Tela: "tela", "Mexe no banco?": "banco", Risco: "risco", "Quando publica": "publica", "Aviso ao cliente": "aviso" })
  .map(([rotulo, k]) => `**${rotulo}:** ${CARD_FIELDS_MOCK[k]}`), `**Versão:** v${v}`].join("\n");
const hermesView = (t) => {
  const h = t.hermes || {};
  const card = h.version ? { commentId: "c1", at: iso(-0.3), kind: "validation", version: h.version, risk: "baixo", touchesDb: false, images: [], fields: { ...CARD_FIELDS_MOCK, versao: `v${h.version}` } } : null;
  return { ...h, card, question: h.phase === "pergunta" ? { commentId: "c2", at: iso(-1), text: "Qual empresa é esse grupo? Há duas lojas com o nome Auto Center no cadastro." } : null, draftReply: "" };
};
const HERMES_PERM = { aprovar: ["validar"], ajuste: ["validar"], recusar: ["validar"], responder: ["pergunta"], desistir: ["aprovado"], reverter: ["no_ar"] };

const agents = [
  { id: "leo", name: "Leonardo", photo: "", support: true, admin: true, supportSaas: ["leverads"] },
  { id: "lucas", name: "Lucas", photo: "", support: true, admin: false, supportSaas: ["leverads"] },
  { id: "tiago", name: "Tiago", photo: "", support: true, admin: false, supportSaas: ["leverads", "elo"] },
];
let settings = {
  id: "leverads", saas: "leverads",
  policies: { urgent: { firstResponseMin: 60, resolutionMin: 480 }, high: { firstResponseMin: 240, resolutionMin: 1440 }, normal: { firstResponseMin: 480, resolutionMin: 2880 }, low: { firstResponseMin: 1440, resolutionMin: 7200 } },
  businessHours: { enabled: true, hourStart: 8, hourEnd: 18 }, pauseOn: ["pending_customer"],
  categories: ["Dúvida", "Problema técnico", "Financeiro", "Sugestão"], autoCloseResolvedDays: 7, warnAt: 0.8,
  portal: { enabled: true, intro: "Respondemos em até 1 dia útil." }, notifyCustomerByEmail: false,
  ...(comHermes() ? { linear: { enabled: true, teamId: "demo-team", projectId: "demo-project", hermes: { enabled: true, label: "Hermes", approvers: ["leo"], actions: true, publishWindow: "noite", phases: {} } } } : {}),
};
if (comHermes()) tickets = [...hermesTickets, ...tickets];

// Respostas rápidas: o dublê resolve as variáveis por substituição simples
// (a régua de verdade é a do servidor, em quick-replies.js).
let quickReplies = [
  { id: "qr1", scope: "shared", saas: "leverads", owner: "", title: "Boas-vindas", shortcut: "boas-vindas", body: "{{saudacao}}, {{cliente.primeiro_nome}}!\n\nRecebemos o seu chamado #{{ticket.numero}} e já estamos olhando. Nosso horário de atendimento é {{horario_atendimento}}.\n\n{{atendente.primeiro_nome}} · {{produto.nome}}", uses: 42 },
  { id: "qr2", scope: "shared", saas: "leverads", owner: "", title: "Pedir print da tela", shortcut: "print", body: "{{cliente.primeiro_nome}}, consegue me mandar um print da tela com o erro? Pode responder por aqui: {{ticket.link}}", uses: 17 },
  { id: "qr3", scope: "shared", saas: "leverads", owner: "", title: "Resolvido", shortcut: "resolvido", body: "Pronto, {{cliente.primeiro_nome}}! O chamado #{{ticket.numero}} foi resolvido. Se precisar de algo, é só responder esta mensagem.", uses: 9 },
  { id: "qr4", scope: "personal", saas: "", owner: "leo", title: "Minha assinatura", shortcut: "assinatura", body: "Abraço,\n{{atendente.nome}}\nSuporte {{produto.nome}}", uses: 3 },
];
let variaveis = [{ key: "horario_atendimento", value: "de segunda a sexta, das 8h às 18h", label: "" }, { key: "link_ajuda", value: "https://ajuda.leverads.com.br", label: "" }];
const BUILTIN = [
  ["saudacao", "Bom dia, boa tarde ou boa noite (horário de Brasília)"], ["cliente.primeiro_nome", "Primeiro nome do solicitante"], ["cliente.nome", "Nome completo do solicitante"],
  ["cliente.email", "E-mail do solicitante"], ["cliente.empresa", "Cliente vinculado ao ticket"], ["ticket.numero", "Número do ticket"], ["ticket.assunto", "Assunto do ticket"],
  ["ticket.status", "Status atual"], ["ticket.prioridade", "Prioridade"], ["ticket.prazo", "Prazo de resolução do SLA"], ["ticket.link", "Link do chamado no portal do cliente"],
  ["atendente.primeiro_nome", "Seu primeiro nome"], ["atendente.nome", "Seu nome completo"], ["produto.nome", "Nome do produto"], ["hoje", "Data de hoje"],
].map(([key, label]) => ({ key, label }));
const renderMock = (body, t) => {
  const v = { saudacao: "Boa tarde", "atendente.nome": "Leonardo", "atendente.primeiro_nome": "Leonardo", "produto.nome": "LeverAds", hoje: new Date().toLocaleDateString("pt-BR"),
    "cliente.nome": t?.requester?.name || "Carla Nunes", "cliente.primeiro_nome": (t?.requester?.name || "Carla").split(" ")[0], "cliente.email": t?.requester?.email || "", "cliente.empresa": "",
    "ticket.numero": String(t?.number || 1042), "ticket.assunto": t?.subject || "Relatório mensal", "ticket.status": "Em atendimento", "ticket.prioridade": "Normal", "ticket.prazo": "15/09 às 18:00",
    "ticket.link": `${location.origin}/s/${t?.portalToken || "demo"}`, ...Object.fromEntries(variaveis.map((x) => [x.key, x.value])) };
  const missing = [], empty = [];
  const text = String(body).replace(/\{\{\s*([a-z][a-z0-9_.]*)\s*\}\}/gi, (all, k) => { if (!(k in v)) { missing.push(k); return all; } if (!v[k]) empty.push(k); return v[k]; });
  return { text, missing, empty };
};

const resumo = (t) => { const { messages = [], ...rest } = t; const last = messages[messages.length - 1]; return { ...rest, messageCount: messages.length, lastMessage: last ? { kind: last.kind, authorType: last.author.type, at: last.at, excerpt: last.text.slice(0, 120) } : null }; };
const achar = (id) => tickets.find((t) => t.id === id);
const trocar = (id, patch) => { tickets = tickets.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: new Date().toISOString() } : t)); return achar(id); };

export const ticketsMock = {
  tickets: (q = {}) => new URLSearchParams(location.search).has("empty") ? [] : tickets.filter((t) => (!q.saas || t.saas === q.saas) && (!q.customerId || t.customerId === q.customerId)).map(resumo),
  ticket: (id) => achar(id),
  ticketDelete: (id) => { tickets = tickets.filter(t => t.id !== id); return {ok:true}; },
  ticketCreate: (body) => {
    const t = { id: `tk${Date.now()}`, number: 1044 + tickets.length, status: body.assignee ? "open" : "new", channel: "internal", followers: [], messages: [], attachments: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), sla: sla(0, 8, 48), portalToken: "demo", requester: { name: "", email: "", phone: "" }, ...body };
    tickets = [t, ...tickets];
    return t;
  },
  ticketUpdate: (id, patch) => trocar(id, { ...patch, ...(patch.requester ? { requester: { ...achar(id).requester, ...patch.requester } } : {}) }),
  ticketMessage: (id, { kind, text, status }) => {
    const t = achar(id);
    const m = { id: `m${Date.now()}`, kind: kind || "reply", author: { type: "agent", id: "leo" }, text, at: new Date().toISOString() };
    return { message: m, emailed: false, ticket: trocar(id, { messages: [...t.messages, m], ...(status ? { status } : {}), ...(kind !== "note" && !t.sla.firstResponseAt ? { sla: { ...t.sla, firstResponseAt: m.at } } : {}) }) };
  },
  ticketActivity: (id) => [{ id: "e1", type: "created", by: "api", at: achar(id)?.createdAt, data: { channel: achar(id)?.channel } }],
  ticketsBulk: () => ({ ok: [], missing: [], failed: [] }),
  supportAgents: () => new URLSearchParams(location.search).has("empty") ? [] : agents,
  linearCatalog: () => new URLSearchParams(location.search).has("linear") ? ({configured:true,organization:"Equipe fictícia",viewer:"Bot do Cockpit",people:[{id:"lin_hermes",name:"Hermes"},{id:"lin_leo",name:"Leonardo"},{id:"lin_tiago",name:"Tiago"}],teams:[{id:"demo-team",key:"SUP",name:"Suporte",projects:[{id:"demo-project",name:"Atendimento"}],states:["Backlog","Aguardando resposta","In Progress","In Review","Validar","Aprovado","Done","Canceled"].map((name,i)=>({id:`st${i}`,name,type:name==="Done"?"completed":name==="Canceled"?"canceled":name==="Backlog"?"backlog":"started"}))}]}) : ({configured:false,teams:[]}),
  supportSettings: () => ({ ...settings, variables: variaveis }),
  supportSettingsSave: (_saas, body) => { (window.__supportSaves ||= []).push({saas:_saas,body:structuredClone(body)}); if (body.variables) variaveis = body.variables; settings = { ...settings, ...body }; return { ...settings, variables: variaveis }; },
  quickReplies: () => ({ items: (new URLSearchParams(location.search).has("empty") ? [] : quickReplies).map((q) => ({ ...q, editable: q.scope === "personal" || !new URLSearchParams(location.search).has("readonly") })), canEditShared: !new URLSearchParams(location.search).has("readonly"), variables: { builtin: BUILTIN, custom: variaveis } }),
  quickReplyCreate: (body) => { const q = { id: `qr${Date.now()}`, uses: 0, owner: body.scope === "personal" ? "leo" : "", ...body }; quickReplies = [...quickReplies, q]; return { ...q, editable: true }; },
  quickReplyUpdate: (id, patch) => { quickReplies = quickReplies.map((q) => (q.id === id ? { ...q, ...patch } : q)); return { ...quickReplies.find((q) => q.id === id), editable: true }; },
  quickReplyDelete: (id) => { quickReplies = quickReplies.filter((q) => q.id !== id); return { ok: true }; },
  quickReplyPreview: (_saas, body) => renderMock(typeof body === "string" ? body : body.body, null),
  ticketQuickReply: (ticketId, qrId) => { const q = quickReplies.find((x) => x.id === qrId); return { id: qrId, title: q.title, ...renderMock(q.body, achar(ticketId)) }; },
  ticketLinear: (id) => {
    const t = achar(id);
    return { linked: true, configured: true, stale: false, identifier: t?.linear?.identifier || "", url: t?.linear?.url || "", state: { name: t?.linear?.stateName || "", type: t?.linear?.stateType || "" },
      labels: t?.hermes ? ["Hermes", "Bug"] : [],
      issue: { id: t?.linear?.issueId, title: t?.subject, description: "Cliente reclamou no grupo do WhatsApp (áudio transcrito).", priority: 2, assignee: t?.hermes?.handoff?.to || "", project: "CS - Suporte" },
      comments: t?.hermes?.version ? [{ id: "c1", body: cardHermes(t.hermes.version), createdAt: iso(-0.3), url: "", user: { id: "lin_hermes", name: "Hermes" }, fromCockpit: false }] : [],
      hermes: t?.hermes ? hermesView(t) : null };
  },
  ticketHermes: (id) => {
    const t = achar(id); const h = t?.hermes || {};
    const allowed = Object.fromEntries(Object.entries(HERMES_PERM).map(([a, fases]) => [a, !!h.active && fases.includes(h.phase)]));
    allowed.perguntar = !!h.holding; allowed.passar_time = !!h.holding;
    allowed.entregar = !h.active && !h.requested && t?.status !== "resolved" && t?.status !== "closed";
    return { enabled: comHermes(), actions: true, approver: true, publishWindow: "noite", allowed, mirror: true, hermes: t?.hermes || null,
      people: [{ id: "lin_tiago", name: "Tiago" }, { id: "lin_leo", name: "Leonardo" }] };
  },
  ticketHermesAction: (id, body) => {
    (window.__hermesActions ||= []).push({ id, body: structuredClone(body) });
    const t = achar(id); const h = t.hermes || {};
    const fase = { aprovar: "aprovado", ajuste: "trabalhando", recusar: "cancelado", responder: "trabalhando", desistir: "validar", reverter: "validar" }[body.action];
    const at = new Date().toISOString();
    let hermes = { ...h, lastAction: { action: body.action, version: h.version || 0, by: "leo", at } };
    if (fase) hermes = { ...hermes, phase: fase, phaseSince: at, needsHuman: fase === "validar", holding: fase !== "cancelado", history: [...(h.history || []), { phase: fase, at }], ...(body.action === "aprovar" ? { approvedBy: "leo", approvedVersion: h.version } : {}) };
    if (body.action === "passar_time") hermes = { ...hermes, active: false, holding: false, needsHuman: false, handoff: { at, to: "Tiago" } };
    if (body.action === "entregar") hermes = { ...hermes, requested: { at, by: "leo" } };
    return trocar(id, { hermes });
  },
  supportAgentSave: (id, body) => { (window.__agentSaves ||= []).push({id,body:structuredClone(body)}); const a = agents.find((x) => x.id === id); Object.assign(a, body); return a; },
};
