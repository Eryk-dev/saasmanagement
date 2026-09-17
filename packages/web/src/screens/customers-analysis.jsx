import React from "react";
import { Card } from "../components/viz.jsx";
import { GRADE_STYLE } from "../lib/ui.js";
import { usePeriod } from "../components/period-picker.jsx";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { useActiveSaas } from "../lib/workspace.js";
import { InfoNota } from "../components/story.jsx";

// Análise da base de clientes — números do período sobre a coleção customers:
// contratado anualizado, clientes novos, ticket médio,
// preço mensal médio, churn e LTV. O período filtra por startedAt (entradas) e
// endedAt (churn). O caixa confirmado é consultado na API pela data de
// recebimento e inclui clientes que entraram antes da janela.

const { useState, useEffect, useMemo } = React;
const DAY = 86_400_000;

// customer.arr guarda o valor ANUAL (mensal ×12, semestral ×2 no convertWonLead).

// O caixa vem da API por data de recebimento, incluindo clientes antigos.
// A chave impede que valores da janela/produto anterior apareçam na troca;
// o cancelamento ignora respostas antigas que terminam depois da nova.
function useCustomerCash(saas, win, version) {
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState(null);
  const key = JSON.stringify([saas, win.since, win.until, version, retry]);
  useEffect(() => {
    if (!saas) return;
    let alive = true;
    api.billingCash(saas, { since: win.since, until: win.until })
      .then((cash) => {
        if (!cash || !Number.isFinite(cash.received) || !Number.isFinite(cash.receivable)) throw new Error("resposta inválida");
        if (alive) setState({ key, cash });
      })
      .catch(() => { if (alive) setState({ key, error: true }); });
    return () => { alive = false; };
  }, [saas, win.since, win.until, key]);
  const current = state?.key === key ? state : null;
  return { cash: current?.cash, error: current?.error, loading: !current, onRetry: () => setRetry((n) => n + 1) };
}

export function CustomerCashValues({ cash, loading = false, error = false, onRetry }) {
  const value = (n) => cash ? window.fmt.money(n) : "—";
  return (
    <div aria-busy={loading} style={{ minWidth: 0 }}>
      <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
        <div>
          <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 22, fontWeight: 700, color: "var(--pos)" }}>{value(cash?.received)}</div>
          <div style={{ fontSize: 12, color: "var(--fg-3)" }}>recebido no período</div>
          <div style={{ fontSize: 11, color: "var(--fg-4)", marginTop: 3 }}>pagamentos confirmados · toda a base</div>
        </div>
        <div>
          <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 22, fontWeight: 700, color: "var(--warn)" }}>{value(cash?.receivable)}</div>
          <div style={{ fontSize: 12, color: "var(--fg-3)" }}>a receber no período</div>
          <div style={{ fontSize: 11, color: "var(--fg-4)", marginTop: 3 }}>cobranças em aberto com vencimento no período</div>
        </div>
      </div>
      {loading && <div role="status" style={{ fontSize: 11.5, color: "var(--fg-3)", marginTop: 8 }}>carregando recebimentos…</div>}
      {error && <div role="alert" style={{ fontSize: 12, color: "var(--neg)", marginTop: 8 }}>
        Não foi possível carregar os recebimentos. <button onClick={onRetry} style={{ color: "var(--accent)", textDecoration: "underline" }}>Tentar novamente</button>
      </div>}
    </div>
  );
}

// Ciclo da assinatura → rótulo (mesma régua da lista/card do cliente).
const CYCLE_LABEL = { monthly: "mensal", quarterly: "trimestral", semiannual: "semestral", annual: "anual" };

function planBucket(plan) {
  const t = String(plan || "").toLowerCase();
  // Mentoria: o pacote comprado É a categoria (4 e 8 consultas contam separado).
  const pack = t.match(/(\d+)\s*consulta/);
  if (pack) return `Mentoria · ${pack[1]} consultas`;
  if (t.includes("único") || t.includes("unico")) return "Serviço único";
  if (t.includes("semestral")) return "Semestral";
  if (t.includes("trimestral")) return "Trimestral";
  if (t.includes("mensal")) return "Mensal";
  if (t.includes("anual")) return "Anual";
  return "sem plano";
}
const PLAN_ORDER = ["Anual", "Semestral", "Trimestral", "Serviço único", "Mensal", "sem plano"];

