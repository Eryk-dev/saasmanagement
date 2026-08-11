import React from "react";
import { PageHead, Card, Pill, StatTile, Segmented } from "../components/viz.jsx";
import { EmptyState } from "../atoms.jsx";
import { api } from "../lib/api.js";
import { useActiveSaas } from "../lib/workspace.js";
import { displayName } from "../lib/users.js";
import { DEFAULT_SCRIPTS, applyScriptOverride } from "../lib/scripts.js";

// Análise de pitch — agrega os resumos de call por IA (activity call_summary) do
// produto: objeções recorrentes, dores mais citadas e temperatura, mais as calls
// recentes. Quando tiver volume, é daqui que o time tira insight pra afinar o
// pitch (e o diagnóstico da IA aponta o que ajustar no roteiro da call).
const { useState: useS, useEffect: useE } = React;
const TEMP_TONE = { quente: "neg", morno: "warn", frio: "mut" };

// Seletor "separado por pessoa" (closer no pitch, integrador na integração):
// pílulas Todos + uma por pessoa com a contagem de calls. value undefined = Todos;
// "" = sem responsável. Só aparece quando há o que separar (2+ opções).
export function PersonFilter({ people, value, onChange, allLabel = "Todos" }) {
  const total = (people || []).reduce((s, p) => s + (p.count || 0), 0);
  const opts = [{ id: undefined, count: total, label: allLabel }].concat(
    (people || []).map((p) => ({ id: p.id, count: p.count, label: p.id ? displayName(p.id) : "sem responsável" })),
  );
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <span className="dim" style={{ fontSize: 12, marginRight: 2 }}>separado por:</span>
      {opts.map((o) => {
        const on = value === o.id;
        return (
          <button key={o.id ?? "__all__"} onClick={() => onChange(o.id)}
            style={{ height: 34, padding: "0 13px", borderRadius: "var(--r-2)", fontSize: 12.5, cursor: "pointer",
              border: "1px solid " + (on ? "var(--accent-line)" : "var(--line-2)"),
              background: on ? "var(--accent-soft)" : "var(--bg-1)",
              color: on ? "var(--accent)" : "var(--fg-3)", fontWeight: 600 }}>
            {o.label} <span className="tnum" style={{ opacity: 0.65 }}>· {o.count}</span>
          </button>
        );
      })}
    </div>
  );
}

// Barra horizontal simples (frequência relativa) — evita puxar chart pesado.
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

