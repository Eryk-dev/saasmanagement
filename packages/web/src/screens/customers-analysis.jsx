import React from "react";
import { StatTile, FilterTab, Card } from "../components/viz.jsx";
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
//  · à vista / cartão 12x → a empresa recebe o valor do CICLO no fechamento de
//    cada ciclo. Anual: o ano todo de uma vez. Semestral: 1 semestre agora, o
//    outro só quando renovar (fica "a receber"). Único/sem plano: tudo agora.
//  · faturado / parcelado → uma parcela por mês ao longo do ano (12 parcelas).
// Cliente churnado para de gerar: o que faltava NÃO vira a receber.
function cashSplit(c, now) {
  const annual = Number(c.arr) || 0;
  if (annual <= 0) return { cash: 0, future: 0 };
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

const SHORTCUTS = [
  { key: "tudo", label: "Tudo" },
  { key: "mes", label: "Este mês" },
  { key: "30d", label: "30 dias" },
  { key: "90d", label: "90 dias" },
  { key: "ano", label: "Este ano" },
];

function shortcutRange(key, now) {
  const d = new Date(now);
  if (key === "mes") return [new Date(d.getFullYear(), d.getMonth(), 1).getTime(), null];
  if (key === "30d") return [now - 30 * DAY, null];
  if (key === "90d") return [now - 90 * DAY, null];
  if (key === "ano") return [new Date(d.getFullYear(), 0, 1).getTime(), null];
  return [null, null]; // tudo
}

// `isKids` = workspace de mentoria (compra única, sem recorrência): as métricas
// de assinatura (preço mensal médio e LTV, que derivam de MRR ÷ churn) não
// significam nada ali e saem — o resto (faturado, caixa, futuro, ticket, churn
// de famílias) vale igual.
export function CustomersAnalysis({ customers, subs = [], isKids = false }) {
  const money = window.fmt.money;
  const [shortcut, setShortcut] = useState("tudo");

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
  const [fromInput, setFromInput] = useState("");
  const [toInput, setToInput] = useState("");
  const custom = shortcut === "custom";

  const m = useMemo(() => {
    const now = Date.now();
    let [fromT, toT] = shortcutRange(shortcut, now);
    if (custom) {
      fromT = fromInput ? new Date(`${fromInput}T00:00:00`).getTime() : null;
      toT = toInput ? new Date(`${toInput}T23:59:59`).getTime() : null;
    }
    const endT = toT ?? now;
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
      const s = cashSplit(c, now);
      caixa += s.cash;
      futuro += s.future;
    }
    const withMrr = cohort.filter((c) => (Number(c.arr) || 0) > 0);
    const mrrMedio = withMrr.length ? withMrr.reduce((a, c) => a + (Number(c.arr) || 0) / 12, 0) / withMrr.length : 0;
    const ticket = cohort.length ? faturado / cohort.length : 0;

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

    return { cohort, faturado, caixa, futuro, mrrMedio, ticket, planos, churned, baseStart, churnPct, lifeMonths, ltv };
  }, [customers, shortcut, custom, fromInput, toInput, planOf]);

  const pct = (v) => `${Math.round(v * 100)}%`;
  const dateField = {
    height: 32, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)",
    background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12.5,
  };
  const planosTotal = m.cohort.length || 1;
  // Ordem canônica primeiro; categorias de fora dela (ex.: pacotes da mentoria)
  // entram depois, por volume — nenhum plano some do card.
  const planRows = [
    ...PLAN_ORDER.filter((b) => m.planos.get(b)),
    ...[...m.planos.keys()].filter((b) => !PLAN_ORDER.includes(b)).sort((a, b) => m.planos.get(b) - m.planos.get(a)),
  ].map((b) => ({ bucket: b, count: m.planos.get(b) }));

  // Embutida no topo da aba Clientes (acima das Próximas ações) — o padding de
  // página é do container; aqui só o empilhamento interno.
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {SHORTCUTS.map((s) => (
          <FilterTab key={s.key} active={shortcut === s.key} onClick={() => setShortcut(s.key)}>{s.label}</FilterTab>
        ))}
        <span style={{ width: 1, height: 20, background: "var(--line-2)", margin: "0 6px" }} />
        <input type="date" value={fromInput} onChange={(e) => { setFromInput(e.target.value); setShortcut("custom"); }}
          aria-label="De" style={{ ...dateField, borderColor: custom && fromInput ? "var(--accent)" : "var(--line-2)" }} />
        <span style={{ fontSize: 12.5, color: "var(--fg-4)" }}>até</span>
        <input type="date" value={toInput} onChange={(e) => { setToInput(e.target.value); setShortcut("custom"); }}
          aria-label="Até" style={{ ...dateField, borderColor: custom && toInput ? "var(--accent)" : "var(--line-2)" }} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <StatTile label="Total contratado" value={money(m.faturado)} delta="valor anual (ARR) dos clientes do período" />
        <StatTile label="Recebido" value={money(m.caixa)} delta="já entrou · à vista + parcelas/ciclos vencidos" />
        <StatTile label="A receber" value={money(m.futuro)} delta="parcelas e renovações a vencer no ano" />
        <StatTile label="Clientes novos" value={String(m.cohort.length)} delta="entraram no período" />
        <StatTile label="Ticket médio" value={money(m.ticket)} delta="ARR ÷ clientes novos" />
        {!isKids && <StatTile label="Preço mensal médio" value={money(m.mrrMedio)} delta="média do mensal (ARR ÷ 12)" />}
        <StatTile label="Churn" tone={m.churned.length > 0 ? "down" : "flat"}
          value={m.churnPct == null ? "—" : pct(m.churnPct)}
          small={m.churned.length ? `${m.churned.length} ${m.churned.length === 1 ? "saída" : "saídas"}` : ""}
          delta={m.baseStart ? `sobre base de ${m.baseStart} no início do período` : "sem base no início do período"} />
        {!isKids && (
          <StatTile label="LTV" value={m.ltv != null ? money(m.ltv) : "—"}
            delta={m.ltv != null
              ? `vida média ~${Math.round(m.lifeMonths)} meses × preço mensal médio`
              : "sem churn no período ainda (marque a saída no cliente pra calcular)"} />
        )}
      </div>

      <Card title={isKids ? "Quantidade de pacotes" : "Quantidade de planos"} hint={isKids ? "clientes novos do período, por pacote comprado" : "clientes novos do período, por plano fechado"}>
        <div style={{ padding: "8px 24px 16px" }}>
          {planRows.length === 0 && (
            <div style={{ fontSize: 12.5, color: "var(--fg-4)", padding: "8px 0" }}>Nenhum cliente no período.</div>
          )}
          {planRows.map(({ bucket, count }) => (
            <div key={bucket} style={{ display: "grid", gridTemplateColumns: "140px 1fr auto auto", alignItems: "center", gap: 12, padding: "7px 0", borderBottom: "1px solid var(--line-faint)", fontSize: 13 }}>
              <span style={{ fontWeight: 600 }}>{bucket}</span>
              <div style={{ height: 8, borderRadius: 4, background: "var(--bg-2)", overflow: "hidden" }}>
                <div style={{ width: `${Math.max((count / planosTotal) * 100, 2)}%`, height: "100%", borderRadius: 4, background: "var(--accent)" }} />
              </div>
              <span className="tnum" style={{ fontWeight: 600 }}>{count}</span>
              <span className="tnum" style={{ fontSize: 12, color: "var(--fg-4)", width: 38, textAlign: "right" }}>{pct(count / planosTotal)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
