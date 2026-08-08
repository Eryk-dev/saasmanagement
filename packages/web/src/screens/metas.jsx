import React from "react";
import { PageHead, Card } from "../components/viz.jsx";
import { Avatar } from "../atoms.jsx";
import { api } from "../lib/api.js";
import { useActiveSaas } from "../lib/workspace.js";
import { Regua, levelOf } from "./overview.jsx";

// Metas — edita TODAS as metas de desempenho do produto por VAGA (SDR / closer
// / integrador) e, opcionalmente, por PESSOA. Escreve na collection `goals`, a
// mesma que o scoreboard e a Visão geral leem, então vale em todo campo que
// mostra meta. Campo vazio = usa o benchmark padrão.
//
// Reformulada (08/08/2026) no modelo aprovado da Visão geral: a meta do mês em
// RÉGUA com pace (digitar já move a barra; salvar é o que grava), a cadeia como
// funil HORIZONTAL com as taxas nos degraus, explicação longa em tooltip e a
// agenda de meses no fim, porque planejamento mexe pouco e operação fica em
// cima. Escala de cores única: vermelho → teal → verde → dourado.

const { useState: useS, useEffect: useE } = React;

// Meta digitada que briga com o que a meta do mês exige (mais de 15% de
// diferença). 15% porque arredondamento de cadeia sempre dá uma folga pequena,
// e avisar por 3 de diferença vira ruído que ninguém lê.
const divergente = (digitado, derivado) => {
  const v = Number(String(digitado ?? "").trim());
  if (!(v > 0) || !(Number(derivado) > 0)) return false;
  return Math.abs(v - derivado) / derivado > 0.15;
};

// "2026-08" → "ago/2026" (o mês da agenda de metas).
const mesLabel = (m) => {
  const [ano, mes] = String(m).split("-");
  const d = new Date(Number(ano), Number(mes) - 1, 1);
  return d.toLocaleDateString("pt-BR", { month: "short", year: "numeric" }).replace(".", "");
};

const rk = (role, metric) => `${role}:${metric}`;

const money = (n) => `R$ ${Math.round(n).toLocaleString("pt-BR")}`;
const pct = (v) => `${Math.round(v * 1000) / 10}%`.replace(".", ",");
const int = (n) => Math.round(n).toLocaleString("pt-BR");

// De onde veio cada número — sem isso a cadeia parece chute.
const RATE_SOURCE = {
  history: "medido nos últimos 30 dias",
  calibrated: "calibrado pela ponta a ponta real",
  goal: "da meta configurada",
  benchmark: "padrão do mercado",
};
const TICKET_SOURCE = {
  initial_payments: "1ª fatura paga de cada cliente",
  paid_invoices: "faturas pagas recentes",
  won_tcv: "valor dos ganhos recentes",
  configured_ticket: "o ticket que você configurou",
};
const BLOCKED = {
  ticket: "sem ticket médio ainda (nenhuma fatura paga nem valor lançado nos ganhos): preencha o Ticket médio no card do Closer e a cadeia passa a fechar.",
  closeRate: "a conversão da call está zerada, sem histórico e sem meta: preencha Call → ganho no card do Closer.",
  showRate: "o comparecimento está zerado, sem histórico e sem meta: preencha Comparecimento na call no card do SDR.",
  bookingRate: "a taxa de agendamento está zerada, sem histórico e sem meta: preencha Taxa de agendamento no card do SDR.",
  contactRate: "a taxa de contato está zerada, sem histórico e sem meta: preencha Taxa de contato no card do SDR.",
};
const blockedText = (k) => BLOCKED[k] || "faltam dados pra desdobrar a meta.";

