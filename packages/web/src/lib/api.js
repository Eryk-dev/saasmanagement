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

// POST multipart (vídeo/áudio/imagem) — fetch cru: o browser define o boundary.
// Erro vira mensagem legível: quando quem responde é o proxy (413 do nginx, 502
// de gateway) o corpo é HTML, e jogar essa página na tela não diz nada ao time.
async function upload(path, formData) {
  const headers = {};
  const key = getKey();
  if (key) headers["x-api-key"] = key;
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers, body: formData });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    let msg = "";
    try { msg = JSON.parse(text).error || ""; } catch { /* não é JSON: veio do proxy */ }
    if (!msg) {
      msg = res.status === 413
        ? "arquivo grande demais pro servidor (limite 512 MB) — comprima o vídeo e tente de novo"
        : `HTTP ${res.status} (resposta do proxy, não da API)`;
    }
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return JSON.parse(text);
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
  // Ofertas do deck do lead (a principal + as secretas da escada) e o link
  // pronto pro cliente de UMA delas — o que vai no WhatsApp.
  proposalOffers: (id) => req("GET", `/api/leads/${id}/proposal-offers`),
  shareProposal: (id, offer) => req("POST", `/api/leads/${id}/proposal-share`, { offer }),
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
  // Mídia do criativo de um anúncio (vídeo/imagem) pra pré-visualizar.
  adCreative: (saas, adId) => req("GET", `/api/marketing/${saas}/ad/${adId}/creative`),
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
  // Encerra a conferência aberta da sala (sala esquecida trava a transcrição).
  endMeet: (leadId, kind = "call") => req("POST", `/api/leads/${leadId}/meet/end`, { kind }),
  // WhatsApp (Cloud API): envia mensagem pelo drawer do lead.
  sendWhatsapp: (leadId, text) => req("POST", `/api/leads/${leadId}/whatsapp`, { text }),
  // Inbox de WhatsApp: lista de conversas, mensagens de uma conversa, marcar
  // lida e enviar pela conversa (id = número em dígitos, com ou sem lead).
  waNumber: (saas) => req("GET", `/api/whatsapp/number${saas ? `?saas=${encodeURIComponent(saas)}` : ""}`),
  // Números do inbox (esperando resposta, tempo de resposta, janela de 24h) +
  // saúde do número, pro painel no topo da tela.
  waInsights: (days) => req("GET", `/api/whatsapp/insights${days ? `?days=${days}` : ""}`),
  waThreads: () => req("GET", "/api/whatsapp/threads"),
  waThread: (id) => req("GET", `/api/whatsapp/threads/${id}`),
  waThreadRead: (id) => req("POST", `/api/whatsapp/threads/${id}/read`, {}),
  // Encerrar/reabrir a conversa (status do inbox; mensagem nova reabre sozinha).
  waThreadClose: (id, closed = true) => req("POST", `/api/whatsapp/threads/${id}/close`, { closed }),
  // Vincula (ou desvincula, com leadId vazio) uma conversa órfã a um lead.
  waLinkThread: (id, leadId) => req("POST", `/api/whatsapp/threads/${id}/link`, { leadId }),
  waThreadSend: (id, text) => req("POST", `/api/whatsapp/threads/${id}/send`, { text }),
  // Enviar mídia (áudio de voz, imagem, documento) pela conversa: sobe o
  // arquivo, o servidor manda pelo WhatsApp e devolve o id da mensagem.
  waSendMedia: async (threadId, blob, { filename = "audio.ogg", caption = "" } = {}) => {
    const fd = new FormData();
    fd.append("file", blob, filename);
    if (caption) fd.append("caption", caption);
    const key = getKey();
    const res = await fetch(`${BASE}/api/whatsapp/threads/${encodeURIComponent(threadId)}/media`, {
      method: "POST", headers: key ? { "x-api-key": key } : {}, body: fd,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let msg = text; try { msg = JSON.parse(text).error || text; } catch { /* texto cru */ }
      const err = new Error(String(msg).slice(0, 240) || `envio de mídia -> ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  },
  // Mídia recebida (áudio/imagem/…): baixa o binário autenticado (a Graph só
  // entrega com token) e devolve um Blob pra tocar/exibir via object URL.
  waMedia: async (msgId) => {
    const key = getKey();
    const res = await fetch(`${BASE}/api/whatsapp/media/${encodeURIComponent(msgId)}`, { headers: key ? { "x-api-key": key } : {} });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(text.slice(0, 200) || `mídia -> ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.blob();
  },
  // Templates APROVADOS na Meta + envio de um deles (o único jeito de reabrir
  // conversa fora da janela de 24h). params = valores das variáveis {{1}}…{{N}}.
  waMetaTemplates: () => req("GET", "/api/whatsapp/templates"),
  // Cria/submete um template pra aprovação da Meta (nasce PENDING; aprovado,
  // entra no composer sozinho). { name, category, language, body, example[] }.
  waCreateTemplate: (payload) => req("POST", "/api/whatsapp/templates", payload),
  waThreadSendTemplate: (id, { name, language, params }) => req("POST", `/api/whatsapp/threads/${id}/send-template`, { name, language, params }),
  // Ligação pelo cockpit (Calling API): inicia com a oferta SDP do browser,
  // faz poll do estado (o answer chega via webhook) e encerra.
  waCallStart: (id, sdp) => req("POST", `/api/whatsapp/threads/${id}/call`, { sdp }),
  waCallState: (callId) => req("GET", `/api/whatsapp/calls/${encodeURIComponent(callId)}`),
  // Gravação da ligação (os dois lados, estéreo): o servidor transcreve e, com
  // lead na conversa, resume igual às calls de Meet.
  waCallRecording: async (callId, blob, secs = 0) => {
    const fd = new FormData();
    fd.append("file", blob, `call-${callId}.webm`);
    const key = getKey();
    const res = await fetch(`${BASE}/api/whatsapp/calls/${encodeURIComponent(callId)}/recording?secs=${Math.round(secs)}`, {
      method: "POST", headers: key ? { "x-api-key": key } : {}, body: fd,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(text.slice(0, 200) || `API POST recording -> ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  },
  waCallEnd: (callId) => req("POST", `/api/whatsapp/calls/${encodeURIComponent(callId)}/end`, {}),
  // Fluxo de permissão de ligação: alertas quentes (lead respondeu → pop-up),
  // resolver alerta e pedido manual de permissão numa conversa.
  waAlerts: () => req("GET", "/api/whatsapp/alerts"),
  waAlertDone: (id) => req("POST", `/api/whatsapp/alerts/${id}/done`, {}),
  waCallPermission: (id, saas) => req("POST", `/api/whatsapp/threads/${id}/call-permission`, saas ? { saas } : {}),
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
  uploadCreative: (saas, formData) => upload(`/api/marketing/${saas}/creatives`, formData),
  // Criar anúncio clonando um conjunto e trocando o vídeo (multipart, mesmo padrão).
  adFromVideo: (saas, formData) => upload(`/api/marketing/${saas}/ad-from-video`, formData),
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
  // `company` (opcional): meta da empresa — { cashTarget } vai pro
  // product.monthlyCashTarget (a meta que a Visão geral e a Análise perseguem).
  metas: (saas) => req("GET", `/api/metas/${encodeURIComponent(saas)}`),
  saveMetas: (saas, goals, company) => req("PUT", `/api/metas/${encodeURIComponent(saas)}`, company ? { goals, company } : { goals }),
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
  // Comentários de IG/página do FB: fila + ações. `sync` força a varredura na
  // Meta (o padrão tem throttle de 1 min no servidor); o webhook já faz o
  // comentário novo cair no banco sozinho.
  socialComments: (saas, status = "pending", sync = false) =>
    req("GET", `/api/social/comments?saas=${encodeURIComponent(saas)}&status=${encodeURIComponent(status)}${sync ? "&sync=1" : ""}`),
  socialCommentReply: (id, text) => req("POST", `/api/social/comments/${encodeURIComponent(id)}/reply`, { text }),
  socialCommentHide: (id, hide) => req("POST", `/api/social/comments/${encodeURIComponent(id)}/hide`, { hide }),
  socialCommentDone: (id, done) => req("POST", `/api/social/comments/${encodeURIComponent(id)}/done`, { done }),
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
