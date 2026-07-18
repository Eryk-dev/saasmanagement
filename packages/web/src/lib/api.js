// Thin API client for the cockpit web app. In dev, VITE_API_BASE is empty and
// Vite proxies /api -> the Fastify server. For a remote build, set VITE_API_BASE.
//
// Auth: when the API requires a key, it's entered once in the unlock screen and
// kept in localStorage; every request carries it as `x-api-key`. VITE_API_KEY is
// a build-time fallback (mostly for local dev convenience).

const BASE = import.meta.env.VITE_API_BASE || "";
const STORAGE_KEY = "cockpit_key";

export function getKey() {
  try { return localStorage.getItem(STORAGE_KEY) || import.meta.env.VITE_API_KEY || ""; }
  catch { return import.meta.env.VITE_API_KEY || ""; }
}
export function setKey(k) { try { localStorage.setItem(STORAGE_KEY, k); } catch { /* ignore */ } }
export function clearKey() { try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ } }

async function req(method, path, body) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  const key = getKey();
  if (key) headers["x-api-key"] = key;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`API ${method} ${path} -> ${res.status} ${text}`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

// URL do stream de mudanças (SSE). EventSource não manda headers — a key/token
// vai em ?key= (o servidor só aceita query key nessa rota).
export function eventsUrl() {
  return `${BASE}/api/events?key=${encodeURIComponent(getKey())}`;
}

