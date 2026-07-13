import React from "react";
import { Avatar, RowActions } from "../atoms.jsx";
import { ProposalActions } from "../components/ProposalActions.jsx";
import { ActivityList, ActivityComposer } from "../components/timeline.jsx";
import { moveGate, MoveLeadModal, applyGatedMove } from "../components/stage-move.jsx";
import { leadScoreLabel, leadAge, chromeBtnStyleSmall, waLink, leadTier } from "../lib/ui.js";
import { stageKind, lossReasonLabel, nextTouchPill, workableStages } from "../lib/funnel.js";
import { displayName } from "../lib/users.js";
import { api } from "../lib/api.js";
import { useAttribution, leadPain } from "../lib/pains.js";
import { sourceLabel } from "../lib/sources.js";
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
  const tier = leadTier(lead);
  // De onde veio (Dor sobe pro destaque do Resumo; aqui fica a atribuição crua).
  const attribution = [
    ["Variante da headline", lead.formHeadline || (lead.formVariant ? `versão ${lead.formVariant}` : null)],
    ["Campanha", cat?.campaigns?.[utm.campaign]?.name || utm.campaign],
    ["Conjunto", cat?.adsets?.[utm.term]?.name || utm.term],
    ["Anúncio", cat?.ads?.[utm.content]?.name || utm.content],
    ["Origem", [sourceLabel(utm), utm.medium].filter(Boolean).join(" / ") || null],
    ["Veio de", utm.referrer || null],           // referrer externo (orgânico/bio)
    ["Página de entrada", lead.sourceUrl || null],
  ].filter(([, v]) => v != null && v !== "");

  // Resumo do cliente: os números e campos reais compilados num grid só (mesmo
  // padrão da tela de atividade). Empresa fica no cabeçalho; só o preenchido entra.
  const daysInStage = Math.max(0, Math.floor((Date.now() - new Date(lead.stageSince || lead.createdAt || Date.now()).getTime()) / 86400000));
  const summaryFacts = [
    ["Potencial", tier.key !== "sem" ? tier.label : null],
    ["Valor", lead.amount ? window.fmt.money(lead.amount) : null],
    ["Idade", leadAge(lead)],
    ["Na etapa", `${daysInStage}d`],
    ["Temperatura", hasScore ? `${leadScoreLabel(score)} · ${score}` : null],
    ["ICP (fit)", icpPct],
    ["Prioridade", lead.priority],
    ["Faixa", lead.value],
    ["Origem", lead.source],
    ["Dono (SDR)", lead.owner ? displayName(lead.owner) : null],
    ["Closer", lead.closer ? displayName(lead.closer) : null],
    ["Integrador", lead.integrator ? displayName(lead.integrator) : null],
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
  // Cartões (mesma linguagem da tela de atividade): caixa com rótulo mono.
  const box = { border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", padding: "12px 14px", background: "var(--bg-inset)" };
  const kicker = { fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase" };
  const rowLabel = { fontSize: 11, width: 104, flexShrink: 0 };
  const presetBtn = { height: 26, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 11.5, fontWeight: 500 };
  // Linha chave→valor pra grids de fatos/atribuição/respostas.
  const FactRow = ({ k, v }) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12, padding: "4px 0", borderBottom: "1px solid var(--line-1)" }}>
      <span className="mono dim" style={{ flexShrink: 0, fontSize: 10.5 }}>{k}</span>
      <span style={{ fontWeight: 500, textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{v}</span>
    </div>
  );

  return (
    <div style={{
      position: "fixed", inset: 0, background: "oklch(0 0 0 / 0.4)",
      display: "flex", justifyContent: "flex-end", zIndex: 60,
    }} onClick={close}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "min(560px, 100vw)", height: "100%", background: "var(--bg-1)",
        borderLeft: "1px solid var(--line-2)",
        display: "flex", flexDirection: "column",
        boxShadow: "var(--shadow-pop)",
      }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line-1)", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "start" }}>
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

        {/* Corpo rolável em cartões (mesma linguagem da tela de atividade). */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
          {/* Resumo do cliente: dor em destaque + os fatos compilados num grid. */}
          <div style={box}>
            <div className="mono" style={{ ...kicker, marginBottom: 8 }}>Resumo do cliente</div>
            {pain && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 9px", marginBottom: 8, borderRadius: "var(--r-2)", background: "var(--accent-soft)", border: "1px solid var(--accent-line)" }}>
                <span className="mono" style={{ fontSize: 9.5, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.06em", flexShrink: 0 }}>dor do anúncio</span>
                <span style={{ fontSize: 12.5, fontWeight: 600, minWidth: 0 }}>[{pain.code}] {pain.label}</span>
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "0 16px" }}>
              {summaryFacts.map(([k, v]) => <FactRow key={k} k={k} v={v} />)}
            </div>
          </div>

          {/* GPS: etapa (gateada) + próximo toque + call agendada, sem sair do drawer. */}
        <div style={{ ...box, display: "flex", flexDirection: "column", gap: 10 }}>
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
          {/* Link de videochamada: sala Jitsi com slug aleatório (sem conta, abre
              no navegador/celular), salva no lead e vai pro Whats com 1 clique. */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
            <span className="mono dim" style={rowLabel}>Videochamada</span>
            {lead.callUrl ? (
              <>
                <a href={lead.callUrl} target="_blank" rel="noopener noreferrer" className="mono"
                  style={{ fontSize: 11, color: "var(--accent)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}
                  title={lead.callUrl}>
                  {lead.callUrl.replace("https://", "")}
                </a>
                <button className="mono dim" style={{ fontSize: 11, flexShrink: 0 }} title="Copiar link"
                  onClick={() => { try { navigator.clipboard.writeText(lead.callUrl); } catch { window.prompt("Link da call:", lead.callUrl); } }}>
                  copiar
                </button>
                {wa && (
                  <a className="mono" style={{ fontSize: 11, color: "#128c4b", textDecoration: "none", flexShrink: 0 }}
                    href={`${wa}?text=${encodeURIComponent(`Oi${lead.name ? " " + String(lead.name).trim().split(/\s+/)[0] : ""}! Aqui é da LeverAds. Nossa call vai ser por este link: ${lead.callUrl}`)}`}
                    target="_blank" rel="noopener noreferrer" title="Enviar o link pro lead no WhatsApp">
                    mandar no Whats ↗
                  </a>
                )}
                {lead.callUrl.includes("meet.google.com") && window.SEED?.CONFIG?.ai?.configured && (
                  <button className="mono" style={{ fontSize: 11, flexShrink: 0, color: "var(--accent)" }}
                    title="Buscar a transcrição da call no Google e gerar o resumo estratégico na timeline (dores, objeções, follow-up)"
                    onClick={async (ev) => {
                      const btn = ev.currentTarget;
                      btn.disabled = true; btn.textContent = "resumindo…";
                      try {
                        let r = await api.callSummary(lead.id);
                        if (!r.ok && r.reason === "already_done" && window.confirm("Essa call já tem resumo na timeline. Gerar de novo?")) {
                          r = await api.callSummary(lead.id, true);
                        }
                        if (r.ok) {
                          refetchTimeline?.();
                          const f = r.summary?.followup;
                          window.alert(`Resumo pronto na timeline ✓ Temperatura: ${r.summary?.temperatura || "?"}.${f?.quando ? " Próximo toque sugerido já foi agendado no GPS." : ""}`);
                        } else if (r.reason === "transcript_not_ready") {
                          window.alert("A transcrição ainda não está pronta no Google. A call já terminou? Gravação e transcrição estavam ligadas? Tenta de novo em alguns minutos (o cockpit também tenta sozinho a cada 10 min).");
                        } else if (r.reason === "not_connected") {
                          window.alert("Google não conectado. Ajustes → Integrações → Conectar Google.");
                        } else if (r.reason) {
                          window.alert(`Não deu: ${r.reason}`);
                        }
                      } catch (e) { window.alert(e.message || "Falha ao resumir a call."); }
                      finally { btn.disabled = false; btn.textContent = "✨ resumir call"; }
                    }}>
                    ✨ resumir call
                  </button>
                )}
                <button className="mono dim" style={{ fontSize: 11, flexShrink: 0 }}
                  title={lead.callUrl.includes("meet.google.com") ? "Criar OUTRO evento com Meet na agenda" : "Gerar um link novo (o antigo deixa de valer pra você)"}
                  onClick={async () => {
                    if (lead.callUrl.includes("meet.google.com") && window.SEED?.CONFIG?.google?.connected) {
                      try {
                        const r = await api.createMeet(lead.id);
                        dirty.current = true;
                        setLead((prev) => ({ ...prev, callUrl: r.callUrl, meetEventId: r.eventId }));
                      } catch (e) { window.alert(e.message || "Falha ao criar o Meet."); }
                    } else {
                      patch({ callUrl: `https://meet.jit.si/LeverAds-${Math.random().toString(36).slice(2, 10)}` });
                    }
                  }}>
                  ↻
                </button>
              </>
            ) : (
              <>
                {window.SEED?.CONFIG?.google?.connected && (
                  <button
                    onClick={async () => {
                      try {
                        const r = await api.createMeet(lead.id);
                        dirty.current = true;
                        setLead((prev) => ({ ...prev, callUrl: r.callUrl, meetEventId: r.eventId }));
                        const cfg = r.meetConfig || {};
                        const faltou = [!cfg.open && "entrada sem aprovação", !cfg.recording && "gravação automática", !cfg.transcription && "transcrição automática"].filter(Boolean);
                        const motivo = cfg.errors ? ` Motivo do Google: ${Object.values(cfg.errors)[0]}` : "";
                        if (faltou.length) window.alert(`Meet criado ✓ Mas não deu pra ativar: ${faltou.join(", ")}.${motivo}`);
                      } catch (e) { window.alert(e.message || "Falha ao criar o Meet."); }
                    }}
                    title="Evento com Meet na agenda: convida o lead (se tiver e-mail) e os convidados extras; sala aberta com gravação e transcrição automáticas quando o plano permite"
                    style={{ height: 26, padding: "0 12px", borderRadius: "var(--r-2)", background: "var(--accent)", color: "var(--accent-fg)", fontSize: 11.5, fontWeight: 600 }}>
                    🎥 criar Meet na agenda
                  </button>
                )}
                <button onClick={() => patch({ callUrl: `https://meet.jit.si/LeverAds-${Math.random().toString(36).slice(2, 10)}` })}
                  title={window.SEED?.CONFIG?.google?.connected ? "Alternativa sem agenda: sala Jitsi instantânea" : "Sala Jitsi instantânea (conecte o Google em Ajustes pra criar Meet na agenda)"}
                  style={{ height: 26, padding: "0 12px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-2)", color: "var(--fg-2)", fontSize: 11.5, fontWeight: 600 }}>
                  {window.SEED?.CONFIG?.google?.connected ? "sala Jitsi" : "🎥 criar link da call"}
                </button>
              </>
            )}
          </div>
          {window.SEED?.CONFIG?.google?.connected && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="mono dim" style={rowLabel}>Convidados extras</span>
              <input type="text" placeholder="emails separados por vírgula (além do lead)"
                defaultValue={lead.meetGuests ?? ""}
                onBlur={(e) => e.target.value !== (lead.meetGuests || "") && patch({ meetGuests: e.target.value })}
                title="Entram como convidados do evento no Google Calendar quando o Meet é criado (o e-mail do lead já vai automático)"
                style={{ flex: 1, height: 26, padding: "0 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 11.5, fontFamily: "var(--mono)" }} />
            </div>
          )}
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

        {answers.length > 0 && (
          <div style={box}>
            <div className="mono" style={{ ...kicker, marginBottom: 6 }}>Respostas de qualificação</div>
            {answers.map(([k, v]) => <FactRow key={k} k={k} v={v} />)}
          </div>
        )}

        {attribution.length > 0 && (
          <div style={box}>
            <div className="mono" style={{ ...kicker, marginBottom: 6 }}>De onde veio · atribuição do anúncio</div>
            {attribution.map(([k, v]) => <FactRow key={k} k={k} v={v} />)}
          </div>
        )}

        <div style={box}>
          <div className="mono" style={{ ...kicker, marginBottom: 10 }}>Proposta</div>
          <ProposalActions l={lead} />
        </div>

        {/* Timeline: TODOS os pontos de contato + eventos automáticos (o histórico
            do lead). comments[] antigos aparecem mesclados como notas. */}
        <div style={{ ...box, display: "flex", flexDirection: "column", minHeight: 160 }}>
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
        </div>

        <div style={{ flexShrink: 0, padding: "12px 20px", borderTop: "1px solid var(--line-1)", display: "flex", gap: 8, background: "var(--bg-inset)" }}>
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
