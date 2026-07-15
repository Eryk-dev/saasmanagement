import React from "react";
import { PageHead, Card, Pill, StatTile } from "../components/viz.jsx";
import { EmptyState } from "../atoms.jsx";
import { api } from "../lib/api.js";
import { useActiveSaas } from "../lib/workspace.js";
import { displayName } from "../lib/users.js";
import { PersonFilter } from "./calls.jsx";

// Análise de integração (CS/onboarding) — agrega os resumos das calls de
// integração do produto: sentimento do cliente (com "em risco" pra pegar churn
// cedo), pendências recorrentes do onboarding e as integrações recentes.
const { useState: useS, useEffect: useE } = React;
const SENT_TONE = { satisfeito: "pos", neutro: "warn", "em risco": "neg" };

function Bar({ label, value, max, sub, tone }) {
  const pct = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5 }}>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <span className="mono" style={{ flexShrink: 0, color: "var(--fg-3)", fontSize: 11 }}>{sub}</span>
      </div>
      <div style={{ height: 7, borderRadius: 4, background: "var(--bg-inset)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: tone || "var(--accent)" }} />
      </div>
    </div>
  );
}

function IntegrationsScreen({ onOpenLead }) {
  const [product] = useActiveSaas();
  const [data, setData] = useS(null);
  const [err, setErr] = useS(null);
  const [integrator, setIntegrator] = useS(undefined); // undefined = todos os integradores
  const [integradores, setIntegradores] = useS([]); // lista persistente pro seletor

  // Troca de produto zera o filtro de integrador.
  useE(() => { setIntegrator(undefined); setIntegradores([]); }, [product?.id]);

  useE(() => {
    if (!product?.id) return;
    let alive = true;
    setData(null); setErr(null);
    api.integrationAnalysis(product.id, integrator).then((d) => {
      if (!alive) return;
      setData(d);
      if (Array.isArray(d.integradores)) setIntegradores(d.integradores);
    }).catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [product?.id, integrator]);

  function openRecent(leadId) {
    const full = (window.SEED?.LEADS || []).find((l) => l.id === leadId);
    if (full && onOpenLead) onOpenLead(full);
  }

  const sent = data?.sentimento || { satisfeito: 0, neutro: 0, "em risco": 0 };
  const maxPend = data?.pendencias?.[0]?.total || 1;
  const maxConf = data?.configurado?.[0]?.total || 1;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <PageHead title="Análise de integração"
        sub={(data ? `${data.count} ${data.count === 1 ? "integração resumida" : "integrações resumidas"}` : "onboarding resumido por IA") + (integrator != null ? ` · ${integrator ? displayName(integrator) : "sem integrador"}` : "")} />

      <div style={{ flex: 1, overflow: "auto", padding: "14px var(--pad-x)", display: "flex", flexDirection: "column", gap: 14 }}>
        {integradores.length >= 2 ? (
          <PersonFilter people={integradores} value={integrator} onChange={setIntegrator} />
        ) : integradores.length === 1 && data?.count > 0 ? (
          <div className="mono dim" style={{ fontSize: 11 }}>
            separado por integrador · {integradores[0].id ? `todas as integrações são de ${displayName(integradores[0].id)}` : "nenhuma integração tem integrador atribuído ainda"}
          </div>
        ) : null}
        {err && <div className="mono" style={{ color: "var(--neg)" }}>{err}</div>}
        {!data && !err && <div className="mono dim">carregando…</div>}

        {data && data.count === 0 && (
          <EmptyState title="Nenhuma integração resumida ainda"
            hint="As calls de integração agendadas pelo cockpit viram resumo de onboarding quando o Meet gera a transcrição. Conforme elas acontecem, o sentimento dos clientes e as pendências recorrentes aparecem aqui." />
        )}

        {data && data.count > 0 && (
          <>
            {data.count < 5 && (
              <div style={{ border: "1px solid var(--warn-line, var(--line-2))", background: "var(--warn-soft)", borderRadius: "var(--r-2)", padding: "10px 12px", fontSize: 12.5, color: "var(--fg-2)" }}>
                Ainda juntando integrações ({data.count}). Os padrões ficam confiáveis a partir de umas 10, mas já dá pra olhar.
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
              <StatTile label="Integrações" value={String(data.count)} />
              <StatTile label="Satisfeitos" value={String(sent.satisfeito)} tone="pos" />
              <StatTile label="Neutros" value={String(sent.neutro)} tone="flat" />
              <StatTile label="Em risco" value={String(sent["em risco"])} tone={sent["em risco"] > 0 ? "neg" : "flat"} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
              <Card title="Pendências recorrentes do onboarding" hint="o que mais trava a integração (× vezes · quem resolve)">
                <div style={{ display: "flex", flexDirection: "column", gap: 11, padding: "12px 16px 14px" }}>
                  {data.pendencias.length === 0 && <div className="mono dim" style={{ fontSize: 12 }}>nenhuma pendência registrada ainda</div>}
                  {data.pendencias.slice(0, 12).map((p, i) => (
                    <Bar key={i} label={p.item} value={p.total} max={maxPend}
                      tone={p.cliente >= p.equipe ? "var(--warn)" : "var(--accent)"}
                      sub={`${p.total}×${p.cliente ? ` · ${p.cliente} cliente` : ""}${p.equipe ? ` · ${p.equipe} equipe` : ""}`} />
                  ))}
                </div>
              </Card>
              <Card title="O que mais é configurado" hint="o que a integração mais entrega/ensina">
                <div style={{ display: "flex", flexDirection: "column", gap: 11, padding: "12px 16px 14px" }}>
                  {data.configurado.length === 0 && <div className="mono dim" style={{ fontSize: 12 }}>nada registrado ainda</div>}
                  {data.configurado.slice(0, 12).map((c, i) => (
                    <Bar key={i} label={c.item} value={c.total} max={maxConf} sub={`${c.total}×`} />
                  ))}
                </div>
              </Card>
            </div>

            <Card title="Integrações recentes" hint="últimas integrações resumidas · clique pra abrir o lead">
              <div>
                {data.recent.map((c, i) => (
                  <div key={i} onClick={() => openRecent(c.leadId)}
                    style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "9px 16px", borderTop: i ? "1px solid var(--line-1)" : "none", cursor: "pointer" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hover)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                    <span style={{ fontSize: 13, fontWeight: 600, flexShrink: 0, minWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.leadName || c.company || "cliente"}</span>
                    <Pill tone={SENT_TONE[c.sentimento] || "mut"}>{c.sentimento || "—"}</Pill>
                    {integrator == null && c.integrator && <Pill tone="mut">{displayName(c.integrator)}</Pill>}
                    <span className="dim" style={{ fontSize: 12, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.resumo}</span>
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

export { IntegrationsScreen };