function CallsScreen({ onOpenLead }) {
  const [product] = useActiveSaas();
  const [data, setData] = useS(null);
  const [err, setErr] = useS(null);
  const [ai, setAi] = useS(null); // null | "loading" | { diagnostico, objecoes } | { error }
  // Call de VENDA (lead com closer) ≠ call de QUALIFICAÇÃO do SDR (lead sem
  // closer): teor diferente, análise separada. O grupo escolhido persiste.
  const [group, setGroupState] = useS(() => { try { return localStorage.getItem("cockpit_calls_group") || "venda"; } catch { return "venda"; } });
  const setGroup = (g) => { setGroupState(g); setCloser(undefined); try { localStorage.setItem("cockpit_calls_group", g); } catch { /* ignore */ } };
  const [closer, setCloser] = useS(undefined); // undefined = todos do grupo
  const [closers, setClosers] = useS([]); // lista persistente pro seletor (não some no loading)

  // Troca de produto zera o filtro de pessoa.
  useE(() => { setCloser(undefined); setClosers([]); }, [product?.id]);

  useE(() => {
    if (!product?.id) return;
    let alive = true;
    setData(null); setErr(null); setAi(null);
    api.pitchCalls(product.id, closer, group).then((d) => {
      if (!alive) return;
      setData(d);
      if (Array.isArray(d.closers)) setClosers(d.closers); // lista completa (não muda com o filtro)
    }).catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [product?.id, closer, group]);

  // Pessoas do grupo ativo (a API manda contagem por grupo+pessoa).
  const groupPeople = closers.filter((p) => (p.group || "venda") === group);

  // Diagnóstico da IA: usa o roteiro ATUAL da call (default + override do produto)
  // + o padrão das calls. Mostramos só o diagnóstico e como tratar as objeções;
  // a nova versão do roteiro se aplica em Ajustes → Scripts.
  async function diagnosticar() {
    setAi("loading");
    try {
      // Grupo decide o roteiro de referência: venda = call de fechamento;
      // qualificação = roteiro de 1º contato do SDR.
      const key = group === "sdr" ? "novo" : "call";
      const base = DEFAULT_SCRIPTS[key] || {};
      const cur = applyScriptOverride(base, product.scripts?.[key]) || base;
      const r = await api.improvePitch(product.id, {
        scriptKey: key, scriptLabel: group === "sdr" ? "1º contato (SDR)" : "Call de fechamento",
        currentScript: { resumo: cur.resumo, objetivo: cur.objetivo, passos: cur.passos },
        closer, group, // undefined = todos do grupo; senão só as calls da pessoa
      });
      setAi({ diagnostico: r.diagnostico || "", objecoes: r.objecoesRecorrentes || [] });
    } catch (e) {
      setAi({ error: e?.status === 422 ? "Ainda não há calls resumidas pra analisar." : (e?.message || "falha ao gerar") });
    }
  }

  function openRecent(leadId) {
    const full = (window.SEED?.LEADS || []).find((l) => l.id === leadId);
    if (full && onOpenLead) onOpenLead(full);
  }

  const temp = data?.temperatura || { quente: 0, morno: 0, frio: 0 };
  const maxObj = data?.objecoes?.[0]?.total || 1;
  const maxDor = data?.dores?.[0]?.total || 1;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <PageHead title="Análise de Pitches"
        sub={(data ? `${data.count} ${data.count === 1 ? "call resumida" : "calls resumidas"}` : "calls resumidas") + " por IA · objeções, dores e temperatura · " + (group === "sdr" ? "qualificação (SDR)" : "vendas (closer)") + (closer != null ? ` · ${closer ? displayName(closer) : "sem responsável"}` : "")} />

      <div style={{ flex: 1, overflow: "auto", padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          {/* Venda ≠ qualificação: a call do closer e a do SDR têm teor diferente,
              então cada grupo tem sua análise e suas pessoas. */}
          <Segmented value={group} onChange={setGroup} options={[
            { value: "venda", label: "Vendas · closer" },
            { value: "sdr", label: "Qualificação · SDR" },
          ]} />
          {groupPeople.length >= 2 && <PersonFilter people={groupPeople} value={closer} onChange={setCloser} />}
          {groupPeople.length === 1 && data?.count > 0 && (
            <span className="mono dim" style={{ fontSize: 11 }}>
              {groupPeople[0].id ? `todas as calls do grupo são de ${displayName(groupPeople[0].id)}` : "nenhuma call do grupo tem responsável"}
            </span>
          )}
        </div>
        {err && <div className="mono" style={{ color: "var(--neg)" }}>{err}</div>}
        {!data && !err && <div className="mono dim">carregando…</div>}

        {data && data.count === 0 && (
          <EmptyState title={group === "sdr" ? "Nenhuma call de qualificação resumida ainda" : "Nenhuma call de venda resumida ainda"}
            hint="As calls agendadas pelo cockpit viram resumo automático quando o Meet gera a transcrição. Conforme as calls acontecem, os padrões (objeções, dores, temperatura) aparecem aqui." />
        )}

        {data && data.count > 0 && (
          <>
            {data.count < 5 && (
              <div style={{ border: "1px solid var(--warn-line, var(--line-2))", background: "var(--warn-soft)", borderRadius: "var(--r-2)", padding: "10px 12px", fontSize: 12.5, color: "var(--fg-2)" }}>
                Ainda juntando calls ({data.count}). Os padrões ficam confiáveis a partir de umas 10 calls. Já dá pra olhar, mas leve como amostra pequena.
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
              <StatTile label="Calls" value={String(data.count)} />
              <StatTile label="Quentes" value={String(temp.quente)} tone="pos" />
              <StatTile label="Mornas" value={String(temp.morno)} tone="flat" />
              <StatTile label="Frias" value={String(temp.frio)} tone="flat" />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 16 }}>
              <Card title="Objeções recorrentes" hint="o que mais trava as calls (× vezes · em aberto)">
                <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "16px 24px 22px" }}>
                  {data.objecoes.length === 0 && <div className="mono dim" style={{ fontSize: 12 }}>nenhuma objeção registrada ainda</div>}
                  {data.objecoes.slice(0, 12).map((o, i) => (
                    <Bar key={i} label={o.objecao} value={o.total} max={maxObj}
                      tone={o.abertas > 0 ? "var(--neg)" : "var(--accent)"} sub={`${o.total}× · ${o.abertas} em aberto`} />
                  ))}
                </div>
              </Card>
              <Card title="Dores mais citadas" hint="o que os leads mais trazem">
                <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "16px 24px 22px" }}>
                  {data.dores.length === 0 && <div className="mono dim" style={{ fontSize: 12 }}>nenhuma dor registrada ainda</div>}
                  {data.dores.slice(0, 12).map((d, i) => (
                    <Bar key={i} label={d.dor} value={d.total} max={maxDor} sub={`${d.total}×`} />
                  ))}
                </div>
              </Card>
            </div>

            <Card title={group === "sdr" ? "Diagnóstico da qualificação (IA)" : "Diagnóstico do pitch (IA)"}
              hint={group === "sdr" ? "a IA lê as calls do SDR e diz o que ajustar no roteiro de 1º contato" : "a IA lê as calls e diz o que ajustar no roteiro da call"}>
              <div style={{ padding: "16px 24px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <button onClick={diagnosticar} disabled={ai === "loading" || data.aiConfigured === false}
                    title={data.aiConfigured === false ? "IA não configurada no servidor" : "Analisa as calls e aponta o que ajustar no pitch"}
                    style={{ height: 30, padding: "0 14px", borderRadius: "var(--r-2)", background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))", fontSize: 12.5, fontWeight: 600, opacity: (ai === "loading" || data.aiConfigured === false) ? 0.6 : 1 }}>
                    {ai === "loading" ? "analisando…" : "✨ gerar diagnóstico"}
                  </button>
                </div>
                {ai && ai.error && <div className="mono" style={{ fontSize: 12, color: "var(--neg)" }}>{ai.error}</div>}
                {ai && typeof ai === "object" && ai.diagnostico != null && (
                  <>
                    <div style={{ fontSize: 13, lineHeight: 1.55 }}>{ai.diagnostico}</div>
                    {ai.objecoes?.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                        {ai.objecoes.map((o, i) => (
                          <div key={i} style={{ fontSize: 12.5, lineHeight: 1.5, borderLeft: "3px solid var(--accent-line)", paddingLeft: 10 }}>
                            <b>{o.objecao}</b>{o.frequencia ? ` (${o.frequencia})` : ""}: {o.comoTratarNoPitch}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="mono dim" style={{ fontSize: 11 }}>pra aplicar a nova versão do roteiro, vá em Ajustes → Scripts → {group === "sdr" ? "1º contato" : "Call de fechamento"} → “✨ IA das calls”.</div>
                  </>
                )}
              </div>
            </Card>

            <Card title="Calls recentes" hint="últimas calls resumidas · clique pra abrir o lead">
              <div>
                {data.recent.map((c, i) => (
                  <div key={i} onClick={() => openRecent(c.leadId)}
                    style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 24px", borderTop: "1px solid var(--line-faint)", cursor: "pointer" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hover)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, flexShrink: 0, width: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.leadName || "lead"}</span>
                    {c.recordingUrl && (
                      <a
                        href={c.recordingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title="Abrir gravação da call no Drive"
                        aria-label={`Abrir gravação de ${c.leadName || "cliente"} no Drive`}
                        className="mono"
                        style={{ color: "var(--accent)", fontSize: 10.5, fontWeight: 700, flexShrink: 0, textDecoration: "none", whiteSpace: "nowrap" }}>
                        ▶ vídeo no Drive ↗
                      </a>
                    )}
                    <Pill tone={TEMP_TONE[c.temperatura] || "mut"}>{c.temperatura || "—"}</Pill>
                    {closer == null && c.closer && <Pill tone="mut">{displayName(c.closer)}</Pill>}
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

export { CallsScreen };
