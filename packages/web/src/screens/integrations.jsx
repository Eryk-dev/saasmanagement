import React from "react";
import { PageHead, Card, Pill } from "../components/viz.jsx";
import { EmptyState } from "../atoms.jsx";
import { AvisoTopo } from "../components/story.jsx";
import { api } from "../lib/api.js";
import { useActiveSaas } from "../lib/workspace.js";

// Análise de integração (CS/onboarding) — agrega os resumos das calls de
// integração do produto: sentimento do cliente (com "em risco" pra pegar churn
// cedo), pendências recorrentes do onboarding e as integrações recentes.
const { useState: useS, useEffect: useE } = React;
const SENT_TONE = { satisfeito: "pos", neutro: "warn", "em risco": "neg" };

function Bar({ label, value, max, sub, tone }) {
  const pct = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <span className="tnum" style={{ flexShrink: 0, color: "var(--fg-3)", fontSize: 12 }}>{sub}</span>
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

  useE(() => {
    if (!product?.id) return;
    let alive = true;
    setData(null); setErr(null);
    api.integrationAnalysis(product.id).then((d) => {
      if (!alive) return;
      setData(d);
    }).catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [product?.id]);

  function openRecent(leadId) {
    const full = (window.SEED?.LEADS || []).find((l) => l.id === leadId);
    if (full && onOpenLead) onOpenLead(full);
  }

  const sent = data?.sentimento || { satisfeito: 0, neutro: 0, "em risco": 0 };
  const maxPend = data?.pendencias?.[0]?.total || 1;
  const maxConf = data?.configurado?.[0]?.total || 1;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <PageHead title="Análise de Integração"
        sub={(data ? `${data.count} ${data.count === 1 ? "integração resumida" : "integrações resumidas"}` : "integrações resumidas") + " · sentimento dos clientes e pendências do onboarding"} />

      <div style={{ flex: 1, overflow: "auto", padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16 }}>
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

            {/* "EM RISCO" era o quarto tile de quatro iguais (13/09). É o
                motivo de abrir esta tela: sobe pro topo, com NOME e ação — o
                churn começa no onboarding e o CS tem poucos dias pra reverter. */}
            {(() => {
              const risco = (data.recent || []).filter((c) => c.sentimento === "em risco");
              if (!sent["em risco"]) return null;
              const nomes = risco.slice(0, 3).map((c) => c.leadName || c.company || "cliente").join(" · ");
              return (
                <AvisoTopo navy
                  titulo={`${sent["em risco"]} ${sent["em risco"] === 1 ? "cliente saiu da integração em risco" : "clientes saíram da integração em risco"}`}
                  nota={risco.length > 0 ? `${nomes}${risco.length > 3 ? ` +${risco.length - 3}` : ""}` : null}
                  fim={<span className="mono dim" style={{ fontSize: 11 }}>churn começa aqui</span>}
                  acao={risco[0]?.leadId ? {
                    label: risco.length === 1 ? "abrir o cliente" : `abrir o primeiro dos ${risco.length}`,
                    onClick: () => openRecent(risco[0].leadId),
                  } : null}
                />
              );
            })()}

            {/* ATRASOS, separados por quem deve. Estar esperando o cliente não é
                estar devendo: sem essa divisão o time lê a integração parada
                como falha nossa e trabalha a fila errada. */}
            {(data.atrasos?.cliente > 0 || data.atrasos?.nosso > 0) && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "11px 16px", borderRadius: "var(--r-3)", border: "1px solid var(--line-1)", background: "var(--bg-inset)" }}>
                <span style={{ fontSize: 13.5, fontWeight: 650 }}>
                  Atrasos: {data.atrasos.cliente} do cliente · {data.atrasos.nosso} {data.atrasos.nosso === 1 ? "nosso" : "nossos"}
                </span>
                <span style={{ fontSize: 12.5, color: "var(--fg-3)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {(data.atrasos.itens || []).slice(0, 3).map((i) => `${i.leadName || "cliente"} (${i.dias}d)`).join(" · ")}
                </span>
                {data.atrasos.itens?.[0]?.leadId && (
                  <button onClick={() => openRecent(data.atrasos.itens[0].leadId)}
                    style={{ marginLeft: "auto", height: 30, padding: "0 14px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                    abrir o mais antigo
                  </button>
                )}
              </div>
            )}

            {/* Como saíram: proporção, não quatro números soltos. */}
            <section style={{ border: 0, borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)", padding: "16px var(--inset-x)" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                <h3 className="card-title" style={{ margin: 0 }}>Como saíram da integração</h3>
                <span className="card-sub">{`${data.count} ${data.count === 1 ? "integração resumida" : "integrações resumidas"}`}</span>
              </div>
              <div style={{ display: "flex", height: 12, borderRadius: 999, overflow: "hidden", background: "var(--bg-2)" }}>
                {[["satisfeito", sent.satisfeito, "var(--pos)"], ["neutro", sent.neutro, "var(--fg-4)"], ["em risco", sent["em risco"], "var(--neg)"]].map(([k, n, cor]) => (
                  n > 0 ? <div key={k} title={`${n} ${k}`} style={{ width: `${(n / Math.max(1, data.count)) * 100}%`, background: cor }} /> : null
                ))}
              </div>
              <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 10 }}>
                {[["satisfeitos", sent.satisfeito, "var(--pos)"], ["neutros", sent.neutro, "var(--fg-4)"], ["em risco", sent["em risco"], "var(--neg)"]].map(([rot, n, cor]) => (
                  <span key={rot} style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: cor, alignSelf: "center" }} />
                    <span className="tnum" style={{ fontSize: 15, fontWeight: 700 }}>{n}</span>
                    <span style={{ fontSize: 12, color: "var(--fg-4)" }}>{rot}</span>
                  </span>
                ))}
              </div>
            </section>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 16 }}>
              <Card title="Pendências recorrentes do onboarding" hint="× vezes · quem resolve">
                <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "16px 24px 22px" }}>
                  {data.pendencias.length === 0 && <div className="mono dim" style={{ fontSize: 12 }}>nenhuma pendência registrada ainda</div>}
                  {data.pendencias.slice(0, 12).map((p, i) => (
                    <Bar key={i} label={p.item} value={p.total} max={maxPend}
                      tone={p.cliente >= p.equipe ? "var(--warn)" : "var(--accent)"}
                      sub={`${p.total}×${p.cliente ? ` · ${p.cliente} cliente` : ""}${p.equipe ? ` · ${p.equipe} equipe` : ""}`} />
                  ))}
                </div>
              </Card>
              <Card title="O que mais é configurado" hint="o que a integração mais entrega">
                <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "16px 24px 22px" }}>
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
                    style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 24px", borderTop: "1px solid var(--line-faint)", cursor: "pointer" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hover)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, flexShrink: 0, width: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.leadName || c.company || "cliente"}</span>
                    <Pill tone={SENT_TONE[c.sentimento] || "mut"}>{c.sentimento || "—"}</Pill>
                    <span className="dim" style={{ fontSize: 12.5, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.resumo}</span>
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
