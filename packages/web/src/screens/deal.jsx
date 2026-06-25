import React from "react";
import { Avatar, RowActions } from "../atoms.jsx";
import { BigNumber } from "../charts.jsx";
import { ProposalActions } from "../components/ProposalActions.jsx";
import { leadScoreLabel, leadAge, chromeBtnStyleSmall, waLink } from "../lib/ui.js";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
// Lead detail drawer — slides over the pipeline when a card is opened.
// (Funil unificado: o card do pipeline é um lead, então o detalhe é do lead.)

// Usuário logado do time (mesmo slot do kanban de tarefas) — vira o autor do comentário.
function currentUser() {
  try { return JSON.parse(localStorage.getItem("cockpit_user") || "null"); } catch { return null; }
}

function LeadDetail({ lead, onClose }) {
  const { openForm, openDelete } = useData();
  const [comments, setComments] = React.useState(lead?.comments || []);
  const [newComment, setNewComment] = React.useState("");
  React.useEffect(() => { setComments(lead?.comments || []); setNewComment(""); }, [lead?.id]);
  if (!lead) return null;
  const wa = waLink(lead.phone);

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
    }} onClick={onClose}>
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
              onEdit={() => { onClose(); openForm("leads", lead); }}
              onDelete={() => { onClose(); openDelete("leads", lead); }}
            />
            <button onClick={onClose} className="mono dim" style={{ fontSize: 16 }}>✕</button>
          </div>
        </div>

        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line-1)", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <BigNumber value={window.fmt.money(lead.amount || 0)} label="Valor" size={28} />
          <BigNumber value={leadAge(lead)} label="Idade" size={28} />
          <BigNumber value={icpPct || (hasScore ? String(score) : "—")} label={icpPct ? "ICP" : "Score"} size={28} />
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
          <button onClick={() => { onClose(); openForm("leads", lead); }} style={{ flex: 1, padding: "9px 12px", background: "var(--accent)", color: "var(--accent-fg)", borderRadius: "var(--r-2)", fontSize: 13, fontWeight: 500 }}>Editar lead</button>
          <button style={{ padding: "9px 12px", background: "var(--bg-2)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", fontSize: 13 }}>⋯</button>
        </div>
      </div>
    </div>
  );
}

export { LeadDetail };
