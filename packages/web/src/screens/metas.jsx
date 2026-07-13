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
  const [orig, setOrig] = useS(null);           // { roleVals, overrides } snapshot
  const [err, setErr] = useS(null);
  const [saving, setSaving] = useS(false);
  const [note, setNote] = useS(null);

  useE(() => {
    if (!product?.id) return;
    let alive = true;
    setData(null); setErr(null); setNote(null);
    api.metas(product.id).then((d) => {
      if (!alive) return;
      const rv = {};
      for (const r of d.roles) for (const m of r.metrics) rv[rk(r.role, m.metric)] = m.target != null ? String(m.target) : "";
      const ov = (d.userGoals || []).map((g) => ({ key: g.key, metric: g.metric, target: String(g.target) }));
      setData(d); setRoleVals(rv); setOverrides(ov);
      setOrig({ roleVals: JSON.stringify(rv), overrides: JSON.stringify(ov) });
    }).catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [product?.id]);

  const dirty = orig && (JSON.stringify(roleVals) !== orig.roleVals || JSON.stringify(overrides) !== orig.overrides);

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
      await api.saveMetas(product.id, goals);
      const d = await api.metas(product.id);
      const rv = {};
      for (const r of d.roles) for (const m of r.metrics) rv[rk(r.role, m.metric)] = m.target != null ? String(m.target) : "";
      const ov = (d.userGoals || []).map((g) => ({ key: g.key, metric: g.metric, target: String(g.target) }));
      setData(d); setRoleVals(rv); setOverrides(ov);
      setOrig({ roleVals: JSON.stringify(rv), overrides: JSON.stringify(ov) });
      setNote({ ok: true, text: "metas salvas · valem em todo campo que mostra meta" });
    } catch (e) {
      setNote({ ok: false, text: e.message });
    }
    setSaving(false);
  }
  function reset() {
    if (!orig) return;
    setRoleVals(JSON.parse(orig.roleVals)); setOverrides(JSON.parse(orig.overrides));
  }

  const kicker = { fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase" };
  const unitLabel = { "%": "%", "R$": "R$", n: "" };
  const inp = { height: 30, padding: "0 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 13 };
  const nameOf = (id) => data?.users?.find((u) => u.id === id)?.name || id;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <PageHead title="Metas" sub="metas por vaga e por pessoa · valem em todo campo que mostra meta">
        {dirty && (
          <>
            <button onClick={reset} disabled={saving} className="mono dim" style={{ fontSize: 11.5 }}>descartar</button>
            <button onClick={save} disabled={saving}
              style={{ height: 26, padding: "0 12px", borderRadius: "var(--r-2)", background: "var(--accent)", color: "var(--accent-fg)", fontSize: 12, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
              {saving ? "salvando…" : "salvar metas"}
            </button>
          </>
        )}
      </PageHead>

      <div style={{ flex: 1, overflow: "auto", padding: "14px var(--pad-x)", display: "flex", flexDirection: "column", gap: 16 }}>
        {err && <div className="mono" style={{ fontSize: 12, color: "var(--neg)" }}>{err}</div>}
        {note && <div className="mono" style={{ fontSize: 12, color: note.ok ? "var(--pos)" : "var(--neg)" }}>{note.text}</div>}
        {!data && !err && <div className="mono dim" style={{ fontSize: 12 }}>carregando metas…</div>}

        {data && (
          <>
            {/* Metas por vaga */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
              {data.roles.map((r) => (
                <div key={r.role} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "14px 16px" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
                    <span style={{ fontFamily: "var(--display)", fontSize: 15, fontWeight: 700 }}>{r.label}</span>
                    <span className="mono dim" style={{ fontSize: 10.5 }}>{r.hint}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {r.metrics.map((m) => (
                      <label key={m.metric} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ flex: 1, fontSize: 12.5, color: "var(--fg-2)" }}>{m.label}</span>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          {m.unit === "R$" && <span className="mono dim" style={{ fontSize: 11 }}>R$</span>}
                          <input type="number" min="0" step={m.unit === "%" ? "1" : "0.01"} inputMode="decimal"
                            value={roleVals[rk(r.role, m.metric)] ?? ""}
                            onChange={(e) => setRole(r.role, m.metric, e.target.value)}
                            placeholder={m.default != null ? `padrão ${m.default}` : "—"}
                            className="tnum" style={{ ...inp, width: 78, textAlign: "right" }} />
                          {m.unit === "%" && <span className="mono dim" style={{ fontSize: 11 }}>%</span>}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Ajuste por pessoa (override) */}
            <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "14px 16px" }}>
              <div className="mono" style={{ ...kicker, marginBottom: 4 }}>Ajuste por pessoa (opcional)</div>
              <div className="mono dim" style={{ fontSize: 10.5, marginBottom: 10 }}>uma meta por pessoa VENCE a meta da vaga dela — pra dar um alvo diferente a alguém específico.</div>
              {overrides.length === 0 && <div className="mono dim" style={{ fontSize: 11.5, marginBottom: 8 }}>nenhum ajuste · todo mundo segue a meta da vaga</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
                      <button onClick={() => rmOv(i)} title="Remover ajuste" className="mono dim" style={{ fontSize: 13, padding: 2 }}>✕</button>
                    </div>
                  );
                })}
              </div>
              {data.users?.length > 0 && (
                <button onClick={addOverride} style={{ marginTop: 10, height: 28, padding: "0 12px", borderRadius: "var(--r-2)", border: "1px dashed var(--line-2)", background: "var(--bg-2)", color: "var(--fg-2)", fontSize: 12 }}>
                  ＋ ajuste por pessoa
                </button>
              )}
            </div>

            <div className="mono dim" style={{ fontSize: 10.5, lineHeight: 1.5 }}>
              campo vazio usa o benchmark padrão (mostrado no placeholder). As metas ficam salvas no produto <b style={{ color: "var(--fg-2)" }}>{product?.name}</b> e alimentam o placar de Desempenho do time e todo campo que compara com meta. A cadência de tentativas por etapa fica em Ajustes · Funil.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export { MetasScreen };
