import React from "react";
import { Avatar, RowActions } from "../atoms.jsx";
import { BigNumber } from "../charts.jsx";
import { ProposalActions } from "../components/ProposalActions.jsx";
import { ActivityList, ActivityComposer } from "../components/timeline.jsx";
import { moveGate, MoveLeadModal, applyGatedMove } from "../components/stage-move.jsx";
import { leadScoreLabel, leadAge, chromeBtnStyleSmall, waLink, leadTier } from "../lib/ui.js";
import { stageKind, lossReasonLabel, nextTouchPill, workableStages } from "../lib/funnel.js";
import { displayName } from "../lib/users.js";
import { api } from "../lib/api.js";
import { useAttribution, leadPain } from "../lib/pains.js";
import { useData } from "../data.jsx";
// Lead detail drawer — slides over the pipeline when a card is opened.
// (Funil unificado: o card do pipeline é um lead, então o detalhe é do lead.)
// Seções: header → números → GPS (etapa gateada + próximo toque + call) →
// campos/atribuição/qualificação → proposta → TIMELINE (contatos + eventos).

// datetime-local sem timezone (mesmo formato que o input nativo produz).
function localDT(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
}
// nextActionAt é ISO UTC — converte pro formato do input datetime-local e volta.
const isoToLocal = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? localDT(d) : "";
};
const localToIso = (v) => {
  if (!v) return "";
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : "";
};

// Catálogo de atribuição e dor do criativo: helpers compartilhados com o
// pipeline (lib/pains.js) — cache por SaaS no módulo.

