import React from "react";
import { PageHead } from "../components/viz.jsx";
import { api } from "../lib/api.js";
import { useActiveSaas } from "../lib/workspace.js";

// Metas — edita TODAS as metas de desempenho do produto por VAGA (SDR / closer
// / integrador) e, opcionalmente, por PESSOA. Escreve na collection `goals`, a
// mesma que o scoreboard e a Visão geral leem, então vale em todo campo que
// mostra meta. Campo vazio = usa o benchmark padrão.

const { useState: useS, useEffect: useE } = React;

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

// A cadeia da meta, passo a passo, com quantos cabem a cada pessoa da vaga.
function chainRows(d, people = {}) {
  const share = (total, role) => {
    const n = people?.[role] || 0;
    return n > 1 ? `${int(total / n)} por pessoa · ${n} na vaga` : null;
  };
  return [
    { label: "Meta de venda do mês", value: money(d.target) },
    { label: "Ticket médio", note: TICKET_SOURCE[d.ticketSource] || "", value: `÷ ${money(d.ticket)}` },
    { label: "Ganhos no mês", note: share(d.won, "closer"), value: int(d.won) },
    { label: "Conversão da call", note: RATE_SOURCE[d.rates.closeRateSource] || "", value: `÷ ${pct(d.rates.closeRate)}` },
    { label: "Calls realizadas no mês", value: int(d.callsShown) },
    { label: "Comparecimento", note: RATE_SOURCE[d.rates.showRateSource] || "", value: `÷ ${pct(d.rates.showRate)}` },
    { label: "Calls agendadas no mês", note: share(d.callsBooked, "sdr"), value: int(d.callsBooked) },
    { label: "Taxa de agendamento", note: RATE_SOURCE[d.rates.bookingRateSource] || "", value: `÷ ${pct(d.rates.bookingRate)}` },
    { label: "Contatos no mês", note: share(d.contacts, "sdr"), value: int(d.contacts) },
    { label: "Taxa de contato", note: RATE_SOURCE[d.rates.contactRateSource] || "", value: `÷ ${pct(d.rates.contactRate)}` },
    { label: "Leads no mês", note: "entrada do funil: quem entrega é o marketing, então não vira meta de vaga", value: int(d.leads) },
  ];
}