export const api = {
  bootstrap: () => req("GET", "/api/bootstrap"),
  // Auth do time: o token de sessão entra no MESMO slot da key (localStorage +
  // header x-api-key) — o resto do client não muda.
  login: (username, password) => req("POST", "/api/auth/login", { username, password }),
  logout: () => req("POST", "/api/auth/logout", {}),
  changePassword: (current, password) => req("POST", "/api/auth/password", { current, password }),
  // Usuários do time (lista sanitizada) — responsáveis do kanban de tarefas.
  listUsers: () => req("GET", "/api/auth/users"),
  list: (collection, query = {}) => {
    const qs = new URLSearchParams(query).toString();
    return req("GET", `/api/${collection}${qs ? `?${qs}` : ""}`);
  },
  get: (collection, id) => req("GET", `/api/${collection}/${id}`),
  create: (collection, obj) => req("POST", `/api/${collection}`, obj),
  update: (collection, id, patch) => req("PATCH", `/api/${collection}/${id}`, patch),
  remove: (collection, id) => req("DELETE", `/api/${collection}/${id}`),
  // Convenience used by the pipeline drag-and-drop to persist a stage move.
  // Leads ARE the pipeline cards now, so a move patches the lead's stage.
  moveLead: (id, stage) => req("PATCH", `/api/leads/${id}`, { stage }),
  // Cockpit → Levercopy: gera/re-gera a proposta de um lead. `auto` = gatilho
  // automático (best-effort, respeita idempotência); `force` = re-gerar manual.
  generateProposal: (id, { auto = false, force = false } = {}) => {
    const q = [auto && "auto=1", force && "force=1"].filter(Boolean).join("&");
    return req("POST", `/api/leads/${id}/proposal${q ? `?${q}` : ""}`);
  },
  // Builders: preview server-side do rascunho (mesmo HTML da página pública).
  formPreview: (draft) => req("POST", "/api/forms/preview", draft),
  // Funil de drop-off do form: sessões únicas por etapa. `since` (ISO) filtra o período.
  formFunnel: (id, { since, until } = {}) => {
    const q = new URLSearchParams();
    if (since) q.set("since", since);
    if (until) q.set("until", until);
    return req("GET", `/api/forms/${id}/funnel${q.toString() ? `?${q}` : ""}`);
  },
  // Gerenciamento de campanha Meta (status/orçamento direto do cockpit).
  metaAdsets: (campaignId) => req("GET", `/api/marketing/campaigns/${campaignId}/adsets`),
  adObjects: (saas) => req("GET", `/api/marketing/${saas}/adobjects`),
  metaObjectStatus: (id, status) => req("POST", `/api/marketing/objects/${id}/status`, { status }),
  metaObjectBudget: (id, dailyBudget) => req("POST", `/api/marketing/objects/${id}/budget`, { dailyBudget }),
  creativeDefaults: (saas) => req("GET", `/api/marketing/${saas}/creative-defaults`),
  // Google Meet: URL de consentimento (Ajustes) + criar a call do lead na agenda.
  googleAuthUrl: () => req("GET", "/api/google/auth-url"),
  // Conexão Google PESSOAL (por usuário): status, link de consentimento e desconectar.
  // Cada pessoa conecta a própria conta pra receber calls/integrações na agenda.
  googleUserStatus: () => req("GET", "/api/google/user/status"),
  googleUserAuthUrl: () => req("GET", "/api/google/user/auth-url"),
  googleUserDisconnect: () => req("POST", "/api/google/user/disconnect"),
  // body opcional: { guests: [emails] } ou { email } — convidados extras da call.
  createMeet: (leadId, body) => req("POST", `/api/leads/${leadId}/meet`, body),
  // WhatsApp (Cloud API): envia mensagem pelo drawer do lead.
  sendWhatsapp: (leadId, text) => req("POST", `/api/leads/${leadId}/whatsapp`, { text }),
  // Inbox de WhatsApp: lista de conversas, mensagens de uma conversa, marcar
  // lida e enviar pela conversa (id = número em dígitos, com ou sem lead).
  waNumber: () => req("GET", "/api/whatsapp/number"),
  waThreads: () => req("GET", "/api/whatsapp/threads"),
  waThread: (id) => req("GET", `/api/whatsapp/threads/${id}`),
  waThreadRead: (id) => req("POST", `/api/whatsapp/threads/${id}/read`, {}),
  waThreadSend: (id, text) => req("POST", `/api/whatsapp/threads/${id}/send`, { text }),
  callSummary: (leadId, force = false, kind = "call") => req("POST", `/api/leads/${leadId}/call-summary`, { force, kind }),
  // Briefing de passagem pro integrador (lê a transcrição da call de VENDA).
  integrationBrief: (leadId, force = false) => req("POST", `/api/leads/${leadId}/integration-brief`, { force }),
  // Insight de pitch: analisa os resumos das calls do produto e sugere uma
  // versão melhor de um roteiro. body: { scriptKey, scriptLabel, currentScript }.
  improvePitch: (saas, body) => req("POST", `/api/pitch/${saas}/improve`, body),
  // UniqueKids: gera a sugestão de solução da rotina (IA, método R.O.T.I.N.A).
  routineSuggestion: (leadId) => req("POST", `/api/leads/${leadId}/routine-suggestion`, {}),
  // Consultas 1:1 (mentoria UniqueKids): Meet da consulta (transcrição automática),
  // resumo manual por IA e compor o Manual da Família a partir das consultas.
  consultationMeet: (id) => req("POST", `/api/consultations/${id}/meet`, {}),
  consultationSummary: (id, force = false) => req("POST", `/api/consultations/${id}/summary`, { force }),
  composeManual: (id) => req("POST", `/api/deliverables/${id}/compose`, {}),
  // Análise de pitch: estatísticas agregadas das calls resumidas + calls recentes.
  // closer opcional (undefined = todos; "" = sem closer) separa a análise por closer.
  pitchCalls: (saas, closer) => req("GET", `/api/pitch/${saas}/calls${closer != null ? `?closer=${encodeURIComponent(closer)}` : ""}`),
  // Análise de integração: sentimento, pendências recorrentes e integrações recentes.
  // integrator opcional (undefined = todos; "" = sem integrador) separa por integrador.
  integrationAnalysis: (saas, integrator) => req("GET", `/api/integrations/${saas}/summary${integrator != null ? `?integrator=${encodeURIComponent(integrator)}` : ""}`),
  // Upload multipart (vídeo) — fetch cru: o browser define o boundary do form.
  uploadCreative: async (saas, formData) => {
    const headers = {};
    const key = getKey();
    if (key) headers["x-api-key"] = key;
    const res = await fetch(`${BASE}/api/marketing/${saas}/creatives`, { method: "POST", headers, body: formData });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      let msg = text;
      try { msg = JSON.parse(text).error || text; } catch { /* texto cru */ }
      const err = new Error(msg || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return JSON.parse(text);
  },
  // Criar anúncio clonando um conjunto e trocando o vídeo (multipart, mesmo padrão).
  adFromVideo: async (saas, formData) => {
    const headers = {};
    const key = getKey();
    if (key) headers["x-api-key"] = key;
    const res = await fetch(`${BASE}/api/marketing/${saas}/ad-from-video`, { method: "POST", headers, body: formData });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      let msg = text;
      try { msg = JSON.parse(text).error || text; } catch { /* texto cru */ }
      const err = new Error(msg || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return JSON.parse(text);
  },
  // Gasto com IA (OpenRouter/OpenAI/Anthropic), agregado em USD.
  aiCosts: (days) => req("GET", `/api/ai-costs${days ? `?days=${days}` : ""}`),
  // Custos operacionais do mês (ads + IA automáticos + lançamentos manuais).
  expensesSummary: (saas, month) => req("GET", `/api/expenses/summary/${saas}${month ? `?month=${month}` : ""}`),
  // Mídia social: métricas do perfil, histórico e publicação orgânica (IG/FB).
  socialSummary: (saas, days) => req("GET", `/api/social/summary?saas=${encodeURIComponent(saas)}${days ? `&days=${days}` : ""}`),
  // Só a contagem líquida de novos seguidores (~24h) + o @ do perfil, pro aviso
  // de social selling do Meu dia (o IG não expõe a lista de quem seguiu).
  newFollowers: (saas) => req("GET", `/api/social/new-followers/${encodeURIComponent(saas)}`),
  socialAudience: (saas) => req("GET", `/api/social/audience?saas=${encodeURIComponent(saas)}`),
  socialPosts: (saas) => req("GET", `/api/social/posts?saas=${encodeURIComponent(saas)}`),
  // Links de pagamento das ofertas (ferramenta) — leitura e edição pra todo o time.
  offers: (saas) => req("GET", `/api/offers/${encodeURIComponent(saas)}`),
  saveOffers: (saas, items) => req("PUT", `/api/offers/${encodeURIComponent(saas)}`, { items }),
  // Disparos (ferramenta): CRUD da campanha via api.list/create/update("campaigns").
  // `mark` grava um envio feito (fila assistida) + loga o toque na timeline; `aiCopy`
  // sugere a copy do disparo por IA.
  campaignMark: (id, body) => req("POST", `/api/campaigns/${encodeURIComponent(id)}/mark`, body),
  campaignAiCopy: (body) => req("POST", "/api/campaigns/ai-copy", body),
  // Envio nativo de e-mail em massa pela conta Google conectada.
  campaignSendEmail: (id, leadIds) => req("POST", `/api/campaigns/${encodeURIComponent(id)}/send-email`, { leadIds }),
  // Métricas de conversão no funil por campanha do produto.
  campaignMetrics: (saas) => req("GET", `/api/campaigns/metrics/${encodeURIComponent(saas)}`),
  // Sequências (drip): CRUD via api.list/create/update("sequences"/"drip_templates").
  sequenceEnroll: (id, leadIds) => req("POST", `/api/sequences/${encodeURIComponent(id)}/enroll`, { leadIds }),
  sequenceWaSent: (enrollmentId) => req("POST", "/api/sequences/wa-sent", { enrollmentId }),
  sequenceMetrics: (saas) => req("GET", `/api/sequences/metrics/${encodeURIComponent(saas)}`),
  sequenceRun: () => req("POST", "/api/sequences/run", {}),
  // Metas de desempenho por vaga/pessoa (ferramenta; escreve na collection goals).
  metas: (saas) => req("GET", `/api/metas/${encodeURIComponent(saas)}`),
  saveMetas: (saas, goals) => req("PUT", `/api/metas/${encodeURIComponent(saas)}`, { goals }),
  // Treinamentos: base de flashcards por vaga + fila FSRS individual (Anki).
  flashcards: (saas) => req("GET", `/api/flashcards/${encodeURIComponent(saas)}`),
  saveFlashcards: (saas, cards, settings) => req("PUT", `/api/flashcards/${encodeURIComponent(saas)}`, settings ? { cards, settings } : { cards }),
  trainingQueue: (saas) => req("GET", `/api/flashcards/${encodeURIComponent(saas)}/queue`),
  trainingReview: (saas, cardId, rating, ms) => req("POST", `/api/flashcards/${encodeURIComponent(saas)}/review`, { cardId, rating, ms }),
  trainingTeam: (saas) => req("GET", `/api/flashcards/${encodeURIComponent(saas)}/team`),
  trainingStats: (saas) => req("GET", `/api/flashcards/${encodeURIComponent(saas)}/stats`),
  trainingExamStart: (saas, id) => req("POST", `/api/flashcards/${encodeURIComponent(saas)}/exam/${encodeURIComponent(id)}/start`, {}),
  trainingExamSubmit: (saas, id, answers) => req("POST", `/api/flashcards/${encodeURIComponent(saas)}/exam/${encodeURIComponent(id)}/submit`, { answers }),
  // Imagem de flashcard (colada/enviada no editor) → asset servido em /public/training/:id.
  trainingAsset: async (saas, blob, name = "card.png") => {
    const fd = new FormData();
    fd.append("file", blob, name);
    const key = getKey();
    const res = await fetch(`${BASE}/api/flashcards/${encodeURIComponent(saas)}/asset`, {
      method: "POST",
      headers: key ? { "x-api-key": key } : {},
      body: fd,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(`API POST asset -> ${res.status} ${text}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  },
  trainingAssetUrl: (id) => `${BASE}/public/training/${encodeURIComponent(id)}`,
  socialPublish: (payload) => req("POST", "/api/social/publish", payload),
  // Copy do post por IA: preenche os campos do template + legenda a partir da dor.
  socialAiCopy: (payload) => req("POST", "/api/social/ai-copy", payload),
  // Upload de mídia (PNG do editor / vídeo) → asset com URL pública que a Meta baixa.
  socialUpload: async (blob, name, saas) => {
    const fd = new FormData();
    fd.append("saas", saas || "");
    fd.append("file", blob, name);
    const key = getKey();
    const res = await fetch(`${BASE}/api/social/assets`, {
      method: "POST",
      headers: key ? { "x-api-key": key } : {},
      body: fd,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(`API POST /api/social/assets -> ${res.status} ${text}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  },
  // CAC/LTV + série mensal (fase 4). days = janela do CAC; months = série.
  metrics: (saas, { days, months } = {}) => {
    const q = new URLSearchParams();
    if (days) q.set("days", days);
    if (months) q.set("months", months);
    return req("GET", `/api/metrics/${saas}${q.toString() ? `?${q}` : ""}`);
  },
  proposalPreview: (payload) => req("POST", "/api/proposals/preview", payload),
  // Ajustes (fase 3): grava o funil migrando estágios renomeados (lead/deal.stage
  // não têm FK — o servidor reaponta os cards junto).
  saveFunnel: (productId, funnel, renames) => req("PUT", `/api/products/${productId}/funnel`, { funnel, renames }),
  // Billing (fase 5).
  changeSubscription: (id, body) => req("POST", `/api/subscriptions/${id}/change`, body),
  payInvoice: (id) => req("POST", `/api/invoices/${id}/pay`),
  runBilling: () => req("POST", "/api/billing/run", {}),
  // Mercado Pago: gera o link de autorização da assinatura (preapproval).
  mpLink: (subId, payerEmail) => req("POST", `/api/subscriptions/${subId}/mp/link`, payerEmail ? { payerEmail } : {}),
  // Marketing (Meta Ads): sync de insights + métricas cruzadas com o funil.
  marketingSync: (body = {}) => req("POST", "/api/marketing/sync", body),
  marketingMetrics: (saas, { since, until } = {}) => {
    const q = new URLSearchParams();
    if (since) q.set("since", since);
    if (until) q.set("until", until);
    return req("GET", `/api/marketing/${saas}${q.toString() ? `?${q}` : ""}`);
  },
  // CRM: timeline do lead (pontos de contato + eventos automáticos).
  listActivities: (leadId) => req("GET", `/api/activities?lead=${encodeURIComponent(leadId)}`),
  logActivity: (a) => req("POST", "/api/activities", a),
  // Métricas reais de funil (conversão/tempo por etapa, perdas, SLA de 1º toque).
  funnelAnalytics: (saas, { since, until } = {}) => {
    const q = new URLSearchParams();
    if (since) q.set("since", since);
    if (until) q.set("until", until);
    return req("GET", `/api/funnel/${saas}${q.toString() ? `?${q}` : ""}`);
  },
  // Pace mensal de caixa: faturas pagas → meta diária por papel do funil.
  pipelinePace: (saas) => req("GET", `/api/pipeline-pace/${encodeURIComponent(saas)}`),
  // Placar por pessoa/papel (SDR/closer/CS) — cockpit de gestão da Visão geral.
  scoreboard: (saas, { since, until, prevSince, prevUntil } = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ since, until, prevSince, prevUntil })) if (v) q.set(k, v);
    return req("GET", `/api/scoreboard/${saas}${q.toString() ? `?${q}` : ""}`);
  },
  // Catálogo id → nome (campanha/conjunto/anúncio) pro bloco de atribuição.
  marketingAttribution: (saas) => req("GET", `/api/marketing/${saas}/attribution`),
  // Variante de welcome por IA (insight "welcome fraca" → aplicar).
  suggestWelcome: (formId, body = {}) => req("POST", `/api/forms/${formId}/suggest-welcome`, body),
  // Breakdown por placement (plataforma × posição), ao vivo da Meta.
  marketingPlacements: (saas, { since, until } = {}) => {
    const q = new URLSearchParams();
    if (since) q.set("since", since);
    if (until) q.set("until", until);
    return req("GET", `/api/marketing/${saas}/placements${q.toString() ? `?${q}` : ""}`);
  },
  // Equipe: etiquetas de papel (sdr/closer/integrator), criação e reset de senha.
  updateUser: (id, patch) => req("PATCH", `/api/auth/users/${id}`, patch),
  createUser: ({ name, password, roles }) => req("POST", "/api/auth/users", { name, password, ...(roles ? { roles } : {}) }),
  // Remove um usuário do time. force=true remove mesmo com leads atribuídos (409 sem force).
  removeUser: (id, force = false) => req("DELETE", `/api/auth/users/${id}${force ? "?force=1" : ""}`),
};