function LeadDetail({ lead: initial, onClose }) {
  const { openForm, openDelete, refresh, version } = useData();
  // Cópia local: as ações rápidas (etapa, próximo contato) editam aqui e
  // persistem otimisticamente; o pipeline ressincroniza no fechar (refresh).
  const [lead, setLead] = React.useState(initial);
  const dirty = React.useRef(false);
  const [pendingMove, setPendingMove] = React.useState(null); // { toStage, gate }
  // Timeline: fetch por lead (fora do bootstrap) + refetch quando o tempo real
  // avisa (version) — o drawer vive fora da árvore remontada do App.
  const [activities, setActivities] = React.useState(null);
  React.useEffect(() => { setLead(initial); setPendingMove(null); }, [initial?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (!initial?.id) return;
    let alive = true;
    api.listActivities(initial.id).then((a) => alive && setActivities(a)).catch(() => alive && setActivities([]));
    return () => { alive = false; };
  }, [initial?.id, version]);
  if (!lead) return null;
  const wa = waLink(lead.phone);
  const saasCfg = (window.SEED?.SAAS || []).find((s) => s.id === lead.saas);
  const kind = stageKind(saasCfg, lead.stage || (saasCfg?.funnel?.[0]?.stage ?? ""));
  const isOpen = workableStages(saasCfg).includes(lead.stage) || !lead.stage;

  function patch(p) {
    dirty.current = true;
    setLead((prev) => ({ ...prev, ...p }));
    api.update("leads", lead.id, p).catch((err) => console.warn("lead patch not persisted:", err.message));
  }
  function moveStage(stage) {
    if (!stage || stage === lead.stage) return;
    const gate = moveGate(saasCfg, lead, stage);
    if (gate) { setPendingMove({ toStage: stage, gate }); return; }
    dirty.current = true;
    setLead((prev) => ({ ...prev, stage, stageSince: new Date().toISOString(), stageAttempts: 0 }));
    api.update("leads", lead.id, { stage }).catch((err) => console.warn("lead move not persisted:", err.message));
  }
  function close() {
    if (dirty.current) refresh();
    onClose();
  }
  function refetchTimeline() {
    api.listActivities(lead.id).then(setActivities).catch(() => {});
    // o toque pode ter re-agendado o GPS no servidor — ressincroniza o lead
    api.get("leads", lead.id).then((fresh) => setLead((prev) => ({ ...prev, ...fresh }))).catch(() => {});
  }

  const score = lead.score;
  const hasScore = score != null && score !== "";
  const hasIcp = lead.icp != null && lead.icp !== "";
  const icpPct = hasIcp ? `${Math.round(Number(lead.icp) * 100)}%` : null;

  // Atribuição: resolve utm.campaign/term/content pra nomes via catálogo, e a
  // dor do criativo ("[X]" no nome do anúncio → rótulo do painMap do produto).
  const cat = useAttribution(lead.saas, !!lead.utm);
  const utm = lead.utm || {};
  const pain = leadPain(lead, cat, saasCfg?.painMap);
  const attribution = [
    ["Dor (criativo)", pain ? `[${pain.code}] ${pain.label}` : null],
    ["Campanha", cat?.campaigns?.[utm.campaign]?.name || utm.campaign],
    ["Conjunto", cat?.adsets?.[utm.term]?.name || utm.term],
    ["Anúncio", cat?.ads?.[utm.content]?.name || utm.content],
    ["Origem", [utm.source, utm.medium].filter(Boolean).join(" / ") || null],
  ].filter(([, v]) => v != null && v !== "");

  // Campos REAIS do lead — mostra só os preenchidos (sem placeholder/mock).
  const fields = [
    ["Empresa", lead.company],
    ["Faixa", lead.value],
    ["Prioridade", lead.priority],
    ["Score", hasScore ? `${score} · ${leadScoreLabel(score)}` : null],
    ["ICP", icpPct],
    ["Origem", lead.source],
    ["Dono (SDR)", lead.owner ? displayName(lead.owner) : null],
    ["Closer", lead.closer ? displayName(lead.closer) : null],
    ["E-mail", lead.email],
    ["Telefone", lead.phone],
    ["Motivo", lead.reason],
    ["Perda", lead.lostReason ? `${lossReasonLabel(saasCfg, lead.lostReason)}${lead.lostNote ? ` · ${lead.lostNote}` : ""}` : null],
  ].filter(([, v]) => v != null && v !== "");

  // Respostas das perguntas de qualificação do pipeline (mostra só as preenchidas,
  // convertendo valor → rótulo amigável; arrays viram lista).
  const answers = (saasCfg?.leadQuestions || [])
    .map((q) => {
      let v = lead[q.key];
      if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) return null;
      const lut = Object.fromEntries((q.options || []).map((o) => [o.value, o.label]));
      v = Array.isArray(v) ? v.map((x) => lut[x] || x).join(", ") : (lut[v] || v);
      return [q.label, v];
    })
    .filter(Boolean);

  const next = nextTouchPill(lead, { isOpen });
  const sect = { padding: "14px 20px", borderBottom: "1px solid var(--line-1)" };
  const kicker = { fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase" };
  const rowLabel = { fontSize: 11, width: 110, flexShrink: 0 };
  const presetBtn = { height: 26, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-2)", color: "var(--fg-2)", fontSize: 11.5, fontWeight: 500 };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "oklch(0 0 0 / 0.4)",
      display: "flex", justifyContent: "flex-end", zIndex: 60,
    }} onClick={close}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "min(520px, 100vw)", height: "100%", background: "var(--bg-1)",
        borderLeft: "1px solid var(--line-2)",
        display: "flex", flexDirection: "column",
        boxShadow: "var(--shadow-pop)",
        overflowY: "auto",
      }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "start" }}>
          <div>
            <div className="mono dim" style={{ fontSize: 10, letterSpacing: "0.08em" }}>LEAD · {String(lead.id).toUpperCase()}</div>
            <div style={{ fontSize: 20, fontWeight: 500, marginTop: 4 }}>{lead.name}</div>
            {lead.company && <div className="mono dim" style={{ fontSize: 12, marginTop: 2 }}>{lead.company}</div>}
            <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
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
              {(lead.owner || lead.closer) && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  {lead.owner && <span title={`SDR: ${displayName(lead.owner)}`}><Avatar id={lead.owner} name={displayName(lead.owner)} size={18} /></span>}
                  {lead.closer && <span title={`Closer: ${displayName(lead.closer)}`}><Avatar id={lead.closer} name={displayName(lead.closer)} size={18} /></span>}
                </span>
              )}
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

        {/* GPS: etapa (gateada) + próximo toque + call agendada, sem sair do drawer. */}
        <div style={{ ...sect, display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="mono" style={{ ...kicker, display: "flex", alignItems: "center", gap: 8 }}>
            Próximo passo
            {next && <span className="mono" style={{ fontSize: 10, color: next.key === "late" ? "var(--neg)" : next.key === "none" ? "var(--warn)" : "var(--fg-3)", textTransform: "none", letterSpacing: 0 }}>{next.text}</span>}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="mono dim" style={rowLabel}>Etapa</span>
            <select value={lead.stage || ""} onChange={(e) => moveStage(e.target.value)}
              style={{ flex: 1, height: 28, padding: "0 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12.5 }}>
              {(saasCfg?.funnel || []).map((f) => <option key={f.stage} value={f.stage}>{f.stage}</option>)}
              {saasCfg?.funnel?.every((f) => f.stage !== lead.stage) && lead.stage && <option value={lead.stage}>{lead.stage}</option>}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <span className="mono dim" style={{ ...rowLabel, paddingTop: 6 }}>Próximo toque</span>
            <div style={{ display: "flex", gap: 5, flex: 1, flexWrap: "wrap", alignItems: "center" }}>
              {[["hoje +1h", () => { const t = new Date(); t.setHours(t.getHours() + 1, 0, 0, 0); return t; }],
                ["amanhã 9h", () => { const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0); return t; }],
                ["+2d", () => { const t = new Date(); t.setDate(t.getDate() + 2); t.setHours(9, 0, 0, 0); return t; }],
                ["+1sem", () => { const t = new Date(); t.setDate(t.getDate() + 7); t.setHours(9, 0, 0, 0); return t; }]].map(([label, mk]) => (
                <button key={label} onClick={() => patch({ nextActionAt: mk().toISOString() })} style={presetBtn}>
                  {label}
                </button>
              ))}
              <input type="datetime-local" value={isoToLocal(lead.nextActionAt)} onChange={(e) => patch({ nextActionAt: localToIso(e.target.value) })}
                style={{ height: 26, padding: "0 6px", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 11, fontFamily: "var(--mono)" }} />
              {lead.nextActionAt && (
                <button onClick={() => patch({ nextActionAt: "", nextActionNote: "" })} className="mono dim" style={{ fontSize: 11 }} title="Limpar próximo toque">limpar</button>
              )}
              <input type="text" placeholder="o que fazer nesse toque? (ex.: cobrar proposta)" defaultValue={lead.nextActionNote ?? ""}
                onBlur={(e) => e.target.value !== (lead.nextActionNote || "") && patch({ nextActionNote: e.target.value })}
                style={{ flexBasis: "100%", height: 26, padding: "0 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 11.5 }} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="mono dim" style={rowLabel}>Call agendada</span>
            <input type="datetime-local" value={lead.callAt || ""} onChange={(e) => patch({ callAt: e.target.value })}
              style={{ height: 26, padding: "0 6px", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 11, fontFamily: "var(--mono)" }} />
            {lead.callAt && (
              <button onClick={() => patch({ callAt: "" })} className="mono dim" style={{ fontSize: 11 }} title="Limpar call">limpar</button>
            )}
            <span className="mono dim" style={{ fontSize: 10 }}>aparece na Agenda</span>
          </div>
          {(kind === "proposta" || kind === "followup") && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="mono dim" style={rowLabel}>Proposta</span>
              <input type="number" placeholder="Valor (R$)" defaultValue={lead.proposalValue ?? ""}
                onBlur={(e) => patch({ proposalValue: e.target.value === "" ? "" : Number(e.target.value) })}
                style={{ width: 110, height: 26, padding: "0 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 11.5, fontFamily: "var(--mono)" }} />
              <input type="text" placeholder="Período (ex: 12 meses)" defaultValue={lead.proposalPeriod ?? ""}
                onBlur={(e) => patch({ proposalPeriod: e.target.value })}
                style={{ flex: 1, height: 26, padding: "0 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 11.5 }} />
            </div>
          )}
          {kind === "integracao" && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="mono dim" style={rowLabel}>Integração</span>
              <input type="datetime-local" value={lead.integrationAt || ""} onChange={(e) => patch({ integrationAt: e.target.value })}
                style={{ height: 26, padding: "0 6px", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 11, fontFamily: "var(--mono)" }} />
            </div>
          )}
        </div>

        {fields.length > 0 && (
          <div style={sect}>
            <div className="mono" style={{ ...kicker, marginBottom: 8 }}>Campos</div>
            {fields.map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid var(--line-1)", fontSize: 12, gap: 16 }}>
                <span className="mono dim" style={{ flexShrink: 0 }}>{k}</span>
                <span style={{ textAlign: "right" }}>{v}</span>
              </div>
            ))}
          </div>
        )}

        {attribution.length > 0 && (
          <div style={sect}>
            <div className="mono" style={{ ...kicker, marginBottom: 8 }}>Atribuição · de onde esse lead veio</div>
            {attribution.map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid var(--line-1)", fontSize: 12, gap: 16 }}>
                <span className="mono dim" style={{ flexShrink: 0 }}>{k}</span>
                <span style={{ textAlign: "right", overflowWrap: "anywhere" }}>{v}</span>
              </div>
            ))}
          </div>
        )}

        {answers.length > 0 && (
          <div style={sect}>
            <div className="mono" style={{ ...kicker, marginBottom: 8 }}>Respostas de qualificação</div>
            {answers.map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid var(--line-1)", fontSize: 12, gap: 16 }}>
                <span className="mono dim" style={{ flexShrink: 0 }}>{k}</span>
                <span style={{ textAlign: "right" }}>{v}</span>
              </div>
            ))}
          </div>
        )}

        <div style={sect}>
          <div className="mono" style={{ ...kicker, marginBottom: 10 }}>Proposta</div>
          <ProposalActions l={lead} />
        </div>

        {/* Timeline: TODOS os pontos de contato + eventos automáticos (o histórico
            do lead). comments[] antigos aparecem mesclados como notas. */}
        <div style={{ ...sect, display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 140 }}>
          <div className="mono" style={{ ...kicker, marginBottom: 10 }}>
            Timeline {activities ? `· ${activities.length + (lead.comments?.length || 0)}` : ""}
          </div>
          <ActivityComposer lead={lead} onLogged={refetchTimeline} />
          <div style={{ marginTop: 8 }}>
            {activities === null
              ? <div className="mono dim" style={{ fontSize: 11.5, padding: "10px 0" }}>carregando…</div>
              : <ActivityList activities={activities} comments={lead.comments} />}
          </div>
        </div>

        <div style={{ marginTop: "auto", padding: "12px 20px", borderTop: "1px solid var(--line-1)", display: "flex", gap: 8, background: "var(--bg-inset)", position: "sticky", bottom: 0 }}>
          <button onClick={() => { close(); openForm("leads", lead); }} style={{ flex: 1, padding: "9px 12px", background: "var(--accent)", color: "var(--accent-fg)", borderRadius: "var(--r-2)", fontSize: 13, fontWeight: 500 }}>Editar lead</button>
        </div>

        {pendingMove && (
          <MoveLeadModal
            lead={lead}
            toStage={pendingMove.toStage}
            gate={pendingMove.gate}
            saasCfg={saasCfg}
            onCancel={() => setPendingMove(null)}
            onConfirm={(p, extra) => {
              dirty.current = true;
              setLead((prev) => ({ ...prev, ...p, stageSince: new Date().toISOString(), stageAttempts: 0 }));
              applyGatedMove(p, extra, lead.id).then(refetchTimeline).catch((err) => console.warn("movimento não persistido:", err.message));
              setPendingMove(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

export { LeadDetail };
