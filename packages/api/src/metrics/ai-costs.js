// Gasto com IA (OpenRouter, OpenAI, Anthropic) — leitura das APIs de custo de
// cada provedor, moeda USD. Mesmo padrão do meta.js: single tenant, credenciais
// via env, factory com fetch injetável pra testar offline.
//
//   OpenRouter — a API key normal lê /credits (uso acumulado + saldo). A série
//     diária (/activity) exige uma management key; sem ela, mostramos só o total.
//   OpenAI    — /v1/organization/costs exige ADMIN key (scope api.usage.read).
//     Env: OPENAI_ADMIN_KEY (fallback OPENAI_API_KEY, caso a key já seja admin).
//   Anthropic — /v1/organizations/cost_report exige ADMIN key (sk-ant-admin…).
//     Env: ANTHROPIC_ADMIN_KEY (fallback ANTHROPIC_API_KEY).
//
// Cada provedor responde independente: { ok, spend?, series?, error? } — um
// provedor sem chave/permissão não derruba os outros.

const DAY_MS = 86_400_000;

export function makeAiCosts({
  fetch: f = globalThis.fetch,
  openrouterKey = "",
  openaiKey = "",
  anthropicKey = "",
} = {}) {
  const configured = () => !!(openrouterKey || openaiKey || anthropicKey);

  async function getJson(url, headers) {
    const res = await f(url, { headers });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = {}; }
    if (res.status >= 400 || body.error) {
      const raw = body.error;
      const msg = (typeof raw === "string" ? raw : raw?.message) || text.slice(0, 200);
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  // OpenRouter: uso acumulado + saldo via /credits; série diária via /activity
  // quando a key permitir (management key) — 403 vira fallback silencioso.
  async function openrouter(days) {
    if (!openrouterKey) return { ok: false, error: "sem chave (OPENROUTER_API_KEY)" };
    const headers = { authorization: `Bearer ${openrouterKey}` };
    try {
      const cred = await getJson("https://openrouter.ai/api/v1/credits", headers);
      const out = {
        ok: true,
        lifetimeSpend: Number(cred.data?.total_usage) || 0,
        credits: Number(cred.data?.total_credits) || 0,
      };
      out.remaining = Math.max(0, out.credits - out.lifetimeSpend);
      try {
        const act = await getJson("https://openrouter.ai/api/v1/activity", headers);
        const cutoff = new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);
        const byDay = {};
        for (const r of act.data || []) {
          const d = String(r.date || "").slice(0, 10);
          if (d >= cutoff) byDay[d] = (byDay[d] || 0) + (Number(r.usage) || 0);
        }
        out.series = Object.entries(byDay).sort().map(([date, spend]) => ({ date, spend }));
        out.spend = out.series.reduce((a, s) => a + s.spend, 0);
      } catch { /* key comum não lê activity — segue só com o acumulado */ }
      return out;
    } catch (err) {
      return { ok: false, error: String(err.message || err).slice(0, 200) };
    }
  }

  // OpenAI: custos diários da organização (admin key).
  async function openai(days) {
    if (!openaiKey) return { ok: false, error: "sem chave (OPENAI_ADMIN_KEY)" };
    const headers = { authorization: `Bearer ${openaiKey}` };
    try {
      const start = Math.floor((Date.now() - days * DAY_MS) / 1000);
      let url = `https://api.openai.com/v1/organization/costs?start_time=${start}&limit=${Math.min(days, 180)}`;
      const series = [];
      let guard = 0;
      while (url && guard++ < 10) {
        const body = await getJson(url, headers);
        for (const bucket of body.data || []) {
          const spend = (bucket.results || []).reduce((a, r) => a + (Number(r.amount?.value) || 0), 0);
          series.push({ date: new Date((bucket.start_time || 0) * 1000).toISOString().slice(0, 10), spend });
        }
        url = body.has_more && body.next_page
          ? `https://api.openai.com/v1/organization/costs?start_time=${start}&limit=${Math.min(days, 180)}&page=${body.next_page}`
          : null;
      }
      return { ok: true, spend: series.reduce((a, s) => a + s.spend, 0), series };
    } catch (err) {
      const hint = err.status === 401 || err.status === 403 || /permission|scope/i.test(String(err.message))
        ? "precisa de ADMIN key com escopo de usage (platform.openai.com → Admin keys)" : null;
      return { ok: false, error: hint || String(err.message || err).slice(0, 200) };
    }
  }

  // Anthropic: cost report diário da organização (admin key sk-ant-admin…).
  async function anthropic(days) {
    if (!anthropicKey) return { ok: false, error: "sem chave (ANTHROPIC_ADMIN_KEY)" };
    const headers = { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" };
    try {
      const startISO = new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10) + "T00:00:00Z";
      let url = `https://api.anthropic.com/v1/organizations/cost_report?starting_at=${encodeURIComponent(startISO)}&limit=31`;
      const series = [];
      let guard = 0;
      while (url && guard++ < 10) {
        const body = await getJson(url, headers);
        for (const bucket of body.data || []) {
          const spend = (bucket.results || []).reduce((a, r) => a + (Number(r.amount) || 0), 0);
          series.push({ date: String(bucket.starting_at || "").slice(0, 10), spend });
        }
        url = body.has_more && body.next_page
          ? `https://api.anthropic.com/v1/organizations/cost_report?starting_at=${encodeURIComponent(startISO)}&limit=31&page=${encodeURIComponent(body.next_page)}`
          : null;
      }
      return { ok: true, spend: series.reduce((a, s) => a + s.spend, 0), series };
    } catch (err) {
      const hint = err.status === 401 || err.status === 403
        ? "precisa de ADMIN key (console.anthropic.com → Settings → Admin keys)" : null;
      return { ok: false, error: hint || String(err.message || err).slice(0, 200) };
    }
  }

  // Câmbio USD→BRL (dólar comercial, AwesomeAPI, sem chave) com cache de 1h.
  // Fail-open: sem cotação, o front mostra em dólar.
  let fx = { rate: null, at: 0 };
  async function usdBrl() {
    if (fx.rate && Date.now() - fx.at < 3600_000) return fx.rate;
    try {
      const body = await getJson("https://economia.awesomeapi.com.br/json/last/USD-BRL", {});
      const rate = Number(body?.USDBRL?.bid);
      if (Number.isFinite(rate) && rate > 0) fx = { rate, at: Date.now() };
    } catch { /* mantém o cache anterior (ou null) */ }
    return fx.rate;
  }

  return {
    configured,
    // Snapshot dos provedores COM CHAVE configurada (sem chave = fora do card,
    // não vira linha de aviso). Nunca lança: cada provedor carrega seu ok/error.
    async report(days = 30) {
      const jobs = [];
      if (openrouterKey) jobs.push(openrouter(days).then((r) => ({ provider: "openrouter", label: "OpenRouter", ...r })));
      if (openaiKey) jobs.push(openai(days).then((r) => ({ provider: "openai", label: "OpenAI", ...r })));
      if (anthropicKey) jobs.push(anthropic(days).then((r) => ({ provider: "anthropic", label: "Anthropic", ...r })));
      const [providers, rate] = await Promise.all([Promise.all(jobs), usdBrl()]);
      // Total do período soma só quem tem série; acumulado (OpenRouter sem
      // management key) entra em lifetimeSpend, não aqui.
      const totalPeriod = providers.reduce((a, p) => a + (p.ok && p.spend != null ? p.spend : 0), 0);
      return { days, currency: "USD", usdBrl: rate, totalPeriod: Math.round(totalPeriod * 100) / 100, providers };
    },
  };
}

// Só as chaves dedicadas contam: a de uso (sk-proj/sk-ant-api) não tem acesso a
// custo e só geraria linha de erro no card.
//
// Singleton PREGUIÇOSO: imports de ESM são içados, então este módulo é avaliado
// antes do dotenv.config() do index.js — ler process.env aqui em cima congelaria
// as chaves vazias no dev local. A primeira chamada real (pós-boot) resolve.
let _inst = null;
const inst = () => (_inst ??= makeAiCosts({
  openrouterKey: process.env.OPENROUTER_API_KEY || "",
  openaiKey: process.env.OPENAI_ADMIN_KEY || "",
  anthropicKey: process.env.ANTHROPIC_ADMIN_KEY || "",
}));
export const aiCosts = {
  configured: () => inst().configured(),
  report: (days) => inst().report(days),
};
