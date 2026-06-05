// Integração Cockpit → Levercopy: gera a proposta dinâmica de um lead chamando
// `POST {LEVERCOPY_API_URL}/api/proposta/generate` (protegido por X-Cockpit-Key).
//
// Vale só para leads do SaaS do Levercopy (LEVERCOPY_SAAS_ID, default "leverads").
// Fail-open igual ao resto do projeto: sem chave configurada, a integração fica
// desligada graciosamente (skip, nunca 500). A chamada HTTP é injetável (cfg.fetch)
// para os testes não tocarem a rede.
//
// Gotcha do round-trip: o /api/proposta/generate do Levercopy ESPELHA o lead de
// volta no Cockpit (POST /api/leads). Mandamos `cockpit_lead_id` no body para que o
// Levercopy possa pular esse espelho quando passar a suportá-lo; enquanto isso, o
// `cockpit_lead_id` que ele devolve identifica o lead duplicado, que removemos aqui.

// Resolve config na hora da chamada (não no import) para os testes poderem variar
// o ambiente; `over` permite injetar fetch/url/key/saasId nos testes.
function resolveCfg(over = {}) {
  return {
    url: String(over.url ?? process.env.LEVERCOPY_API_URL ?? "").replace(/\/+$/, ""),
    key: over.key ?? process.env.LEVERCOPY_INGEST_KEY ?? "",
    saasId: over.saasId ?? process.env.LEVERCOPY_SAAS_ID ?? "leverads",
    fetch: over.fetch ?? globalThis.fetch,
    timeoutMs: over.timeoutMs ?? 8000,
  };
}

export const isConfigured = (cfg = resolveCfg()) => Boolean(cfg.url && cfg.key);

// O que a UI precisa pra decidir se mostra o botão "Gerar proposta".
export function integrationStatus() {
  const cfg = resolveCfg();
  return { saas: cfg.saasId, enabled: isConfigured(cfg) };
}

// Mapeia um lead do Cockpit → body do /api/proposta/generate. Só `name` é
// obrigatório no Levercopy; campos ausentes caem nos defaults dele. Os campos de
// qualificação (thesis/accounts/volume/…) não existem no lead do Cockpit hoje, então
// não são enviados (a proposta usa defaults). `cockpit_lead_id` dá rastreabilidade
// e habilita o pulo do espelho no lado do Levercopy.
export function buildBody(lead, leadQuestions = []) {
  const body = {
    name: lead.name,
    cockpit_lead_id: lead.id,
    source: "Manual · Cockpit", // origem da GERAÇÃO; o vínculo com o lead vai no cockpit_lead_id
  };
  if (lead.company) body.company = lead.company;
  if (lead.email) body.email = lead.email;
  if (lead.phone) body.whatsapp = lead.phone; // `phone` no Cockpit == `whatsapp` no Levercopy
  // Respostas de qualificação declaradas pelo pipeline (product.leadQuestions). As
  // chaves já são os nomes que o Levercopy espera (accounts/staff/volume/niche/…) e
  // arrays (marketplaces) passam direto. Campos ausentes/vazios não vão (o Levercopy
  // aplica defaults). Só chaves declaradas viajam — extras do lead ficam de fora.
  for (const q of leadQuestions) {
    const v = lead[q.key];
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    body[q.key] = v;
  }
  return body;
}

// Chama o endpoint. Lança Error (com .status) em 401/422/503; deixa erro de rede
// propagar. Timeout curto (8s) via AbortController.
export async function generateProposal(lead, cfg = {}, leadQuestions = []) {
  const fetchImpl = cfg.fetch || globalThis.fetch;
  const timeoutMs = cfg.timeoutMs || 8000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(`${cfg.url}/api/proposta/generate`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cockpit-key": cfg.key },
      body: JSON.stringify(buildBody(lead, leadQuestions)),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { detail: text }; }
  if (!res.ok) {
    const err = new Error(data.detail || `Levercopy respondeu ${res.status}`);
    err.status = res.status;
    throw err;
  }
  // Um 2xx sem proposta utilizável (corpo vazio/HTML/parcial de proxy mal
  // configurado) é falha de geração, não sucesso silencioso.
  if (!data.id || !data.proposalUrl) {
    const err = new Error("Levercopy respondeu sem proposta (id/proposalUrl ausentes)");
    err.status = res.status;
    throw err;
  }
  return data;
}

// Orquestra elegibilidade → geração → persistência → dedupe. Best-effort: nunca
// lança; devolve { ok, skipped?, lead?, deduped?, error?, status? } pro chamador
// decidir o HTTP. `auto` = gatilho automático (respeita idempotência); `force` =
// re-gerar manual (sobrescreve as URLs salvas).
export async function runProposal(repo, lead, opts = {}) {
  const cfg = resolveCfg(opts);
  const { auto = false, force = false } = opts;

  if (lead.saas !== cfg.saasId) return { ok: false, skipped: "not_levercopy" };
  if (!isConfigured(cfg)) return { ok: false, skipped: "not_configured" };
  if (auto && !force && lead.proposta_id) return { ok: false, skipped: "already_generated", lead };

  // As perguntas do pipeline (product.leadQuestions) dizem QUAIS respostas do lead
  // encaminhar ao Levercopy. Busca só depois dos skips (evita I/O quando não vai gerar).
  const product = await repo.get("products", lead.saas);
  const leadQuestions = product?.leadQuestions || [];

  let data;
  try {
    data = await generateProposal(lead, cfg, leadQuestions);
  } catch (e) {
    return { ok: false, error: e.message, status: e.status || 0 };
  }

  const updated = await repo.update("leads", lead.id, {
    proposta_id: data.id,
    proposalUrl: data.proposalUrl,
    proposal_edit_url: data.edit_url,
  });

  // Dedupe do round-trip: se o Levercopy criou um lead espelhado (id diferente do
  // nosso), removemos o duplicado. Quando vier o nosso próprio id (espelho pulado),
  // não mexe — nunca apaga o lead original.
  let deduped = null;
  const mirrorId = data.cockpit_lead_id;
  if (mirrorId && mirrorId !== lead.id) {
    try { if (await repo.remove("leads", mirrorId)) deduped = mirrorId; } catch { /* best-effort */ }
  }

  return { ok: true, lead: updated, deduped };
}
