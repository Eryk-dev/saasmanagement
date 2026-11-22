// Funis da DM do Instagram (teste A/B/C por pessoa): lp | form | app.
// Une o tráfego do beacon (summary.funnels / summary.palavras — sessões na
// página de ENTRADA do funil) com o dinheiro do banco do Elo
// (conversions.by_funnel / by_palavra). Sem a migration aplicada no Elo os
// campos de dinheiro chegam ausentes e viram null (a tela mostra "—").

export const FUNNEL_IDS = ["lp", "form", "app"];
export const FUNNEL_LABELS = { lp: "Landing page", form: "Quiz", app: "Direto pra loja" };
export const LEADER_MIN_SESSIONS = 30;

const n = (v) => Number(v) || 0;

function moneyRow(src) {
  return src
    ? { created: n(src.created), approved: n(src.approved), activated: n(src.activated), revenue: n(src.revenue_cents) }
    : { created: null, approved: null, activated: null, revenue: null };
}

export function buildFunnelRows(summary) {
  const traffic = new Map((summary?.funnels || []).map((f) => [f.funnel, f]));
  const byFunnel = summary?.conversions?.by_funnel; // undefined = migration ausente
  const money = new Map((byFunnel || []).map((f) => [f.funnel, f]));
  return FUNNEL_IDS.map((id) => {
    const t = traffic.get(id) || {};
    const m = byFunnel ? moneyRow(money.get(id) || {}) : moneyRow(null);
    const sessions = n(t.sessions);
    return {
      id,
      label: FUNNEL_LABELS[id],
      sessions,
      ctaSessions: n(t.ctaSessions),
      checkoutSessions: n(t.checkoutSessions),
      ...m,
      // app não gera pedido web (conversão é instalação/IAP nas lojas)
      conversion: id === "app" || m.approved == null || !sessions ? null : m.approved / sessions,
    };
  });
}

export function buildPalavraRows(summary) {
  const rows = new Map();
  const row = (palavra) => {
    if (!rows.has(palavra)) rows.set(palavra, { palavra, sessions: 0, ctaSessions: 0, byFunnel: {}, ...moneyRow(null) });
    return rows.get(palavra);
  };
  for (const p of summary?.palavras || []) {
    if (!p?.palavra) continue;
    const r = row(p.palavra);
    r.sessions = n(p.sessions);
    r.ctaSessions = n(p.ctaSessions);
    for (const [f, b] of Object.entries(p.byFunnel || {})) r.byFunnel[f] = { ...(r.byFunnel[f] || {}), sessions: n(b.sessions) };
  }
  const byPalavra = summary?.conversions?.by_palavra;
  if (byPalavra) {
    for (const r of rows.values()) Object.assign(r, moneyRow({}));
    for (const p of byPalavra) {
      if (!p?.palavra) continue;
      const r = row(p.palavra);
      Object.assign(r, moneyRow(p));
      for (const [f, b] of Object.entries(p.by_funnel || {})) r.byFunnel[f] = { ...(r.byFunnel[f] || {}), approved: n(b.approved) };
    }
  }
  return [...rows.values()].sort((a, b) => n(b.revenue) - n(a.revenue) || b.sessions - a.sessions || (a.palavra < b.palavra ? -1 : 1));
}

// Líder: pagos/sessão; sem nenhum pago, CTA/sessão. Só concorre quem tem
// amostra mínima. O funil "app" fica fora: o CTA dele é o redirect automático
// pra loja (≈100%) e a conversão real acontece nas lojas, não no checkout.
export function pickLeader(rows, { min = LEADER_MIN_SESSIONS, exclude = ["app"] } = {}) {
  const eligible = rows.filter((r) => !exclude.includes(r.id) && r.sessions >= min);
  if (!eligible.length) return null;
  const byPaid = eligible.some((r) => n(r.approved) > 0);
  const rate = (r) => (byPaid ? n(r.approved) : r.ctaSessions) / r.sessions;
  const best = eligible.reduce((a, b) => (rate(b) > rate(a) ? b : a));
  if (!(rate(best) > 0)) return null;
  return { id: best.id, metric: byPaid ? "pagos/sessão" : "CTA/sessão", rate: rate(best) };
}