// `isKids` = workspace de mentoria (compra única, sem recorrência): as métricas
// de assinatura (preço mensal médio e LTV, que derivam de MRR ÷ churn) não
// significam nada ali e saem — o resto (contratado, caixa, cobranças abertas, ticket, churn
// de famílias) vale igual.
// `gradeDist`/`nivelLegend` vêm da tela (o nível sai do lead, que só ela tem na
// mão): a saúde da carteira junta churn, LTV e distribuição de nível num bloco,
// em vez dos três cards que ocupavam duas dobras. Props opcionais — sem elas o
// componente segue renderizando o dinheiro e o churn.
export function CustomersAnalysis({ customers, subs = [], invoices = [], isKids = false, gradeDist = null, nivelLegend = null }) {
  const money = window.fmt.money;
  const [open, setOpen] = useState(null); // planos | nivel | null
  // Janela GLOBAL do cockpit (filtro unico no topo, 08/08): a coorte, o caixa
  // e o churn seguem a mesma janela do resto do cockpit.
  const { win } = usePeriod();
  const [product] = useActiveSaas();
  const { version } = useData();
  const cashState = useCustomerCash(product?.id, win, version);

  // Plano do cliente como o card/lista mostram: a ASSINATURA manda (ciclo →
  // anual/semestral/…), o campo c.plan é só o fallback. Assim "sem plano" só
  // sobra pra quem realmente não tem nem assinatura nem plano preenchido.
  const planOf = useMemo(() => {
    const byCustomer = new Map();
    for (const s of subs) {
      const cur = byCustomer.get(s.customer);
      // prioriza a ativa/past_due (mesma escolha do mainSub da lista)
      if (!cur || (s.status === "active" || s.status === "past_due")) byCustomer.set(s.customer, s);
    }
    return (c) => CYCLE_LABEL[byCustomer.get(c.id)?.cycle] || c.plan || "";
  }, [subs]);
  const m = useMemo(() => {
    const now = Date.now();
    const fromT = new Date(`${win.since}T00:00:00`).getTime();
    const endT = Math.min(new Date(`${win.until}T23:59:59`).getTime(), now);
    const inPeriod = (iso) => {
      const t = new Date(iso).getTime();
      return Number.isFinite(t) && (fromT == null || t >= fromT) && t <= endT;
    };

    // Cohort = clientes que ENTRARAM no período (em "Tudo", a base inteira,
    // incluindo cadastros antigos sem startedAt).
    const cohort = customers.filter((c) => (c.startedAt ? inPeriod(c.startedAt) : fromT == null));
    // Total contratado = soma do valor ANUAL (arr) de todos os clientes — o
    // valor real da carteira. Antes usava contractValue (arr ÷ ciclo), que
    // contava semestral pela metade e mensal por 1/12, encolhendo o total e
    // divergindo da meta vendida. O caixa é consultado separadamente na API.
    const faturado = cohort.reduce((a, c) => a + (Number(c.arr) || 0), 0);
    // Upsell vendido na janela continua compondo o contratado. O pagamento
    // dele entra no caixa da API pela data da baixa, mesmo se vendido antes.
    const upsellAt = (i) => i.soldAt || i.paidAt || i.dueDate || i.createdAt || "";
    const upsells = invoices.filter((i) => i.kind === "upsell" && (fromT == null ? true : inPeriod(upsellAt(i))));
    const sum = (list) => Math.round(list.reduce((a, i) => a + (Number(i.amount) || 0), 0) * 100) / 100;
    const upsell = {
      n: upsells.length,
      total: sum(upsells),
    };
    const withMrr = cohort.filter((c) => (Number(c.arr) || 0) > 0);
    const mrrMedio = withMrr.length ? withMrr.reduce((a, c) => a + (Number(c.arr) || 0) / 12, 0) / withMrr.length : 0;
    // Ticket = contrato dos clientes novos (sem upsell, que é venda pra cliente antigo).
    const ticket = cohort.length ? faturado / cohort.length : 0;
    const contratado = Math.round((faturado + upsell.total) * 100) / 100;

    const planos = new Map();
    for (const c of cohort) {
      const b = planBucket(planOf(c));
      planos.set(b, (planos.get(b) || 0) + 1);
    }

    // Churn do período: quem saiu (endedAt) ÷ base ativa no INÍCIO do período.
    // Em "Tudo", base = todo mundo que já foi cliente.
    const churned = customers.filter((c) => c.endedAt && inPeriod(c.endedAt));
    const baseStart = fromT == null
      ? customers.length
      : customers.filter((c) => {
          const s = c.startedAt ? new Date(c.startedAt).getTime() : 0;
          const e = c.endedAt ? new Date(c.endedAt).getTime() : Infinity;
          return s < fromT && e >= fromT;
        }).length;
    const churnPct = baseStart > 0 ? churned.length / baseStart : null;

    // LTV = preço mensal médio ÷ churn MENSAL (churn do período diluído nos
    // meses do período). Sem churn não existe divisor: mostra "sem churn ainda".
    const firstStart = Math.min(...customers.map((c) => (c.startedAt ? new Date(c.startedAt).getTime() : Infinity)));
    const spanStart = fromT ?? (Number.isFinite(firstStart) ? firstStart : now);
    const months = Math.max((endT - spanStart) / (30 * DAY), 1);
    const churnMonthly = churnPct != null ? churnPct / months : null;
    const lifeMonths = churnMonthly > 0 ? 1 / churnMonthly : null;
    const ltv = lifeMonths != null && mrrMedio > 0 ? mrrMedio * lifeMonths : null;

    return { cohort, faturado, contratado, upsell, mrrMedio, ticket, planos, churned, baseStart, churnPct, lifeMonths, ltv };
  }, [customers, invoices, win.since, win.until, planOf]);

  const pct = (v) => `${Math.round(v * 100)}%`;
  const planosTotal = m.cohort.length || 1;
  // Ordem canônica primeiro; categorias de fora dela (ex.: pacotes da mentoria)
  // entram depois, por volume — nenhum plano some do card.
  const planRows = [
    ...PLAN_ORDER.filter((b) => m.planos.get(b)),
    ...[...m.planos.keys()].filter((b) => !PLAN_ORDER.includes(b)).sort((a, b) => m.planos.get(b) - m.planos.get(a)),
  ].map((b) => ({ bucket: b, count: m.planos.get(b) }));

  // Janela em texto curto ("1 set – 12 set") pro subtítulo do dinheiro. "Tudo"
  // (sem since) fala a base inteira.
  const dia = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { day: "numeric", month: "short" }).replace(".", "");
  const janela = win.since ? `${dia(win.since)} – ${dia(win.until)}` : "a base inteira";
  const novos = m.cohort.length;

  // ── 1.1 Dinheiro do período ────────────────────────────────────────────────
  // Contratado anualizado, caixa recebido e cobranças abertas têm bases
  // distintas. Não desenhar composição/percentual entre esses valores.
  const rodape = [
    ["Ticket médio", money(m.ticket), "ARR ÷ clientes novos (sem upsell)"],
    ["Upsell", money(m.upsell.total), m.upsell.n ? `${m.upsell.n} ${m.upsell.n === 1 ? "venda registrada" : "vendas registradas"} no período` : "nenhum no período"],
    ...(isKids ? [] : [["Preço mensal médio", money(m.mrrMedio), "média do mensal (ARR ÷ 12)"]]),
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card>
        <div style={{ padding: "20px var(--inset-x)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 20, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div className="kicker accent">Dinheiro do período</div>
              <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 38, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.05, marginTop: 6 }}>{money(m.contratado)}</div>
              <div style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 3 }}>
                {`contratado anualizado · ${janela} · ${novos} ${novos === 1 ? "cliente novo" : "clientes novos"}`}
              </div>
            </div>
            <CustomerCashValues {...cashState} />
          </div>
          <InfoNota style={{ marginTop: 16 }}>Recebimentos seguem a data do pagamento e incluem clientes antigos. O contratado mostra o valor anualizado das novas vendas.</InfoNota>

          <div style={{ display: "grid", gridTemplateColumns: `repeat(${rodape.length}, minmax(0,1fr))`, gap: 16, marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--line-1)" }}>
            {rodape.map(([label, value, hint]) => (
              <div key={label} style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, color: "var(--fg-3)" }}>{label}</div>
                <div className="tnum" style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>{value}</div>
                <div style={{ fontSize: 11, color: "var(--fg-4)", marginTop: 1 }}>{hint}</div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* ── 1.2 Saúde da carteira ───────────────────────────────────────────── */}
      <Card>
        <div style={{ padding: "18px var(--inset-x)", display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 12, color: "var(--fg-3)" }}>Churn</div>
            <div className="tnum" style={{ fontSize: 20, fontWeight: 700, marginTop: 2, color: m.churned.length ? "var(--neg)" : "var(--fg-1)" }}>
              {m.churnPct == null ? "—" : pct(m.churnPct)}
            </div>
            <div style={{ fontSize: 11, color: "var(--fg-4)" }}>
              {m.churned.length ? `${m.churned.length} ${m.churned.length === 1 ? "saída" : "saídas"} · base de ${m.baseStart}` : "ninguém saiu no período"}
            </div>
          </div>
          {!isKids && (
            <div>
              <div style={{ fontSize: 12, color: "var(--fg-3)" }}>LTV</div>
              <div className="tnum" style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{m.ltv != null ? money(m.ltv) : "—"}</div>
              <div style={{ fontSize: 11, color: "var(--fg-4)" }}>
                {m.ltv != null ? `vida média ~${Math.round(m.lifeMonths)} meses` : "sem churn no período ainda"}
              </div>
            </div>
          )}
          {gradeDist && (
            <>
              <div style={{ width: 1, alignSelf: "stretch", background: "var(--line-1)" }} />
              <div style={{ flex: "1 1 260px", minWidth: 0, display: "flex", flexWrap: "wrap", gap: "10px 18px", alignItems: "center" }}>
                {["S", "A", "B", "C", "D", "E"].filter((g) => gradeDist.counts[g] > 0).map((g) => {
                  const st = GRADE_STYLE[g];
                  return (
                    <div key={g} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                      <span title={st.label} style={{ width: 22, height: 22, borderRadius: 6, background: st.tone, color: st.badgeFg, fontSize: 12.5, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1, flexShrink: 0 }}>{g}</span>
                      <span className="tnum" style={{ fontSize: 18, fontWeight: 700 }}>{gradeDist.counts[g]}</span>
                    </div>
                  );
                })}
                {gradeDist.sem > 0 && (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                    <span title="sem qualificação (lead não respondeu contas/anúncios)" style={{ width: 22, height: 22, borderRadius: 6, border: "1px solid var(--line-1)", color: "var(--fg-4)", fontSize: 12.5, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1, flexShrink: 0 }}>—</span>
                    <span className="tnum" style={{ fontSize: 18, fontWeight: 700, color: "var(--fg-3)" }}>{gradeDist.sem}</span>
                    <span style={{ fontSize: 11.5, color: "var(--fg-4)" }}>sem nível</span>
                  </div>
                )}
              </div>
            </>
          )}
          <div style={{ marginLeft: "auto", display: "flex", gap: 14, flexWrap: "wrap" }}>
            <button onClick={() => setOpen((o) => (o === "planos" ? null : "planos"))} className="mono"
              style={{ background: "none", border: 0, padding: 0, fontSize: 12, color: "var(--accent)", fontWeight: 600, cursor: "pointer" }}>
              {open === "planos" ? "planos e pacotes ▴" : "planos e pacotes ▾"}
            </button>
            {nivelLegend && (
              <button onClick={() => setOpen((o) => (o === "nivel" ? null : "nivel"))} className="mono"
                style={{ background: "none", border: 0, padding: 0, fontSize: 12, color: "var(--accent)", fontWeight: 600, cursor: "pointer" }}>
                {open === "nivel" ? "matriz do nível ▴" : "matriz do nível ▾"}
              </button>
            )}
          </div>
        </div>

        {open === "planos" && (
          <div style={{ padding: "6px var(--inset-x) 18px", borderTop: "1px solid var(--line-1)" }}>
            <div className="kicker" style={{ margin: "12px 0 6px" }}>{isKids ? "Pacotes dos clientes novos" : "Planos dos clientes novos"}</div>
            {planRows.length === 0 && (
              <div style={{ fontSize: 12.5, color: "var(--fg-4)", padding: "8px 0" }}>Nenhum cliente no período.</div>
            )}
            {planRows.map(({ bucket, count }) => (
              <div key={bucket} style={{ display: "grid", gridTemplateColumns: "140px 1fr auto auto", alignItems: "center", gap: 12, padding: "7px 0", borderBottom: "1px solid var(--line-1)", fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>{bucket}</span>
                <div style={{ height: 8, borderRadius: 4, background: "var(--bg-2)", overflow: "hidden" }}>
                  <div style={{ width: `${Math.max((count / planosTotal) * 100, 2)}%`, height: "100%", borderRadius: 4, background: "var(--accent)" }} />
                </div>
                <span className="tnum" style={{ fontWeight: 600 }}>{count}</span>
                <span className="tnum" style={{ fontSize: 12, color: "var(--fg-4)", width: 38, textAlign: "right" }}>{pct(count / planosTotal)}</span>
              </div>
            ))}
          </div>
        )}
        {open === "nivel" && nivelLegend && (
          <div style={{ padding: "12px var(--inset-x) 18px", borderTop: "1px solid var(--line-1)" }}>{nivelLegend}</div>
        )}
      </Card>
    </div>
  );
}
