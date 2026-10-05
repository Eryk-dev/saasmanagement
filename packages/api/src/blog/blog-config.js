// Configuração da redação do blog: doc `app_config` id `blog_<saas>` com o
// mesmo layout do ad-delivery.js ({ rules, state, log }). `rules` é o que o
// Leo edita na tela; `state` são os contadores do motor (blog-engine.js);
// `log` é a memória curta do que o motor fez.

const LOG_MAX = 100;
const WEEKDAYS = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"];

export const BLOG_DEFAULT_RULES = {
  enabled: true,
  autoPauta: true,
  autoRascunho: true,
  autoPublicar: false,
  cadenciaSemanal: 2,
  diasPublicacao: ["ter", "qui"],
  horaPublicacao: "09:00", // hora de Brasília (UTC-3 fixo)
  minPautas: 5,
  minRascunhos: 2,
  pautasPorRodada: 6,
  maxRascunhosDia: 2,
  maxRodadasPautaDia: 1,
  bufferAgendados: 4,
  categorias: [
    "Operação multi-contas", "Mercado Livre", "Shopee", "Autopeças",
    "Anúncios e ficha técnica", "Estoque e SKUs", "Conta suspensa", "Crescimento e equipe",
  ],
  ctaUrl: "https://levermoney.com.br/f/fo_diagnostico_leverads",
};

export const BLOG_DEFAULT_STATE = {
  lastTickAt: "", lastMineAt: "", lastDraftAt: "", lastPublishAt: "", lastError: "",
  day: "", pautaRounds: 0, rascunhos: 0,
};

export const blogCfgId = (saas) => `blog_${saas}`;

const INT_RANGES = {
  cadenciaSemanal: [1, 7],
  minPautas: [0, 20],
  minRascunhos: [0, 10],
  pautasPorRodada: [1, 12],
  maxRascunhosDia: [0, 10],
  maxRodadasPautaDia: [0, 5],
  bufferAgendados: [1, 12],
};
const BOOLS = ["enabled", "autoPauta", "autoRascunho", "autoPublicar"];

// Regras digitadas viram valores sãos: dedo errado na tela não vira 50 posts
// por dia nem dia da semana inexistente. Chave desconhecida é descartada.
export function mergeBlogRules(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const out = { ...BLOG_DEFAULT_RULES, diasPublicacao: [...BLOG_DEFAULT_RULES.diasPublicacao], categorias: [...BLOG_DEFAULT_RULES.categorias] };
  for (const k of BOOLS) if (r[k] !== undefined) out[k] = !!r[k];
  for (const [k, [lo, hi]] of Object.entries(INT_RANGES)) {
    if (r[k] === undefined) continue;
    const n = Math.round(Number(r[k]));
    out[k] = Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : BLOG_DEFAULT_RULES[k];
  }
  if (Array.isArray(r.diasPublicacao)) {
    const days = WEEKDAYS.filter((d) => r.diasPublicacao.map((x) => String(x || "").toLowerCase().slice(0, 3)).includes(d));
    if (days.length) out.diasPublicacao = days;
  }
  if (typeof r.horaPublicacao === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.horaPublicacao)) out.horaPublicacao = r.horaPublicacao;
  if (Array.isArray(r.categorias)) {
    const cats = [...new Set(r.categorias.map((c) => String(c || "").trim().slice(0, 40)).filter(Boolean))];
    if (cats.length) out.categorias = cats;
  }
  if (typeof r.ctaUrl === "string" && /^https:\/\/\S+$/.test(r.ctaUrl.trim())) out.ctaUrl = r.ctaUrl.trim();
  return out;
}

export async function loadBlogCfg(repo, saas) {
  const rec = await repo.get("app_config", blogCfgId(saas)).catch(() => null);
  return {
    id: blogCfgId(saas),
    saas,
    rules: mergeBlogRules(rec?.rules),
    state: { ...BLOG_DEFAULT_STATE, ...(rec?.state || {}) },
    log: Array.isArray(rec?.log) ? rec.log : [],
    _exists: !!rec,
  };
}

// `silent: true` no heartbeat do tick (só state), pra não acordar o SSE do
// cockpit inteiro a cada 15 minutos.
export async function saveBlogCfg(repo, saas, cfg, { silent = false } = {}) {
  const payload = { saas, rules: cfg.rules, state: cfg.state, log: (cfg.log || []).slice(0, LOG_MAX) };
  if (cfg._exists) await repo.update("app_config", blogCfgId(saas), payload, { silent });
  else await repo.create("app_config", { id: blogCfgId(saas), ...payload });
  cfg._exists = true;
  return cfg;
}

export function logLine(cfg, action, detail = "") {
  cfg.log = [{ at: new Date().toISOString(), action, detail: String(detail || "").slice(0, 300) }, ...(cfg.log || [])].slice(0, LOG_MAX);
  return cfg.log[0];
}