function MetasScreen() {
  const [product] = useActiveSaas();
  const [data, setData] = useS(null);
  const [roleVals, setRoleVals] = useS({});     // "role:metric" -> string
  const [overrides, setOverrides] = useS([]);   // [{ key, metric, target }]
  const [cash, setCash] = useS("");             // meta de venda do mês (caixa, R$) — product.monthlyCashTarget
  const [orig, setOrig] = useS(null);           // { roleVals, overrides, cash } snapshot
  const [err, setErr] = useS(null);
  const [saving, setSaving] = useS(false);
  const [note, setNote] = useS(null);

  // Snapshot vindo da API → estados dos campos + baseline do dirty.
  const applyData = (d) => {
    const rv = {};
    for (const r of d.roles) for (const m of r.metrics) rv[rk(r.role, m.metric)] = m.target != null ? String(m.target) : "";
    const ov = (d.userGoals || []).map((g) => ({ key: g.key, metric: g.metric, target: String(g.target) }));
    const ct = d.company?.cashTarget != null ? String(d.company.cashTarget) : "";
    setData(d); setRoleVals(rv); setOverrides(ov); setCash(ct);
    setOrig({ roleVals: JSON.stringify(rv), overrides: JSON.stringify(ov), cash: ct });
  };

  useE(() => {
    if (!product?.id) return;
    let alive = true;
    setData(null); setErr(null); setNote(null);
    api.metas(product.id).then((d) => alive && applyData(d)).catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [product?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = orig && (JSON.stringify(roleVals) !== orig.roleVals || JSON.stringify(overrides) !== orig.overrides || cash !== orig.cash);

  // Mapa metric -> { label, unit } (pros rótulos dos overrides).
  const metricInfo = {};
  for (const r of data?.roles || []) for (const m of r.metrics) metricInfo[m.metric] = { label: m.label, unit: m.unit, role: r.role };
  const allMetrics = Object.entries(metricInfo);

  function setRole(role, metric, v) { setRoleVals((p) => ({ ...p, [rk(role, metric)]: v })); }

  // Preenche os campos de VOLUME com o desdobramento da meta do mês (não salva:
  // o Leo confere e clica em salvar). As taxas ficam como estão — são a ambição
  // que ALIMENTA a cadeia, não resultado dela.
  function applyDerived() {
    const list = data?.derived?.goals || [];
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
      // metas por vaga: manda tudo (vazio = servidor apaga → volta pro padrão)
      for (const r of data.roles) for (const m of r.metrics) {
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
      await api.saveMetas(product.id, goals, { cashTarget: cash });
      applyData(await api.metas(product.id));
      setNote({ ok: true, text: "metas salvas · valem em todo campo que mostra meta" });
    } catch (e) {
      setNote({ ok: false, text: e.message });
    }
    setSaving(false);
  }
  function reset() {
    if (!orig) return;
    setRoleVals(JSON.parse(orig.roleVals)); setOverrides(JSON.parse(orig.overrides)); setCash(orig.cash);
  }

  const kicker = { fontSize: 11, fontWeight: 600, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase" };
  const inp = { height: 38, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 13 };
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
            {/* Meta da empresa: a venda do mês que a Visão geral e a Análise perseguem */}
            <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)", padding: 24 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 15.5, fontWeight: 600, letterSpacing: "-.01em" }}>Empresa</span>
                <span className="dim" style={{ fontSize: 12 }}>a meta que o negócio persegue no mês</span>
              </div>
              <div className="dim" style={{ fontSize: 12.5, marginBottom: 14 }}>
                a faixa "Meta do mês" da Visão geral e a Análise de Pace seguem essa meta pelo VENDIDO no mês (contrato cheio; cartão em 12x conta inteiro) e desdobram o que falta em ganhos, calls, contatos e leads por dia. O caixa e o dinheiro futuro ficam na aba Clientes.
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 10, maxWidth: 440 }}>
                <span style={{ flex: 1, fontSize: 13.5, color: "var(--fg-2)" }}>Meta de venda do mês</span>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span className="mono dim" style={{ fontSize: 12 }}>R$</span>
                  <input type="number" min="0" step="1" inputMode="decimal" value={cash}
                    onChange={(e) => setCash(e.target.value)}
                    placeholder={`padrão ${data.company?.cashTargetDefault ?? 120000}`}
                    className="tnum" style={{ ...inp, width: 130, textAlign: "right" }} />
                </div>
              </label>
            </div>

            {/* Pace: o que a meta do mês exige, pela mesma cadeia da Análise */}
            {data.derived && (
              <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)", padding: 24 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 15.5, fontWeight: 600, letterSpacing: "-.01em" }}>Pace</span>
                  <span className="dim" style={{ fontSize: 12 }}>o que a meta do mês exige de cada etapa</span>
                  {!data.derived.blockedBy && (
                    <button onClick={applyDerived} style={{ marginLeft: "auto", height: 32, padding: "0 13px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", boxShadow: "var(--shadow-1)", color: "var(--fg-2)", fontSize: 12.5, fontWeight: 600 }}>
                      derivar metas do pace
                    </button>
                  )}
                </div>
                <div className="dim" style={{ fontSize: 12.5, marginBottom: 16 }}>
                  a meta de venda desce pela MESMA cadeia e pelas mesmas taxas da Análise de Pace, então os dois lugares contam a mesma história. O botão preenche só os VOLUMES (ganhos, receita, calls, contatos); as taxas continuam suas, porque são a ambição que move a cadeia, não o retrato dela.
                </div>
                {data.derived.blockedBy ? (
                  <div className="mono" style={{ fontSize: 12.5, color: "var(--warn)" }}>{blockedText(data.derived.blockedBy)}</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                    {chainRows(data.derived, data.people).map((row, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "9px 0", borderTop: i ? "1px solid var(--line-1)" : "none" }}>
                        <span style={{ flex: 1, fontSize: 13.5, color: "var(--fg-2)" }}>
                          {row.label}
                          {row.note && <span className="dim" style={{ fontSize: 11.5, marginLeft: 8 }}>{row.note}</span>}
                        </span>
                        <span className="tnum" style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap" }}>{row.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Metas por vaga */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 14 }}>
              {data.roles.map((r) => (
                <div key={r.role} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)", padding: 24 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 16 }}>
                    <span style={{ fontSize: 15.5, fontWeight: 600, letterSpacing: "-.01em" }}>{r.label}</span>
                    <span className="dim" style={{ fontSize: 12 }}>{r.hint}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {r.metrics.map((m) => (
                      <label key={m.metric} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ flex: 1, fontSize: 13.5, color: "var(--fg-2)", minWidth: 0 }}>
                          {m.label}
                          {/* Meta de volume é do TIME: mostra a parte de cada um,
                              que é o que o placar vai cobrar da pessoa. */}
                          {shareHint(m, r.role) && <span className="dim" style={{ display: "block", fontSize: 11.5 }}>{shareHint(m, r.role)}</span>}
                        </span>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          {m.unit === "R$" && <span className="mono dim" style={{ fontSize: 12 }}>R$</span>}
                          <input type="number" min="0" step={m.unit === "%" ? "1" : "0.01"} inputMode="decimal"
                            value={roleVals[rk(r.role, m.metric)] ?? ""}
                            onChange={(e) => setRole(r.role, m.metric, e.target.value)}
                            placeholder={m.default != null ? `padrão ${m.default}` : "—"}
                            className="tnum" style={{ ...inp, width: m.unit === "R$" ? 90 : 76, textAlign: "right" }} />
                          <span className="mono dim" style={{ fontSize: 12, width: 26 }}>{m.unit === "%" ? "%" : ""}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Ajuste por pessoa (override) */}
            <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)", padding: 24 }}>
              <div style={kicker}>Ajuste por pessoa (opcional)</div>
              <div className="dim" style={{ fontSize: 12.5, margin: "8px 0 14px" }}>uma meta por pessoa vence a meta da vaga dela — pra dar um alvo diferente a alguém específico.</div>
              {overrides.length === 0 && <div className="dim" style={{ fontSize: 12.5, marginBottom: 10 }}>nenhum ajuste · todo mundo segue a meta da vaga</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
              </div>
              {data.users?.length > 0 && (
                <button onClick={addOverride} style={{ marginTop: 14, height: 32, padding: "0 13px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", boxShadow: "var(--shadow-1)", color: "var(--fg-2)", fontSize: 12.5, fontWeight: 600 }}>
                  + ajuste por pessoa
                </button>
              )}
            </div>

            <div className="dim" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
              campo vazio usa o benchmark padrão. As metas alimentam o placar de Desempenho do time e todo campo que compara com meta.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export { MetasScreen };
