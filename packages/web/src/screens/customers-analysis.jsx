import React from "react";
import { Card } from "../components/viz.jsx";
import { GRADE_STYLE } from "../lib/ui.js";
import { usePeriod } from "../components/period-picker.jsx";
import { paymentUpfront } from "../lib/payments.js";

// Análise da base de clientes — números do período sobre a coleção customers:
// total faturado (valor dos contratos fechados), clientes novos, ticket médio,
// preço mensal médio, churn e LTV. O período filtra por startedAt (entradas) e
// endedAt (churn); "Tudo" olha a base inteira. Nada aqui é gravado: é leitura
// dos mesmos campos que o gate de fechamento e o form de cliente preenchem.

const { useState, useMemo } = React;
const DAY = 86_400_000;

// customer.arr guarda o valor ANUAL (mensal ×12, semestral ×2 no convertWonLead).

// Divide o ARR ANUAL de um cliente entre já RECEBIDO e A RECEBER, de modo que
// os dois SEMPRE somem ao Total contratado (ARR). Regras de recebimento:
//  · CRONOGRAMA EXPLÍCITO (faturas kind:"installment") → é a VERDADE: recebido =
//    parcelas pagas, a receber = as em aberto. Cobre acordos sob medida que não
//    cabem no ciclo padrão (ex.: 40k em 4x + 80.788 em 12x do Galante).
//  · à vista / cartão 12x → a empresa recebe o valor do CICLO no fechamento de
//    cada ciclo. Anual: o ano todo de uma vez. Semestral: 1 semestre agora, o
//    outro só quando renovar (fica "a receber"). Único/sem plano: tudo agora.
//  · faturado / parcelado → uma parcela por mês ao longo do ano (12 parcelas).
// Cliente churnado para de gerar: o que faltava NÃO vira a receber.
function cashSplit(c, now, invoices = []) {
  const annual = Number(c.arr) || 0;
  if (annual <= 0) return { cash: 0, future: 0 };
  // Cronograma explícito vence a heurística: soma o que está pago × em aberto.
  const schedule = invoices.filter((i) => i.customer === c.id && i.kind === "installment");
  if (schedule.length) {
    const round = (n) => Math.round(n * 100) / 100;
    const cash = round(schedule.filter((i) => i.status === "paid").reduce((a, i) => a + (Number(i.amount) || 0), 0));
    const churnedNow = c.endedAt && new Date(c.endedAt).getTime() <= now;
    const future = churnedNow ? 0 : round(schedule.filter((i) => i.status !== "paid").reduce((a, i) => a + (Number(i.amount) || 0), 0));
    return { cash, future };
  }
  const start = c.startedAt ? new Date(c.startedAt).getTime() : now;
  const churnT = c.endedAt ? new Date(c.endedAt).getTime() : null;
  const stop = churnT != null ? Math.min(churnT, now) : now;
  const monthsIn = Math.max(1, Math.floor((stop - start) / (30 * DAY)) + 1); // 1ª entrada no fechamento
  const t = String(c.plan || "").toLowerCase();
  let cash;
  if (paymentUpfront(c.paymentMethod)) {
    if (t.includes("semestral")) {
      const started = Math.min(2, Math.floor((monthsIn - 1) / 6) + 1); // quantos semestres já começaram
      cash = (annual / 2) * started;
    } else if (t.includes("mensal")) {
      cash = (annual / 12) * Math.min(12, monthsIn);
    } else {
      cash = annual; // anual, serviço único, sem plano: recebe tudo no fechamento
    }
  } else {
    cash = (annual / 12) * Math.min(12, monthsIn); // faturado/parcelado: 1 parcela por mês
  }
  cash = Math.min(annual, cash);
  const future = churnT != null && churnT <= now ? 0 : annual - cash;
  return { cash, future };
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
// significam nada ali e saem — o resto (faturado, caixa, futuro, ticket, churn
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
    // divergindo da meta vendida. O contractValue segue só no caixa/futuro
    // (ali importa o valor de UMA parcela do ciclo, não o anual).
    const faturado = cohort.reduce((a, c) => a + (Number(c.arr) || 0), 0);
    // Caixa × dinheiro futuro dos contratos do período (parcelados entram mês a mês).
    let caixa = 0, futuro = 0;
    for (const c of cohort) {
      const s = cashSplit(c, now, invoices);
      caixa += s.cash;
      futuro += s.future;
    }
    // UPSELL do período (Leo, 09/09): a venda extra registrada na ficha, datada
    // pelo registro (soldAt), de QUALQUER cliente (o upsell é de cliente antigo
    // por natureza — a coorte de entrada não o alcança). Contratado soma no
    // Total contratado; pago no Recebido; em aberto no A receber — os três
    // continuam fechando. O acréscimo RECORRENTE já vive no arr do cliente;
    // aqui entra só o que foi cobrado na venda (amount).
    const upsellAt = (i) => i.soldAt || i.paidAt || i.dueDate || i.createdAt || "";
    const upsells = invoices.filter((i) => i.kind === "upsell" && (fromT == null ? true : inPeriod(upsellAt(i))));
    const sum = (list) => Math.round(list.reduce((a, i) => a + (Number(i.amount) || 0), 0) * 100) / 100;
    const upsell = {
      n: upsells.length,
      total: sum(upsells),
      paid: sum(upsells.filter((i) => i.status === "paid")),
      open: sum(upsells.filter((i) => i.status !== "paid")),
    };
    caixa += upsell.paid;
    futuro += upsell.open;
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

    return { cohort, faturado, contratado, upsell, caixa, futuro, mrrMedio, ticket, planos, churned, baseStart, churnPct, lifeMonths, ltv };
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
  // Eram dez StatTile de peso igual: a pessoa lia dez números pra descobrir se
  // o mês estava bom. Agora um número manda (o contratado) e a barra empilhada
  // mostra de onde ele vem — recebido e a receber SEMPRE somam o contratado, que
  // é a invariante que o cashSplit garante.
  const recebidoPct = m.contratado > 0 ? (m.caixa / m.contratado) * 100 : 0;
  const dot = (color) => ({ width: 6, height: 6, borderRadius: 999, background: color, flexShrink: 0 });
  const rodape = [
    ["Ticket médio", money(m.ticket), "ARR ÷ clientes novos (sem upsell)"],
    ["Upsell", money(m.upsell.total), m.upsell.n ? `${m.upsell.n} ${m.upsell.n === 1 ? "venda" : "vendas"} · ${money(m.upsell.paid)} recebido` : "nenhum no período"],
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
                {`contratado · ${janela} · ${novos} ${novos === 1 ? "cliente novo" : "clientes novos"}`}
              </div>
            </div>
            <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
              <div>
                <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 22, fontWeight: 700, color: "var(--pos)" }}>{money(m.caixa)}</div>
                <div style={{ fontSize: 12, color: "var(--fg-3)" }}>recebido</div>
              </div>
              <div>
                <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 22, fontWeight: 700, color: "var(--warn)" }}>{money(m.futuro)}</div>
                <div style={{ fontSize: 12, color: "var(--fg-3)" }}>a receber</div>
              </div>
            </div>
          </div>

          {m.contratado > 0 && (
            <>
              <div style={{ display: "flex", height: 14, borderRadius: 999, overflow: "hidden", background: "var(--bg-2)", marginTop: 16 }}
                title={`${money(m.caixa)} já entraram · ${money(m.futuro)} a receber · os dois somam o contratado`}>
                <div style={{ width: `${recebidoPct}%`, background: "var(--pos)" }} />
                <div style={{ width: `${100 - recebidoPct}%`, background: "var(--warn)" }} />
              </div>
              <div style={{ display: "flex", gap: 18, marginTop: 8, flexWrap: "wrap" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--fg-3)" }}>
                  <span style={dot("var(--pos)")} />{`recebido · ${Math.round(recebidoPct)}%`}
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--fg-3)" }}>
                  <span style={dot("var(--warn)")} />{`a receber · parcelas e renovações a vencer no ano`}
                </span>
              </div>
            </>
          )}

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
                    <span title="sem qualificação (lead não respondeu contas/anúncios)" style={{ width: 22, height: 22, borderRadius: 6, border: "1px solid var(--line-2)", color: "var(--fg-4)", fontSize: 12.5, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1, flexShrink: 0 }}>—</span>
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
