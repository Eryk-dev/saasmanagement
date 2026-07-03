import React from "react";
import { Avatar, RowActions } from "../atoms.jsx";
import { BigNumber } from "../charts.jsx";
import { ProposalActions } from "../components/ProposalActions.jsx";
import { leadScoreLabel, leadAge, chromeBtnStyleSmall, waLink, leadTier } from "../lib/ui.js";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
// Lead detail drawer — slides over the pipeline when a card is opened.
// (Funil unificado: o card do pipeline é um lead, então o detalhe é do lead.)

// Usuário logado do time (mesmo slot do kanban de tarefas) — vira o autor do comentário.
function currentUser() {
  try { return JSON.parse(localStorage.getItem("cockpit_user") || "null"); } catch { return null; }
}

// datetime-local sem timezone (mesmo formato que o input nativo produz).
function localDT(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
}

function LeadDetail({ lead: initial, onClose }) {
  const { openForm, openDelete, refresh } = useData();
  // Cópia local: as ações rápidas (etapa, próximo contato) editam aqui e
  // persistem otimisticamente; o pipeline ressincroniza no fechar (refresh).
  const [lead, setLead] = React.useState(initial);
  const dirty = React.useRef(false);
  const [comments, setComments] = React.useState(initial?.comments || []);
  const [newComment, setNewComment] = React.useState("");
  React.useEffect(() => { setLead(initial); setComments(initial?.comments || []); setNewComment(""); }, [initial?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!lead) return null;
  const wa = waLink(lead.phone);

  function patch(p) {
    dirty.current = true;
    setLead((prev) => ({ ...prev, ...p }));
    api.update("leads", lead.id, p).catch((err) => console.warn("lead patch not persisted:", err.message));
  }
  function moveStage(stage) {
    if (!stage || stage === lead.stage) return;
    dirty.current = true;
    setLead((prev) => ({ ...prev, stage, stageSince: new Date().toISOString() }));
    api.moveLead(lead.id, stage).catch((err) => console.warn("lead move not persisted:", err.message));
  }
  function close() {
    if (dirty.current) refresh();
    onClose();
  }

  async function addComment() {
    const text = newComment.trim();
    if (!text) return;
    const me = currentUser();
    const next = [...comments, { id: `c_${Date.now().toString(36)}`, author: me?.name || "API key", text, at: new Date().toISOString() }];
    setComments(next); setNewComment("");
    // Persiste o array inteiro (mesmo padrão de tasks) — otimista; ressincroniza com a resposta.
    try { const saved = await api.update("leads", lead.id, { comments: next }); setComments(saved.comments || next); }
    catch (err) { console.warn("comment not persisted:", err.message); }
  }
  const { PEOPLE } = window.SEED;
  const owner = PEOPLE[lead.owner];
  const score = lead.score;
  const hasScore = score != null && score !== "";
  const hasIcp = lead.icp != null && lead.icp !== "";
  const icpPct = hasIcp ? `${Math.round(Number(lead.icp) * 100)}%` : null;

  // Campos REAIS do lead — mostra só os preenchidos (sem placeholder/mock).
  const fields = [
    ["Empresa", lead.company],
    ["Faixa", lead.value],
    ["Prioridade", lead.priority],
    ["Score", hasScore ? `${score} · ${leadScoreLabel(score)}` : null],
    ["ICP", icpPct],
    ["Origem", lead.source],
    ["Campanha (UTM)", lead.utm?.campaign],
    ["Origem (UTM)", [lead.utm?.source, lead.utm?.medium].filter(Boolean).join(" / ") || null],
    ["Dono", owner?.name || lead.owner],
    ["E-mail", lead.email],
    ["Telefone", lead.phone],
    ["Motivo", lead.reason],
  ].filter(([, v]) => v != null && v !== "");

  // Respostas das perguntas de qualificação do pipeline (mostra só as preenchidas,
  // convertendo valor → rótulo amigável; arrays viram lista).
  const saasCfg = (window.SEED?.SAAS || []).find((s) => s.id === lead.saas);
  const answers = (saasCfg?.leadQuestions || [])
    .map((q) => {
      let v = lead[q.key];
      if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) return null;
      const lut = Object.fromEntries((q.options || []).map((o) => [o.value, o.label]));
      v = Array.isArray(v) ? v.map((x) => lut[x] || x).join(", ") : (lut[v] || v);
      return [q.label, v];
    })
    .filter(Boolean);

  return (
    <div style={{
      position: "fixed", inset: 0, background: "oklch(0 0 0 / 0.4)",
      display: "flex", justifyContent: "flex-end", zIndex: 60,
    }} onClick={close}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 520, height: "100%", background: "var(--bg-1)",
        borderLeft: "1px solid var(--line-2)",
        display: "flex", flexDirection: "column",
        boxShadow: "var(--shadow-pop)",
      }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "start" }}>
          <div>
            <div className="mono dim" style={{ fontSize: 10, letterSpacing: "0.08em" }}>LEAD · {String(lead.id).toUpperCase()}</div>
            <div style={{ fontSize: 20, fontWeight: 500, marginTop: 4 }}>{lead.name}</div>
            {lead.company && <div className="mono dim" style={{ fontSize: 12, marginTop: 2 }}>{lead.company}</div>}
            <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(() => { const t = leadTier(lead); return t.key !== "sem" && (
                <span className="chip" title="soma de contas operadas + anúncios publicados"
                  style={{ color: t.ink, borderColor: "color-mix(in srgb, " + t.tone + " 55%, transparent)", background: "color-mix(in srgb, " + t.tone + " 14%, transparent)", fontWeight: 600 }}>
                  {t.label}
                </span>
              ); })()}
              {lead.stage && <span className="chip">{lead.stage}</span>}
              {lead.source && <span className="chip">{lead.source}</span>}
              {hasScore && <span className={"chip " + (Number(score) >= 75 ? "neg" : Number(score) >= 50 ? "warn" : "")}>{leadScoreLabel(score)}</span>}
              {lead.priority && <span className="chip">{lead.priority}</span>}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {wa && (
              <a href={wa} target="_blank" rel="noopener noreferrer" title={`WhatsApp · ${lead.phone}`}
                style={{ ...chromeBtnStyleSmall, color: "#25D366", borderColor: "#25D36655", textDecoration: "none" }}>
                <span style={{ fontSize: 11 }}>WhatsApp ↗</span>
              </a>
            )}
            <RowActions
              onEdit={() => { close(); openForm("leads", lead); }}
              onDelete={() => { close(); openDelete("leads", lead); }}
            />
            <button onClick={close} className="mono dim" style={{ fontSize: 16 }}>✕</button>
          </div>
        </div>

        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line-1)", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <BigNumber value={window.fmt.money(lead.amount || 0)} label="Valor" size={28} />
          <BigNumber value={leadAge(lead)} label="Idade" size={28} />
          {(icpPct || hasScore)
            ? <BigNumber value={icpPct || String(score)} label={icpPct ? "ICP" : "Score"} size={28} />
            : <BigNumber value={`${Math.max(0, Math.floor((Date.now() - new Date(lead.stageSince || lead.createdAt || Date.now()).getTime()) / 86400000))}d`} label="Na etapa" size={28} />}
        </div>

        {/* Ação rápida: mover etapa + próximo contato sem sair do drawer. */}
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--line-1)", display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Ação rápida</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="mono dim" style={{ fontSize: 11, width: 110, flexShrink: 0 }}>Etapa</span>
            <select value={lead.stage || ""} onChange={(e) => moveStage(e.target.value)}
              style={{ flex: 1, height: 28, padding: "0 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12.5 }}>
              {(saasCfg?.funnel || []).map((f) => <option key={f.stage} value={f.stage}>{f.stage}</option>)}
              {saasCfg?.funnel?.every((f) => f.stage !== lead.stage) && lead.stage && <option value={lead.stage}>{lead.stage}</option>}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="mono dim" style={{ fontSize: 11, width: 110, flexShrink: 0 }}>Próximo contato</span>
            <div style={{ display: "flex", gap: 5, flex: 1, flexWrap: "wrap" }}>
              {[["hoje", () => { const t = new Date(); t.setHours(t.getHours() + 1, 0, 0, 0); return t; }],
                ["amanhã 9h", () => { const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0); return t; }],
                ["em 3 dias", () => { const t = new Date(); t.setDate(t.getDate() + 3); t.setHours(9, 0, 0, 0); return t; }]].map(([label, mk]) => (
                <button key={label} onClick={() => patch({ callAt: localDT(mk()) })}
                  style={{ height: 26, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-2)", color: "var(--fg-2)", fontSize: 11.5, fontWeight: 500 }}>
                  {label}
                </button>
              ))}
              <input type="datetime-local" value={lead.callAt || ""} onChange={(e) => patch({ callAt: e.target.value })}
                style={{ height: 26, padding: "0 6px", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 11, fontFamily: "var(--mono)" }} />
              {lead.callAt && (
                <button onClick={() => patch({ callAt: "" })} className="mono dim" style={{ fontSize: 11 }} title="Limpar próximo contato">limpar</button>
              )}
            </div>
          </div>
          {lead.stage === "Negociação" && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="mono dim" style={{ fontSize: 11, width: 110, flexShrink: 0 }}>Proposta</span>
              <input type="number" placeholder="Valor (R$)" defaultValue={lead.proposalValue ?? ""}
                onBlur={(e) => patch({ proposalValue: e.target.value === "" ? "" : Number(e.target.value) })}
                style={{ width: 110, height: 26, padding: "0 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 11.5, fontFamily: "var(--mono)" }} />
              <input type="text" placeholder="Período (ex: 12 meses)" defaultValue={lead.proposalPeriod ?? ""}
                onBlur={(e) => patch({ proposalPeriod: e.target.value })}
                style={{ flex: 1, height: 26, padding: "0 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 11.5 }} />
            </div>
          )}
          {lead.stage === "Integração" && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="mono dim" style={{ fontSize: 11, width: 110, flexShrink: 0 }}>Integração</span>
              <input type="datetime-local" value={lead.integrationAt || ""} onChange={(e) => patch({ integrationAt: e.target.value })}
                style={{ height: 26, padding: "0 6px", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 11, fontFamily: "var(--mono)" }} />
            </div>
          )}
        </div>

        {fields.length > 0 && (
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--line-1)" }}>
            <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Campos</div>
            {fields.map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid var(--line-1)", fontSize: 12, gap: 16 }}>
                <span className="mono dim" style={{ flexShrink: 0 }}>{k}</span>
                <span style={{ textAlign: "right" }}>{v}</span>
              </div>
            ))}
          </div>
        )}

        {answers.length > 0 && (
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--line-1)" }}>
            <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Respostas de qualificação</div>
            {answers.map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid var(--line-1)", fontSize: 12, gap: 16 }}>
                <span className="mono dim" style={{ flexShrink: 0 }}>{k}</span>
                <span style={{ textAlign: "right" }}>{v}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--line-1)" }}>
          <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>Proposta</div>
          <ProposalActions l={lead} />
        </div>

        {/* Anotações do card — thread append-only (autor + data), mesmo padrão do kanban de tarefas. */}
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--line-1)", display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 100, overflowY: "auto" }}>
          <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>Comentários</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {comments.map((c) => (
              <div key={c.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <Avatar id={c.author} name={c.author} size={20} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                    <span style={{ fontSize: 12, fontWeight: 500 }}>{c.author}</span>
                    <span className="mono dim" style={{ fontSize: 10 }}>{c.at ? new Date(c.at).toLocaleDateString("pt-BR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}</span>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--fg-2)", whiteSpace: "pre-wrap" }}>{c.text}</div>
                </div>
              </div>
            ))}
            {comments.length === 0 && <span className="mono dim" style={{ fontSize: 11 }}>sem comentários</span>}
            <div style={{ display: "flex", gap: 6 }}>
              <input value={newComment} onChange={(e) => setNewComment(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addComment(); } }}
                placeholder="escreva uma anotação…" style={{ flex: 1, height: 30, fontSize: 13, padding: "0 10px", background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", color: "var(--fg-1)" }} />
              <button type="button" onClick={addComment} disabled={!newComment.trim()} style={{ ...chromeBtnStyleSmall, height: 30, opacity: newComment.trim() ? 1 : 0.5 }}>
                <span style={{ fontSize: 11 }}>comentar</span>
              </button>
            </div>
          </div>
        </div>

        <div style={{ marginTop: "auto", padding: "12px 20px", borderTop: "1px solid var(--line-1)", display: "flex", gap: 8, background: "var(--bg-inset)" }}>
          <button onClick={() => { close(); openForm("leads", lead); }} style={{ flex: 1, padding: "9px 12px", background: "var(--accent)", color: "var(--accent-fg)", borderRadius: "var(--r-2)", fontSize: 13, fontWeight: 500 }}>Editar lead</button>
        </div>
      </div>
    </div>
  );
}

export { LeadDetail };
