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

// Nossa API não responde 5xx de propósito (o proxy engoliria o corpo, ver
// http-status.js), então 5xx aqui é sempre infraestrutura: proxy, container
// reiniciando ou bug não tratado.
function proxyMessage(status) {
  if (status === 413) return "arquivo grande demais pro servidor (limite 512 MB) — comprima o vídeo e tente de novo";
  if (status === 502 || status === 503 || status === 504) return "o servidor não respondeu (deploy rodando ou container reiniciando) — espere uns segundos e tente de novo";
  return `HTTP ${status} (resposta do proxy, não da API)`;
}

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
    // Erro nosso vem em JSON com `error`. Quando não vem, quem respondeu foi o
    // proxy com uma página HTML inteira — despejar isso na tela (já aconteceu)
    // esconde o problema em vez de mostrar.
    let msg = "";
    try {
      const body = JSON.parse(text);
      msg = body.error || "";
      // `detail` é o motivo que o serviço externo deu (ex.: o que o Mercado Pago
      // respondeu). Sem ele a tela dizia só "MP recusou a criação do link" e
      // ninguém sabia o que consertar.
      if (msg && body.detail) msg += ` · ${String(body.detail).slice(0, 220)}`;
    } catch { /* HTML do proxy */ }
    const err = new Error(msg || proxyMessage(res.status));
    err.status = res.status;
    err.path = path;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