// ── Cadeia da meta como funil horizontal ─────────────────────────────────────
// Mesmo desenho do Funil do período da Visão geral, só que com o que a meta
// EXIGE: caixa = volume da etapa, degrau = a taxa que liga uma etapa à outra
// (a origem de cada número mora no hover). Lê da esquerda pra direita: leads
// viram contatos, contatos viram calls, calls viram ganhos, ganhos viram venda.
function ChainBox({ nm, big, sub, title }) {
  return (
    <div title={title} style={{ flex: "1 1 0", minWidth: 92, padding: "4px 6px", textAlign: "center", cursor: title ? "help" : "default" }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--fg-3)", marginBottom: 4, whiteSpace: "nowrap" }}>{nm}</div>
      <div className="tnum" style={{ fontFamily: "var(--display)", fontSize: 22, fontWeight: 650, letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>{big}</div>
      <div className="tnum" style={{ fontSize: 10.5, color: "var(--fg-4)", minHeight: 15, whiteSpace: "nowrap" }}>{sub || ""}</div>
    </div>
  );
}

function ChainStep({ big, nm, title }) {
  return (
    <div title={title} style={{ flex: "0 0 auto", alignSelf: "center", textAlign: "center", padding: "0 6px", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, cursor: title ? "help" : "default" }}>
      {big != null && <span className="tnum" style={{ fontSize: 12.5, fontWeight: 650, color: "var(--accent)" }}>{big}</span>}
      <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true" style={{ color: "var(--fg-4)" }}>
        <path d="M1 5h10m0 0L8 2m3 3L8 8" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      </svg>
      <span style={{ fontSize: 10, color: "var(--fg-4)", whiteSpace: "nowrap" }}>{nm}</span>
    </div>
  );
}

function chainParts(d, people = {}) {
  const share = (total, role) => {
    const n = people?.[role] || 0;
    return n > 1 ? `${int(total / n)} por pessoa` : null;
  };
  const fonte = (nome, src) => `${nome}: ${RATE_SOURCE[src] || "sem origem"}.`;
  const boxes = [
    { nm: "Leads", big: int(d.leads), sub: "marketing entrega", title: "Entrada do funil: quem entrega é o marketing, então não vira meta de vaga." },
    { nm: "Contatos", big: int(d.contacts), sub: share(d.contacts, "sdr"), title: "Contatos no mês (meta do time de SDR)." },
    { nm: "Agendadas", big: int(d.callsBooked), sub: share(d.callsBooked, "sdr"), title: "Calls agendadas no mês (meta do time de SDR)." },
    { nm: "Realizadas", big: int(d.callsShown), sub: null, title: "Calls realizadas no mês, sem contar no-show (meta do time de closer)." },
    { nm: "Ganhos", big: int(d.won), sub: [d.wonSource === "company" ? "digitado vence" : null, share(d.won, "closer")].filter(Boolean).join(" · ") || null,
      title: d.wonSource === "company" ? "Meta de contratos digitada na Meta do mês: vence a divisão venda ÷ ticket." : "Meta de venda ÷ ticket médio." },
    { nm: d.superMode ? `Super ${d.chasePct}%` : "Venda", big: money(d.target), sub: d.superMode ? `base ${money(d.base)} batida` : "meta do mês",
      title: d.superMode ? `A meta base já caiu; a cadeia inteira persegue a próxima super meta (${d.chasePct}% da base).` : "A meta de venda do mês corrente." },
  ];
  const steps = [
    { big: pct(d.rates.contactRate), nm: "contato", title: fonte("Taxa de contato", d.rates.contactRateSource) },
    { big: pct(d.rates.bookingRate), nm: "agendamento", title: fonte("Taxa de agendamento", d.rates.bookingRateSource) },
    { big: pct(d.rates.showRate), nm: "comparecimento", title: fonte("Comparecimento", d.rates.showRateSource) },
    { big: pct(d.rates.closeRate), nm: "conversão", title: fonte("Conversão da call", d.rates.closeRateSource) },
    d.ticket
      ? { big: money(d.ticket), nm: "× ticket médio", title: `Ticket médio: ${TICKET_SOURCE[d.ticketSource] || "sem origem"}.` }
      : { big: null, nm: "contratos digitados", title: "Sem ticket médio ainda: a meta de contratos digitada sustenta a cadeia sozinha." },
  ];
  return { boxes, steps };
}

function MetasScreen() {
  const [product] = useActiveSaas();
  const [data, setData] = useS(null);
  const [pace, setPace] = useS(null);          // vendido/pace do mês — alimenta as réguas
  const [roleVals, setRoleVals] = useS({});     // "role:metric" -> string
  const [overrides, setOverrides] = useS([]);   // [{ key, metric, target }]
  const [cash, setCash] = useS("");             // meta padrão (R$) — product.monthlyCashTarget
  const [contratos, setContratos] = useS("");   // meta de contratos do mês (nº) — product.monthlyContractsTarget
  const [growth, setGrowth] = useS("");         // % de crescimento ao mês — product.monthlyCashGrowthPct
  const [orig, setOrig] = useS(null);           // snapshot pro dirty/descartar
  const [err, setErr] = useS(null);
  const [meses, setMeses] = useS({});   // agenda: "AAAA-MM" -> meta daquele mês
  const [saving, setSaving] = useS(false);
  const [note, setNote] = useS(null);

  // Snapshot vindo da API → estados dos campos + baseline do dirty.
  const applyData = (d) => {
    const rv = {};
    for (const r of d.roles) for (const m of r.metrics) rv[rk(r.role, m.metric)] = m.target != null ? String(m.target) : "";
    const ov = (d.userGoals || []).map((g) => ({ key: g.key, metric: g.metric, target: String(g.target) }));
    const ct = d.company?.cashTarget != null ? String(d.company.cashTarget) : "";
    const kt = d.company?.contractsTarget != null ? String(d.company.contractsTarget) : "";
    const gr = d.company?.growthPct != null ? String(d.company.growthPct) : "";
    const ms = Object.fromEntries((d.company?.months || []).map((m) => [m.month, m.target != null ? String(m.target) : ""]));
    setData(d); setRoleVals(rv); setOverrides(ov); setCash(ct); setContratos(kt); setGrowth(gr); setMeses(ms);
    setOrig({ roleVals: JSON.stringify(rv), overrides: JSON.stringify(ov), cash: ct, contratos: kt, growth: gr, meses: JSON.stringify(ms) });
  };

  useE(() => {
    if (!product?.id) return;
    let alive = true;
    setData(null); setErr(null); setNote(null); setPace(null);
    api.metas(product.id).then((d) => alive && applyData(d)).catch((e) => alive && setErr(e.message));
    api.pipelinePace(product.id).then((p) => alive && setPace(p)).catch(() => alive && setPace(null));
    return () => { alive = false; };
  }, [product?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = orig && (JSON.stringify(roleVals) !== orig.roleVals || JSON.stringify(overrides) !== orig.overrides || cash !== orig.cash || contratos !== orig.contratos || growth !== orig.growth || JSON.stringify(meses) !== orig.meses);

  // Mapa metric -> { label, unit } (pros rótulos dos overrides).
  const metricInfo = {};
  for (const r of data?.roles || []) for (const m of r.metrics) metricInfo[m.metric] = { label: m.label, unit: m.unit, role: r.role };
  const allMetrics = Object.entries(metricInfo);
  // O MÊS ATUAL é o campo principal (é o que a plataforma persegue agora); a
  // agenda dos seguintes vive no card do fim.
  const mesAtualInfo = (data?.company?.months || []).find((m) => m.current) || null;
  const proximosMeses = (data?.company?.months || []).filter((m) => !m.current);
  // Métricas que seguem o plano de REMUNERAÇÃO (contratos/receita de SDR e
  // closer): não são campo de vaga — o plano vence no placar.
  const compKeys = new Set();
  for (const r of data?.roles || []) for (const m of r.metrics) if (m.compPlan) compKeys.add(rk(r.role, m.metric));

  // ── Réguas ao vivo: o vendido do pace contra o alvo que estiver no campo. ──
  // Digitar já move a barra (a conta é local); salvar é o que grava no produto.
  const mesAtualDraft = mesAtualInfo ? (meses[mesAtualInfo.month] ?? "") : "";
  const saleLive = (() => {
    const s = pace?.sale;
    if (!s) return null;
    const digitado = Number(String(mesAtualDraft).trim());
    const alvo = digitado > 0 ? digitado : s.target;
    if (!(alvo > 0)) return null;
    return {
      sold: s.sold || 0, alvo, progress: (s.sold || 0) / alvo, expected: s.expectedProgress,
      lvl: levelOf(s.sold, alvo, s.expectedProgress),
      title: `Receita nova contratada no mês (contrato cheio). Hoje: ${money(s.soldToday)} · ritmo ${money(s.actualDailyPace)}/dia útil`
        + (s.requiredDailyPace != null ? ` · precisa ${money(s.requiredDailyPace)}/dia` : "")
        + ` · ${int(s.remainingBusinessDays)} dias úteis restantes · projeção do mês ${money(s.projected)}.`,
    };
  })();
  const contractsLive = (() => {
    if (!pace) return null;
    const c = pace.contracts || {};
    const digitado = Number(String(contratos).trim());
    const alvo = digitado > 0 ? Math.round(digitado) : (Number(c.target) > 0 ? c.target : null);
    if (!(alvo > 0)) return null;
    const expected = c.expectedProgress ?? pace.sale?.expectedProgress;
    return {
      sold: c.sold || 0, alvo, progress: (c.sold || 0) / alvo, expected,
      lvl: levelOf(c.sold || 0, alvo, expected),
      title: digitado > 0 || c.targetSource === "company"
        ? "Meta de contratos digitada (a mesma da remuneração)."
        : "Meta derivada: venda do mês ÷ ticket médio sem contas grandes.",
    };
  })();

  function setRole(role, metric, v) { setRoleVals((p) => ({ ...p, [rk(role, metric)]: v })); }

  // Preenche os campos de VOLUME com o desdobramento da meta do mês (não salva:
  // o Leo confere e clica em salvar). As taxas ficam como estão — são a ambição
  // que ALIMENTA a cadeia, não resultado dela.
  function applyDerived() {
    // Contratos/receita de SDR e closer ficam de fora: seguem o plano de
    // remuneração por pessoa, não têm campo de vaga pra preencher.
    const list = (data?.derived?.goals || []).filter((g) => !compKeys.has(rk(g.role, g.metric)));
    if (!list.length) return;
    setRoleVals((p) => ({ ...p, ...Object.fromEntries(list.map((g) => [rk(g.role, g.metric), String(Math.round(g.target))])) }));
    setNote({ ok: true, text: "campos preenchidos pelo pace · confira e clique em salvar metas" });
  }
  function addOverride() {
    const firstUser = data?.users?.[0]?.id || "";
    setOverrides((p) => [...p, { key: firstUser, metric: allMetrics[0]?.[0] || "", target: "" }]);
  }
  function setOv(i, field, v) { setOverrides((p) => p.map((o, j) => (j === i ? { ...o, [field]: v } : o))); }
  function rmOv(i) { setOverrides((p) => p.filter((_, j) => j !== i)); }

  async function save() {
    setSaving(true); setNote(null);
    try {
      const goals = [];
      // metas por vaga: manda tudo (vazio = servidor apaga → volta pro padrão).
      // As do plano de remuneração não têm campo de vaga: não manda nem apaga.
      for (const r of data.roles) for (const m of r.metrics) {
        if (m.compPlan) continue;
        goals.push({ scope: "role", key: r.role, metric: m.metric, target: roleVals[rk(r.role, m.metric)] });
      }
      // overrides atuais
      const seen = new Set();
      for (const o of overrides) {
        if (!o.key || !o.metric) continue;
        seen.add(`${o.key}:${o.metric}`);
        goals.push({ scope: "user", key: o.key, metric: o.metric, target: o.target });
      }
      // overrides removidos (estavam no original, sumiram) → apaga
      for (const o of JSON.parse(orig.overrides)) {
        if (!seen.has(`${o.key}:${o.metric}`)) goals.push({ scope: "user", key: o.key, metric: o.metric, target: "" });
      }
      await api.saveMetas(product.id, goals, { cashTarget: cash, contractsTarget: contratos, growthPct: growth, months: meses });
      applyData(await api.metas(product.id));
      // Meta nova = pace novo: as réguas e a cadeia recalculam por cima do salvo.
      api.pipelinePace(product.id).then(setPace).catch(() => {});
      setNote({ ok: true, text: "metas salvas · valem em todo campo que mostra meta" });
    } catch (e) {
      setNote({ ok: false, text: e.message });
    }
    setSaving(false);
  }
  function reset() {
    if (!orig) return;
    setRoleVals(JSON.parse(orig.roleVals)); setOverrides(JSON.parse(orig.overrides)); setCash(orig.cash); setContratos(orig.contratos); setGrowth(orig.growth); setMeses(JSON.parse(orig.meses));
  }

  const inp = { height: 38, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 13 };
  const infoDot = (t) => <span className="dim" title={t} style={{ fontSize: 10.5, cursor: "help", marginLeft: 5 }}>ⓘ</span>;
  const nameOf = (id) => data?.users?.find((u) => u.id === id)?.name || id;
  // "12 por pessoa · 2 na vaga" — só faz sentido em métrica de time com mais de
  // uma pessoa na vaga (taxa e ticket não se repartem).
  const shareHint = (m, role) => {
    const n = Number(roleVals[rk(role, m.metric)]);
    const people = data?.people?.[role] || 0;
    if (!m.team || !(n > 0) || people <= 1) return null;
    const per = n / people;
    return `${m.unit === "R$" ? money(per) : int(per)} por pessoa · ${people} na vaga`;
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, maxWidth: 1080, width: "100%" }}>
      <PageHead title="Metas" sub="metas por vaga e por pessoa · valem em todo campo que mostra meta">
        <button onClick={reset} disabled={saving || !dirty} style={{ height: 32, padding: "0 13px", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", background: "var(--bg-1)", boxShadow: "var(--shadow-1)", color: "var(--fg-2)", fontSize: 12.5, fontWeight: 600, opacity: dirty ? 1 : .55 }}>descartar</button>
        <button onClick={save} disabled={saving || !dirty}
          style={{ height: 32, padding: "0 15px", borderRadius: "var(--r-2)", background: "var(--btn-bg)", color: "var(--btn-fg)", fontSize: 12.5, fontWeight: 600, opacity: saving || !dirty ? 0.55 : 1 }}>
          {saving ? "salvando…" : "salvar metas"}
        </button>
      </PageHead>

      <div style={{ flex: 1, overflow: "auto", padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16 }}>
        {err && <div className="mono" style={{ fontSize: 12, color: "var(--neg)" }}>{err}</div>}
        {note && <div className="mono" style={{ fontSize: 12, color: note.ok ? "var(--pos)" : "var(--neg)" }}>{note.text}</div>}
        {!data && !err && <div className="mono dim" style={{ fontSize: 12 }}>carregando metas…</div>}

        {data && (
          <>
            {/* 1 · Meta do mês: as duas réguas da Visão geral com os campos que
                as editam logo abaixo. A régua usa o vendido real do pace contra
                o alvo digitado, então dá pra ver o efeito antes de salvar. */}
            <Card title="Meta do mês"
              hint={<>
                {mesAtualInfo ? mesLabel(mesAtualInfo.month) : "mês corrente"} · digitar move a régua na hora, salvar é o que grava
                {infoDot("A faixa Meta do mês da Visão geral e a Análise de Pace perseguem esse número pelo VENDIDO (contrato cheio; cartão em 12x conta inteiro) e desdobram o que falta em ganhos, calls, contatos e leads por dia. Na virada do mês, o valor do mês novo assume sozinho: o agendado, se houver, senão a regra de crescimento. O caixa e o dinheiro futuro ficam na aba Clientes.")}
              </>}>
              <div className="resp-cols" style={{ "--cols": "1fr 1fr", gap: "18px 36px", padding: "16px var(--inset-x) 20px" }}>
                <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
                  {saleLive && (
                    <Regua label="Régua de receita" title={saleLive.title}
                      valueText={<><strong className="tnum" style={{ color: "var(--fg-1)", fontWeight: 650 }}>{money(saleLive.sold)}</strong> / {money(saleLive.alvo)} · {Math.round((saleLive.progress || 0) * 100)}%</>}
                      pct={saleLive.progress} expectedPct={saleLive.expected} lvl={saleLive.lvl} />
                  )}
                  {mesAtualInfo && (
                    <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: "var(--fg-1)", minWidth: 0 }}>
                        Meta de venda do mês
                        {mesAtualDraft === "" && (
                          <span className="dim" style={{ display: "block", fontSize: 11.5, fontWeight: 400 }}>
                            sem valor próprio · {mesAtualInfo.source === "growth" ? "segue a regra de crescimento" : "vale a meta padrão"} ({money(mesAtualInfo.effective)})
                          </span>
                        )}
                      </span>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <span className="mono dim" style={{ fontSize: 12 }}>R$</span>
                        <input type="number" min="0" step="1" inputMode="decimal"
                          value={meses[mesAtualInfo.month] ?? ""}
                          onChange={(e) => setMeses((p) => ({ ...p, [mesAtualInfo.month]: e.target.value }))}
                          placeholder={String(mesAtualInfo.effective)}
                          className="tnum" style={{ ...inp, width: 130, textAlign: "right" }} />
                      </div>
                    </label>
                  )}
                </div>
                <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
                  {contractsLive ? (
                    <Regua label="Régua de contratos" title={contractsLive.title}
                      valueText={<><strong className="tnum" style={{ color: "var(--fg-1)", fontWeight: 650 }}>{int(contractsLive.sold)}</strong> / {int(contractsLive.alvo)} · {Math.round((contractsLive.progress || 0) * 100)}%</>}
                      pct={contractsLive.progress} expectedPct={contractsLive.expected} lvl={contractsLive.lvl} />
                  ) : pace != null ? (
                    <div style={{ fontSize: 12.5, color: "var(--fg-4)" }}>
                      Sem meta de contratos ainda: registre uma venda (pro ticket existir) ou digite abaixo.
                    </div>
                  ) : null}
                  {/* Nº de contratos do mês: a mesma meta em unidades de fechamento.
                      Vazio segue a venda ÷ ticket (o número que o pace já usa);
                      digitado vence a divisão — e, como todo digitado, não escala
                      em super meta. */}
                  <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: "var(--fg-1)", minWidth: 0 }}>
                      Meta de contratos no mês
                      {contratos === "" && data.derived?.wonFromTicket != null && (
                        <span style={{ display: "block", fontSize: 11.5, fontWeight: 400, color: "var(--accent)" }}>seguindo a venda ÷ ticket: {data.derived.wonFromTicket}</span>
                      )}
                      {divergente(contratos, data.derived?.wonFromTicket) && (
                        <button type="button" onClick={() => setContratos(String(data.derived.wonFromTicket))}
                          style={{ display: "block", fontSize: 11.5, color: "var(--warn)", textAlign: "left", fontWeight: 600 }}>
                          a venda ÷ ticket dá {data.derived.wonFromTicket} · usar esse
                        </button>
                      )}
                    </span>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <input type="number" min="0" step="1" inputMode="numeric" value={contratos}
                        onChange={(e) => setContratos(e.target.value)}
                        placeholder={data.derived?.wonFromTicket != null ? `${data.derived.wonFromTicket} pela venda` : "digite"}
                        className="tnum" style={{ ...inp, width: 130, textAlign: "right" }} />
                      <span className="mono dim" style={{ fontSize: 12 }}>contratos</span>
                    </div>
                  </label>
                </div>
              </div>
            </Card>

            {/* 2 · Cadeia da meta: o desdobramento como funil horizontal, com o
                botão que joga os volumes nos campos das vagas. */}
            {data.derived && (
              <Card title="Cadeia da meta"
                hint={<>
                  {data.derived.superMode ? `meta base batida · perseguindo a super meta ${data.derived.chasePct}%` : "o que a meta do mês exige de cada etapa · recalcula ao salvar"}
                  {infoDot("A meta de venda desce pela MESMA cadeia e pelas mesmas taxas da Análise de Pace, então os dois lugares contam a mesma história. Passe o mouse em cada número pra ver de onde ele veio.")}
                </>}
                action={!data.derived.blockedBy ? (
                  <button onClick={applyDerived}
                    title="Preenche os campos de VOLUME das vagas (calls, contatos, ganhos do time) com o desdobramento abaixo. As taxas ficam como estão: são a ambição que alimenta a cadeia, não resultado dela. Nada é gravado até clicar em salvar metas."
                    style={{ height: 32, padding: "0 13px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", boxShadow: "var(--shadow-1)", color: "var(--fg-2)", fontSize: 12.5, fontWeight: 600 }}>
                    derivar metas do pace
                  </button>
                ) : null}>
                {data.derived.blockedBy ? (
                  <div style={{ padding: "12px var(--inset-x) 18px" }}>
                    <div className="mono" style={{ fontSize: 12.5, color: "var(--warn)" }}>{blockedText(data.derived.blockedBy)}</div>
                  </div>
                ) : (
                  <div className="tbl-x" style={{ padding: "10px var(--inset-x) 18px" }}>
                    <div style={{ display: "flex", gap: 0, alignItems: "stretch", minWidth: 680 }}>
                      {(() => {
                        const { boxes, steps } = chainParts(data.derived, data.people);
                        return boxes.map((b, i) => (
                          <React.Fragment key={b.nm}>
                            {i > 0 && <ChainStep {...steps[i - 1]} />}
                            <ChainBox {...b} />
                          </React.Fragment>
                        ));
                      })()}
                    </div>
                  </div>
                )}
              </Card>
            )}

            {/* 3 · Metas por vaga: campo vazio segue a meta do mês pela cadeia
                (o placar usa o mesmo fallback); digitado vence, e quando briga
                com a cadeia a tela avisa em vez de deixar duas verdades
                convivendo caladas. */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 14 }}>
              {data.roles.map((r) => (
                <Card key={r.role} title={r.label} hint={r.hint}>
                  <div style={{ padding: "6px var(--inset-x) 18px", display: "flex", flexDirection: "column" }}>
                    {r.metrics.filter((m) => !m.compPlan).map((m) => (
                      <label key={m.metric} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--line-faint)" }}>
                        <span style={{ flex: 1, fontSize: 13.5, color: "var(--fg-2)", minWidth: 0 }}>
                          {m.label}
                          {/* Denominador da taxa escrito por extenso: "25%" sem
                              dizer de quê foi o que deixou duas metas brigando. */}
                          {m.hint && <span className="dim" style={{ display: "block", fontSize: 11.5 }}>{m.hint}</span>}
                          {/* Meta de volume é do TIME: mostra a parte de cada um,
                              que é o que o placar vai cobrar da pessoa. */}
                          {shareHint(m, r.role) && <span className="dim" style={{ display: "block", fontSize: 11.5 }}>{shareHint(m, r.role)}</span>}
                          {roleVals[rk(r.role, m.metric)] === "" && m.derived != null && (
                            <span style={{ display: "block", fontSize: 11.5, color: "var(--accent)" }}>seguindo {data.derived?.superMode ? `a super meta ${data.derived.chasePct}%` : "a meta do mês"}: {Math.round(m.derived)}</span>
                          )}
                          {divergente(roleVals[rk(r.role, m.metric)], m.derived) && (
                            <button type="button" onClick={() => setRole(r.role, m.metric, String(Math.round(m.derived)))}
                              style={{ display: "block", fontSize: 11.5, color: "var(--warn)", textAlign: "left", fontWeight: 600 }}>
                              {data.derived?.superMode ? `a super meta ${data.derived.chasePct}%` : "a meta do mês"} pede {Math.round(m.derived)} · usar esse
                            </button>
                          )}
                        </span>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          {m.unit === "R$" && <span className="mono dim" style={{ fontSize: 12 }}>R$</span>}
                          <input type="number" min="0" step={m.unit === "%" ? "1" : "0.01"} inputMode="decimal"
                            value={roleVals[rk(r.role, m.metric)] ?? ""}
                            onChange={(e) => setRole(r.role, m.metric, e.target.value)}
                            placeholder={m.derived != null ? `${Math.round(m.derived)} pela meta` : m.default != null ? `padrão ${m.default}` : "—"}
                            title={m.derived != null ? `vazio = segue a meta do mês (${Math.round(m.derived)})` : undefined}
                            className="tnum" style={{ ...inp, width: m.unit === "R$" ? 90 : 76, textAlign: "right" }} />
                          <span className="mono dim" style={{ fontSize: 12, width: 26 }}>{m.unit === "%" ? "%" : ""}</span>
                        </div>
                      </label>
                    ))}
                    {/* Contratos e receita de SDR/closer NÃO são campo de vaga:
                        a meta é POR PESSOA, pelo nível dela no plano de
                        Remuneração (o placar aplica o plano por cima de vaga e
                        derivado). A régua aparece por pessoa; edita na tela
                        Remuneração, e o ajuste por pessoa abaixo ainda vence. */}
                    {r.metrics.some((m) => m.compPlan) && (
                      <div title="Contratos e receita são meta POR PESSOA, pelo nível dela (1 jr · 2 pl · 3 sn) no plano de Remuneração: vencem a meta de vaga e a derivada do pace. Edita na tela Remuneração; só o ajuste por pessoa, no card mais abaixo, passa na frente."
                        style={{ marginTop: 12, background: "var(--bg-inset)", border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", padding: "10px 12px", cursor: "help" }}>
                        <div style={{ fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--accent)", fontWeight: 600, marginBottom: 7 }}>
                          Contratos e receita · plano de Remuneração <span className="dim" style={{ letterSpacing: 0 }}>ⓘ</span>
                        </div>
                        {(data.users || []).filter((u) => u.roles.includes(r.role)).map((u) => {
                          const lv = (data.compPlan?.[r.role] || []).find((l) => l.n === u.compLevel) || {};
                          return (
                            <div key={u.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "3px 0", fontSize: 12.5 }}>
                              <Avatar id={u.id} name={u.name} size={20} />
                              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.name} <span className="dim" style={{ fontSize: 11 }}>nível {u.compLevel}</span></span>
                              <span className="tnum" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{int(lv.metaContracts || 0)} contratos · {money(lv.metaRevenue || 0)}</span>
                            </div>
                          );
                        })}
                        {!(data.users || []).some((u) => u.roles.includes(r.role)) && (data.compPlan?.[r.role] || []).map((l) => (
                          <div key={l.n} style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "3px 0", fontSize: 12.5 }}>
                            <span style={{ flex: 1 }} className="dim">nível {l.n}</span>
                            <span className="tnum" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{int(l.metaContracts || 0)} contratos · {money(l.metaRevenue || 0)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>

            {/* 4 · Ajuste por pessoa (override) */}
            <Card title="Ajuste por pessoa" hint="opcional · vence a meta da vaga e o plano de remuneração, pra dar um alvo diferente a alguém">
              <div style={{ padding: "12px var(--inset-x) 18px", display: "flex", flexDirection: "column", gap: 10 }}>
                {overrides.length === 0 && <div className="dim" style={{ fontSize: 12.5 }}>nenhum ajuste · todo mundo segue a meta da vaga</div>}
                {overrides.map((o, i) => {
                  const info = metricInfo[o.metric] || {};
                  return (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <select value={o.key} onChange={(e) => setOv(i, "key", e.target.value)} style={{ ...inp, minWidth: 140 }}>
                        {(data.users || []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                        {!data.users?.some((u) => u.id === o.key) && o.key && <option value={o.key}>{nameOf(o.key)}</option>}
                      </select>
                      <select value={o.metric} onChange={(e) => setOv(i, "metric", e.target.value)} style={{ ...inp, minWidth: 180, flex: 1 }}>
                        {allMetrics.map(([mk, mi]) => <option key={mk} value={mk}>{mi.label}</option>)}
                      </select>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        {info.unit === "R$" && <span className="mono dim" style={{ fontSize: 11 }}>R$</span>}
                        <input type="number" min="0" step={info.unit === "%" ? "1" : "0.01"} value={o.target}
                          onChange={(e) => setOv(i, "target", e.target.value)} placeholder="meta"
                          className="tnum" style={{ ...inp, width: 78, textAlign: "right" }} />
                        {info.unit === "%" && <span className="mono dim" style={{ fontSize: 11 }}>%</span>}
                      </div>
                      <button onClick={() => rmOv(i)} title="Remover ajuste" style={{ color: "var(--accent)", fontSize: 12.5, fontWeight: 600, padding: "0 4px" }}>remover</button>
                    </div>
                  );
                })}
                {data.users?.length > 0 && (
                  <button onClick={addOverride} style={{ alignSelf: "flex-start", height: 32, padding: "0 13px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", boxShadow: "var(--shadow-1)", color: "var(--fg-2)", fontSize: 12.5, fontWeight: 600 }}>
                    + ajuste por pessoa
                  </button>
                )}
              </div>
            </Card>

            {/* 5 · Agenda de metas: planejamento (mexe pouco), por isso no fim.
                Ordem de quem vale num mês: digitado > regra de crescimento >
                meta padrão. Configurar setembro hoje faz a plataforma inteira
                virar de meta sozinha no dia 1º. */}
            <Card title="Agenda de metas"
              hint={<>
                na virada do mês, o valor novo assume sozinho
                {infoDot("Ordem de quem vale num mês: valor digitado vence; sem digitado, a regra de crescimento (composta por cima do último mês agendado); sem regra, a meta padrão. Configurar os meses seguintes hoje faz a plataforma virar de meta no dia 1º sem ninguém mexer.")}
              </>}
              action={
                <label title="Regra de crescimento: mês sem valor próprio cresce essa porcentagem composta por cima do último mês agendado, pra sempre (com 50%, a escada 180 mil → 270 mil → 405 mil segue sozinha). Digitar um mês vence a regra; sem regra, mês em branco cai na meta padrão."
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "var(--fg-2)", cursor: "help" }}>
                  crescimento
                  <input type="number" min="0" step="1" inputMode="decimal" value={growth}
                    onChange={(e) => setGrowth(e.target.value)} placeholder="ex.: 50"
                    className="tnum" style={{ ...inp, height: 32, width: 68, textAlign: "right" }} />
                  <span className="mono dim" style={{ fontSize: 12 }}>% ao mês</span>
                </label>
              }>
              <div style={{ padding: "14px var(--inset-x) 18px" }}>
                {proximosMeses.length > 0 && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 190px), 1fr))", gap: 10 }}>
                    {proximosMeses.map((m) => (
                      <label key={m.month} style={{ display: "flex", alignItems: "center", gap: 8 }}
                        title={(meses[m.month] ?? "") === "" ? `sem valor próprio: ${m.source === "growth" ? "segue a regra de crescimento" : "segue a meta padrão"} (${money(m.effective)})` : undefined}>
                        <span style={{ flex: 1, fontSize: 13, color: "var(--fg-2)" }}>
                          {mesLabel(m.month)}
                          {(meses[m.month] ?? "") === "" && m.source === "growth" && <span className="dim" style={{ display: "block", fontSize: 10.5 }}>pela regra</span>}
                        </span>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <span className="mono dim" style={{ fontSize: 12 }}>R$</span>
                          <input type="number" min="0" step="1" inputMode="decimal"
                            value={meses[m.month] ?? ""}
                            onChange={(e) => setMeses((p) => ({ ...p, [m.month]: e.target.value }))}
                            placeholder={String(m.effective)}
                            className="tnum" style={{ ...inp, width: 110, textAlign: "right" }} />
                        </div>
                      </label>
                    ))}
                  </div>
                )}
                {/* A antiga "Meta de venda do mês": na real ela é o FALLBACK de
                    mês sem valor agendado e sem regra, então vive aqui com o
                    nome certo, fora do caminho de quem só quer a meta de agora. */}
                <label title="Vale pra mês sem valor próprio e sem regra de crescimento."
                  style={{ display: "flex", alignItems: "center", gap: 10, maxWidth: 440, marginTop: proximosMeses.length ? 14 : 0, borderTop: proximosMeses.length ? "1px solid var(--line-faint)" : "none", paddingTop: proximosMeses.length ? 12 : 0, cursor: "help" }}>
                  <span style={{ flex: 1, fontSize: 12.5, color: "var(--fg-3)" }}>
                    Meta padrão
                    <span className="dim" style={{ display: "block", fontSize: 11 }}>mês sem valor e sem regra cai aqui</span>
                  </span>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <span className="mono dim" style={{ fontSize: 12 }}>R$</span>
                    <input type="number" min="0" step="1" inputMode="decimal" value={cash}
                      onChange={(e) => setCash(e.target.value)}
                      placeholder={`padrão do sistema ${data.company?.cashTargetDefault ?? 120000}`}
                      className="tnum" style={{ ...inp, width: 130, textAlign: "right" }} />
                  </div>
                </label>
              </div>
            </Card>

            <div className="dim" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
              campo vazio segue a meta do mês pela cadeia; sem cadeia, vale o benchmark padrão. As metas alimentam o placar de Desempenho do time e todo campo que compara com meta.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export { MetasScreen };
