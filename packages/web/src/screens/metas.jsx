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
                        <span style={{ flex: 1, fontSize: 13.5, color: "var(--fg-2)" }}>{m.label}</span>
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