// POST multipart (vídeo/áudio/imagem) via XHR — não é preciosismo: fetch não
// expõe progresso de upload, e mandar 150 MB com o botão travado e nenhum sinal
// na tela é indistinguível de travado. `onProgress` recebe 0..1.
function upload(path, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}${path}`);
    const key = getKey();
    if (key) xhr.setRequestHeader("x-api-key", key);
    if (onProgress) {
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    }
    xhr.onload = () => {
      let body = null;
      try { body = JSON.parse(xhr.responseText); } catch { /* veio do proxy, não da API */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        if (body) return resolve(body);
        return reject(new Error("resposta inesperada do servidor (não veio JSON)"));
      }
      const err = new Error(body?.error || proxyMessage(xhr.status));
      err.status = xhr.status;
      reject(err);
    };
    xhr.onerror = () => reject(new Error("a conexão caiu durante o upload — tente de novo"));
    xhr.onabort = () => reject(new Error("upload cancelado"));
    xhr.send(formData);
  });
}

// Foto de perfil: o servidor guarda o caminho relativo (/public/users/:id?v=…);
// com VITE_API_BASE apontando pra outra origem, a <img> precisa do prefixo.
export function assetUrl(path) {
  if (!path) return "";
  return /^(https?:|data:|blob:)/.test(path) ? path : `${BASE}${path}`;
}

// URL do stream de mudanças (SSE). EventSource não manda headers — a key/token
// vai em ?key= (o servidor só aceita query key nessa rota).
export function eventsUrl() {
  return `${BASE}/api/events?key=${encodeURIComponent(getKey())}`;
}

export const api = {
  bootstrap: () => req("GET", "/api/bootstrap"),
  // Orgs do produto LeverAds pro select de vínculo do sync de acesso
  // (424 quando a credencial LEVERADS_* não está configurada na API).
  leveradsOrgs: () => req("GET", "/api/leverads-access/orgs"),
  // Auth do time: o token de sessão entra no MESMO slot da key (localStorage +
  // header x-api-key) — o resto do client não muda.
  login: (username, password) => req("POST", "/api/auth/login", { username, password }),
  logout: () => req("POST", "/api/auth/logout", {}),
  changePassword: (current, password) => req("POST", "/api/auth/password", { current, password }),
  // Meu perfil: nome e foto do PRÓPRIO usuário (o cargo continua sendo gestão,
  // em Ajustes → Equipe). Todas devolvem o usuário atualizado.
  updateMe: (name) => req("PATCH", "/api/auth/me", { name }),
  uploadMyPhoto: async (blob, name = "foto.jpg") => {
    const fd = new FormData();
    fd.append("file", blob, name);
    const key = getKey();
    const res = await fetch(`${BASE}/api/auth/me/photo`, {
      method: "POST",
      headers: key ? { "x-api-key": key } : {},
      body: fd,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let msg = "";
      try { msg = JSON.parse(text).error || ""; } catch { /* HTML do proxy */ }
      const err = new Error(msg || proxyMessage(res.status));
      err.status = res.status;
      throw err;
    }
    return res.json();
  },
  removeMyPhoto: () => req("DELETE", "/api/auth/me/photo"),
  // Usuários do time (lista sanitizada) — responsáveis do kanban de tarefas.
  listUsers: () => req("GET", "/api/auth/users"),
  list: (collection, query = {}) => {
    const qs = new URLSearchParams(query).toString();
    return req("GET", `/api/${collection}${qs ? `?${qs}` : ""}`);
  },
  get: (collection, id) => req("GET", `/api/${collection}/${id}`),
  // Análises do Elo App (produto B2C) + beacon das landing pages (elo.js).
  eloOverview: (days) => req("GET", `/api/elo/overview${days ? `?days=${days}` : ""}`),
  lpSummary: (saas, days) => req("GET", `/api/lp/summary?saas=${encodeURIComponent(saas || "elo")}${days ? `&days=${days}` : ""}`),
  create: (collection, obj) => req("POST", `/api/${collection}`, obj),
  update: (collection, id, patch) => req("PATCH", `/api/${collection}/${id}`, patch),
  remove: (collection, id) => req("DELETE", `/api/${collection}/${id}`),
  // Convenience used by the pipeline drag-and-drop to persist a stage move.
  // Leads ARE the pipeline cards now, so a move patches the lead's stage.
  moveLead: (id, stage) => req("PATCH", `/api/leads/${id}`, { stage }),
  // Cockpit → Levercopy: gera/re-gera a proposta de um lead. `auto` = gatilho
  // automático (best-effort, respeita idempotência); `force` = re-gerar manual.
  generateProposal: (id, { auto = false, force = false, template = "", unpin = false } = {}) => {
    const q = [auto && "auto=1", force && "force=1", unpin && "unpin=1", template && `template=${encodeURIComponent(template)}`].filter(Boolean).join("&");
    return req("POST", `/api/leads/${id}/proposal${q ? `?${q}` : ""}`);
  },
  // Ofertas do deck do lead (a principal + as secretas da escada) e o link
  // pronto pro cliente de UMA delas — o que vai no WhatsApp.
  proposalOffers: (id) => req("GET", `/api/leads/${id}/proposal-offers`),
  shareProposal: (id, offer) => req("POST", `/api/leads/${id}/proposal-share`, { offer }),
  // Proposta personalizada (objetiva): capa + combinado+valor. `preview:true`
  // devolve { html } sem salvar; senão faz upsert e devolve { id, url }.
  customProposal: (id, spec) => req("POST", `/api/leads/${id}/proposal/custom`, spec),
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
  // Regras de veiculação (agenda cheia pausa, janela de fim de semana, sexta
  // curta, orçamento alvo): config + estado + log, e o tick manual do runner.
  deliveryRules: (saas) => req("GET", `/api/marketing/${saas}/delivery-rules`),
  saveDeliveryRules: (saas, rules) => req("PUT", `/api/marketing/${saas}/delivery-rules`, { rules }),
  runDeliveryRules: (saas) => req("POST", `/api/marketing/${saas}/delivery-rules/tick`),
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
  waThreadSendTemplate: (id, { name, language, params, headerMediaId }) => req("POST", `/api/whatsapp/threads/${id}/send-template`, { name, language, params, headerMediaId }),
  // Foto PADRÃO do template (header de imagem): o composer preenche sozinho e
  // o servidor sobe ela a cada envio. Sem foto salva devolve null (não é erro).
  waTemplateDefaultMedia: async (name) => {
    const key = getKey();
    const res = await fetch(`${BASE}/api/whatsapp/template-media/${encodeURIComponent(name)}`, { headers: key ? { "x-api-key": key } : {} });
    if (!res.ok) return null;
    return res.blob();
  },
  waTemplateDefaultMediaSave: async (name, file) => {
    const fd = new FormData();
    fd.append("file", file, file.name || "foto.jpg");
    const key = getKey();
    const res = await fetch(`${BASE}/api/whatsapp/template-media/${encodeURIComponent(name)}`, {
      method: "PUT", headers: key ? { "x-api-key": key } : {}, body: fd,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let msg = text; try { msg = JSON.parse(text).error || text; } catch { /* texto cru */ }
      const err = new Error(String(msg).slice(0, 240) || `upload da foto -> ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  },
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
  // (waCallPermission saiu em 22/08/2026: o pedido de permissão de ligação foi
  // removido pra proteger o número — violação USER_INITIATED_CALLS_LOW_PICKUP_RATE.)
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
  pitchCalls: (saas, closer, group) => {
    const q = [group ? `group=${encodeURIComponent(group)}` : "", closer != null ? `closer=${encodeURIComponent(closer)}` : ""].filter(Boolean).join("&");
    return req("GET", `/api/pitch/${saas}/calls${q ? `?${q}` : ""}`);
  },
  // Análise de integração: sentimento, pendências recorrentes e integrações recentes.
  // integrator opcional (undefined = todos; "" = sem integrador) separa por integrador.
  integrationAnalysis: (saas, integrator) => req("GET", `/api/integrations/${saas}/summary${integrator != null ? `?integrator=${encodeURIComponent(integrator)}` : ""}`),
  // Upload de vídeo → { jobId }: a API responde assim que o arquivo chega e
  // toca a Meta em background (subir + processar + clonar leva minutos, e
  // requisição aberta esse tempo todo morre no proxy). O acompanhamento é o
  // adVideoJob abaixo.
  uploadCreative: (saas, formData, onProgress) => upload(`/api/marketing/${saas}/creatives`, formData, onProgress),
  // Criar anúncio clonando um conjunto e trocando o vídeo (mesmo padrão).
  adFromVideo: (saas, formData, onProgress) => upload(`/api/marketing/${saas}/ad-from-video`, formData, onProgress),
  adVideoJob: (jobId) => req("GET", `/api/marketing/job/${jobId}`),
  // Gasto com IA (OpenRouter/OpenAI/Anthropic), agregado em USD.
  aiCosts: (days) => req("GET", `/api/ai-costs${days ? `?days=${days}` : ""}`),
  // Custos operacionais do mês (ads + IA automáticos + lançamentos manuais).
  expensesSummary: (saas, month) => req("GET", `/api/expenses/summary/${saas}${month ? `?month=${month}` : ""}`),
  // Financeiro completo: a leitura do mês (contas a pagar + receber, fluxo, DRE, conciliação).
  fin: (saas, month) => req("GET", `/api/fin/${saas}${month ? `?month=${month}` : ""}`),
  // Importa as SAÍDAS da conta MP (settlement report) pra conciliação.
  finMpOutSync: (saas) => req("POST", `/api/fin/${saas}/mp-out/sync`, {}),
  // Mídia social: métricas do perfil, histórico e publicação orgânica (IG/FB).
  socialSummary: (saas, days) => req("GET", `/api/social/summary?saas=${encodeURIComponent(saas)}${days ? `&days=${days}` : ""}`),
  // Só a contagem líquida de novos seguidores (~24h) + o @ do perfil, pro aviso
  // de social selling do Meu dia (o IG não expõe a lista de quem seguiu).
  newFollowers: (saas) => req("GET", `/api/social/new-followers/${encodeURIComponent(saas)}`),
  socialAudience: (saas) => req("GET", `/api/social/audience?saas=${encodeURIComponent(saas)}`),
  socialStories: (saas) => req("GET", `/api/social/stories?saas=${encodeURIComponent(saas)}`),
  socialDiscovery: (saas) => req("GET", `/api/social/discovery?saas=${encodeURIComponent(saas)}`),
  // "Conectar" das telas Publicidade/Redes sociais: o que o token Meta alcança.
  metaAdAccounts: () => req("GET", "/api/marketing/meta/adaccounts"),
  socialPages: () => req("GET", "/api/social/pages"),
  socialDms: (saas, network) => req("GET", `/api/social/dms?saas=${encodeURIComponent(saas)}&network=${encodeURIComponent(network)}`),
  socialDmMessages: (saas, id) => req("GET", `/api/social/dms/messages?saas=${encodeURIComponent(saas)}&id=${encodeURIComponent(id)}`),
  socialDmSend: (saas, body) => req("POST", `/api/social/dms/send?saas=${encodeURIComponent(saas)}`, body),
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
  // SDR automatizado: status do robô + templates dele, submissão pra Meta e os
  // horários livres calculados no servidor (régua de roteamento por nível).
  sdrStatus: (saas) => req("GET", `/api/sdr/status?saas=${encodeURIComponent(saas)}`),
  sdrTemplateSetup: () => req("POST", "/api/whatsapp/templates/sdr-setup", {}),
  sdrReplayStart: (saas, opts = {}) => req("POST", "/api/sdr/replay", { saas, ...opts }),
  sdrReplayStatus: () => req("GET", "/api/sdr/replay"),
  freeSlots: (saas, { lead, grade, days, limit } = {}) => {
    const q = new URLSearchParams({ saas });
    if (lead) q.set("lead", lead);
    if (grade) q.set("grade", grade);
    if (days) q.set("days", String(days));
    if (limit) q.set("limit", String(limit));
    return req("GET", `/api/agenda/free-slots?${q.toString()}`);
  },
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
  // 4fun: estudo livre além da cota do dia (não mexe no FSRS, só no log próprio)
  trainingFun: (saas, n = 20) => req("GET", `/api/flashcards/${encodeURIComponent(saas)}/fun?n=${n}`),
  trainingFunReview: (saas, cardId, rating, ms) => req("POST", `/api/flashcards/${encodeURIComponent(saas)}/fun/review`, { cardId, rating, ms }),
  trainingStats: (saas) => req("GET", `/api/flashcards/${encodeURIComponent(saas)}/stats`),
  // Raio-x de uma prova respondida (questões, resposta dada, gabarito, feedback)
  trainingExamDetail: (saas, id) => req("GET", `/api/flashcards/${encodeURIComponent(saas)}/exam/${encodeURIComponent(id)}`),
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
  // Copiloto da call: transcrição ao vivo + cues (áudio nunca fica salvo)
  copilotStart: (leadId, checklist) => req("POST", `/api/leads/${encodeURIComponent(leadId)}/copilot/start`, { checklist }),
  copilotStatus: (leadId) => req("GET", `/api/leads/${encodeURIComponent(leadId)}/copilot`),
  copilotStop: (leadId) => req("POST", `/api/leads/${encodeURIComponent(leadId)}/copilot/stop`, {}),
  copilotFrame: async (leadId, blob) => {
    const fd = new FormData();
    fd.append("file", blob, "frame.jpg");
    const key = getKey();
    const res = await fetch(`${BASE}/api/leads/${encodeURIComponent(leadId)}/copilot/frame`, { method: "POST", body: fd, headers: key ? { "x-api-key": key } : {} });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `frame falhou (${res.status})`);
    return body;
  },
  copilotChunk: async (leadId, blob) => {
    const fd = new FormData();
    fd.append("file", blob, "chunk.webm");
    const key = getKey();
    const res = await fetch(`${BASE}/api/leads/${encodeURIComponent(leadId)}/copilot/chunk`, { method: "POST", body: fd, headers: key ? { "x-api-key": key } : {} });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `chunk falhou (${res.status})`);
    return body;
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
  // Dinheiro real recebido por cliente ({ customerId: total }) — Status pgto.
  billingReceived: (saas) => req("GET", `/api/billing/received/${encodeURIComponent(saas)}`),
  unpayInvoice: (id) => req("POST", `/api/invoices/${id}/unpay`),
  runBilling: () => req("POST", "/api/billing/run", {}),
  // Mercado Pago: gera o link de autorização da assinatura (preapproval).
  mpLink: (subId, payerEmail) => req("POST", `/api/subscriptions/${subId}/mp/link`, payerEmail ? { payerEmail } : {}),
  // Financeiro MP: espelho de pagamentos da conta + cobrança avulsa no cliente.
  mpPayments: (query = {}) => {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(query).filter(([, v]) => v))).toString();
    return req("GET", `/api/mp/payments${qs ? `?${qs}` : ""}`);
  },
  mpSyncNow: () => req("POST", "/api/mp/sync", {}),
  mpLinkPayment: (id, customer) => req("POST", `/api/mp/payments/${id}/link`, { customer }),
  // Assinaturas recorrentes da conta MP (preapprovals) ↔ clientes do cockpit.
  mpPreapprovals: (query = {}) => {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(query).filter(([, v]) => v))).toString();
    return req("GET", `/api/mp/preapprovals${qs ? `?${qs}` : ""}`);
  },
  mpSyncPreapprovals: () => req("POST", "/api/mp/preapprovals/sync", {}),
  mpLinkPreapproval: (id, body = {}) => req("POST", `/api/mp/preapprovals/${id}/link`, body),
  createCharge: (customerId, body) => req("POST", `/api/customers/${customerId}/charge`, body),
  // Link de pagamento pelo card do lead (external_reference = lead: pagamento
  // entra no Financeiro já casado com a origem).
  mpLeadLink: (leadId, body) => req("POST", `/api/leads/${leadId}/mp/link`, body),
  // Histórico dos links gerados (tela Links de pagamento): o recibo de cada
  // geração já cruzado com o espelho do MP — quem pagou, quanto e como.
  paymentLinks: (saas) => req("GET", `/api/payment-links${saas ? `?saas=${encodeURIComponent(saas)}` : ""}`),
  invoiceMpLink: (id, body = {}) => req("POST", `/api/invoices/${id}/mp/link`, body),
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
  // Widget de feedback (FAB em toda tela): rotas próprias, abertas a qualquer
  // sessão — /api/tasks é guardado pela tela "tasks" e o widget não pode
  // depender dela. O POST cria o card no quadro; o GET traz o recorte do painel
  // (últimos reportes + colunas); o asset é o mesmo das tarefas por outra porta.
  feedbackList: () => req("GET", "/api/feedback"),
  feedbackSend: (body) => req("POST", "/api/feedback", body),
  feedbackAsset: (blob, name = "print.png") => {
    const fd = new FormData();
    fd.append("file", blob, name);
    return upload("/api/feedback/asset", fd);
  },
  // Foto anexada a uma TAREFA → asset servido em /public/tasks/:id; a URL vai
  // no campo task.photo. Mesmo desenho do activityAsset abaixo.
  taskAsset: async (blob, name = "anexo.png") => {
    const fd = new FormData();
    fd.append("file", blob, name);
    const key = getKey();
    const res = await fetch(`${BASE}/api/tasks/asset`, {
      method: "POST", headers: key ? { "x-api-key": key } : {}, body: fd,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let msg = "";
      try { msg = JSON.parse(text).error || ""; } catch { /* HTML do proxy */ }
      throw new Error(msg || `upload falhou (${res.status})`);
    }
    return res.json();
  },
  // Foto anexada ao toque (print da conversa) → asset servido em
  // /public/activities/:id; a URL vai em activity.meta.photo.
  activityAsset: async (blob, name = "anexo.png") => {
    const fd = new FormData();
    fd.append("file", blob, name);
    const key = getKey();
    const res = await fetch(`${BASE}/api/activities/asset`, {
      method: "POST", headers: key ? { "x-api-key": key } : {}, body: fd,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let msg = "";
      try { msg = JSON.parse(text).error || ""; } catch { /* HTML do proxy */ }
      const err = new Error(msg || proxyMessage(res.status));
      err.status = res.status;
      throw err;
    }
    return res.json();
  },
  // Métricas reais de funil (conversão/tempo por etapa, perdas, SLA de 1º toque).
  funnelAnalytics: (saas, { since, until } = {}) => {
    const q = new URLSearchParams();
    if (since) q.set("since", since);
    if (until) q.set("until", until);
    return req("GET", `/api/funnel/${saas}${q.toString() ? `?${q}` : ""}`);
  },
  // Pace mensal de caixa: faturas pagas → meta diária por papel do funil.
  pipelinePace: (saas) => req("GET", `/api/pipeline-pace/${encodeURIComponent(saas)}`),
  // Meta de uma JANELA qualquer (mês passado, semana, dia) — a faixa da Visão
  // geral seguindo o filtro do topo; meta repartida pelos dias úteis.
  paceWindow: (saas, { since, until }) =>
    req("GET", `/api/pipeline-pace/${encodeURIComponent(saas)}/window?since=${since}&until=${until}`),
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
  // Desfaz um fechamento errado: remove cliente/assinatura/faturas automáticas
  // e devolve o card pro funil (409 se houver dinheiro real do Mercado Pago).
  customerRevertWin: (id) => req("POST", `/api/customers/${id}/revert-win`),
  // Churn: registra a SAÍDA do cliente (endedAt + motivo; cancela as
  // assinaturas em aberto, espelhando no MP) e o desfazer da marcação.
  customerChurn: (id, body = {}) => req("POST", `/api/customers/${id}/churn`, body),
  customerUnchurn: (id) => req("POST", `/api/customers/${id}/unchurn`),
  createUser: ({ name, password, roles }) => req("POST", "/api/auth/users", { name, password, ...(roles ? { roles } : {}) }),
  // Remove um usuário do time. force=true remove mesmo com leads atribuídos (409 sem force).
  removeUser: (id, force = false) => req("DELETE", `/api/auth/users/${id}${force ? "?force=1" : ""}`),
};
