import React from "react";
import { Avatar } from "../atoms.jsx";
import { ActivityList, ActivityComposer } from "../components/timeline.jsx";
import { RoutineSuggestion } from "../components/routine-suggestion.jsx";
import { moveGate, MoveLeadModal, applyGatedMove } from "../components/stage-move.jsx";
import { leadScoreLabel, leadAge, waLink, leadTier, cockpitProposalUrl } from "../lib/ui.js";
import { stageKind, lossReasonLabel, nextTouchPill, workableStages } from "../lib/funnel.js";
import { displayName, usersByRole } from "../lib/users.js";
import { paymentLabel, closedPlanLabel } from "../lib/payments.js";
import { api } from "../lib/api.js";
import { useAttribution, leadPain } from "../lib/pains.js";
import { sourceLabel } from "../lib/sources.js";
import { resolveScript, scriptTokens, scriptSegments, scriptChecklist } from "../lib/scripts.js";
import { CallSummaryCard, IntegrationBriefCard, callBusyKeys, callSlotKeys } from "./today.jsx";
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
  const { refresh, version } = useData();
  // Cópia local: as ações rápidas (etapa, próximo contato) editam aqui e
  // persistem otimisticamente; o pipeline ressincroniza no fechar (refresh).
  const [lead, setLead] = React.useState(initial);
  const dirty = React.useRef(false);
  const [editResumo, setEditResumo] = React.useState(false); // lápis do Resumo → edita inline
  const [showTimeline, setShowTimeline] = React.useState(false); // timeline recolhida por padrão
  const [showGps, setShowGps] = React.useState(false);   // Próximo passo recolhido (o pill de atraso fica visível no cabeçalho)
  const [showFrom, setShowFrom] = React.useState(false); // atribuição do anúncio recolhida
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

  // Agenda do closer deste lead, na mesma régua do Meu dia (call de 1h, ignora
  // o próprio card e os follow-ups). Serve pra barrar horário já ocupado no
  // input livre da call, que era o caminho sem nenhuma checagem.
  const callBusy = React.useMemo(
    () => callBusyKeys(window.SEED?.LEADS || [], lead.closer, lead.id),
    [lead.closer, lead.id],
  );
  // A call dura 1h e a grade é de meia hora, então ela ocupa DOIS slots: marcar
  // 14h colide tanto com uma call das 14h quanto com uma das 14h30. Checar só o
  // primeiro slot deixaria a segunda passar.
  const callConflict = (v) => callSlotKeys(v).some((k) => callBusy.has(k));
  const callBusyMsg = lead.callAt && callConflict(lead.callAt)
    ? `${displayName(lead.closer) || "o closer"} já tem call nesse horário`
    : "";

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

  // Último resumo de call por IA (activity call_summary) pra mostrar o card rico
  // na coluna Cliente — mesmo componente do popup das Minhas atividades.
  const callSummary = React.useMemo(() => {
    const cs = (activities || [])
      .filter((x) => x.meta?.event === "call_summary" && x.meta?.summary)
      .sort((x, y) => new Date(y.at || 0) - new Date(x.at || 0))[0];
    return cs ? { ...cs.meta.summary, recordingUrl: cs.meta.recordingUrl || "", kind: cs.meta.kind || "call" } : null;
  }, [activities]);


  // Briefing de passagem pro integrador (activity integration_brief): sai da
  // transcrição da call de VENDA quando o card entra em Integração.
  const integrationBrief = React.useMemo(() => {
    const b = (activities || [])
      .filter((x) => x.meta?.event === "integration_brief" && x.meta?.brief)
      .sort((x, y) => new Date(y.at || 0) - new Date(x.at || 0))[0];
    return b ? { ...b.meta.brief, source: b.meta.source || "", recordingUrl: b.meta.recordingUrl || "" } : null;
  }, [activities]);

  // Depois do handoff, o briefing SUBSTITUI o resumo da call de venda: ele já
  // nasce dessa call e é escrito pro integrador. Dois blocos dizendo a mesma
  // coisa só fazem ler duas vezes. O resumo da call de INTEGRAÇÃO (onboarding,
  // que acontece depois) continua aparecendo.
  const showCallSummary = !!callSummary && !(integrationBrief && callSummary.kind === "call");

  // Última call de VENDA resumida: alimenta os tokens do roteiro (combinado,
  // objeção em aberto, dor, temperatura) — o follow-up retoma de onde a call
  // parou. A de integração fica de fora (estrutura própria, sem objeção).
  const salesSummary = React.useMemo(() => {
    const cs = (activities || [])
      .filter((x) => x.meta?.event === "call_summary" && x.meta?.summary && (x.meta.kind || "call") === "call")
      .sort((x, y) => new Date(y.at || 0) - new Date(x.at || 0))[0];
    return cs ? cs.meta.summary : null;
  }, [activities]);

  // A timeline NÃO repete o resumo de call nem o briefing: os dois já viram card
  // acima (bloco único do insight). Aqui ficam só os contatos e eventos.
  const timelineActs = React.useMemo(
    () => (activities || []).filter((a) => !(a.type === "system" && (a.meta?.event === "call_summary" || a.meta?.event === "integration_brief"))),
    [activities],
  );

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
    // Registrada no movimento Call → Follow-up: é a oferta que o follow-up cobra.
    ["Proposta na mesa", lead.proposalOffer ? (lead.proposalOffer === "nenhuma" ? "não chegou na proposta" : closedPlanLabel(lead.proposalOffer) || lead.proposalOffer) : null],
    ["Pagamento", lead.paymentMethod ? paymentLabel(lead.paymentMethod) : null],
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

  const next = nextTouchPill(lead, { isOpen, kind });
  // Cartões (mesma linguagem da tela de atividade): caixa com rótulo mono.
  const box = { border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", padding: "12px 14px", background: "var(--bg-inset)" };
  const kicker = { fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase" };
  const rowLabel = { fontSize: 11, width: 104, flexShrink: 0 };
  const presetBtn = { height: 26, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 11.5, fontWeight: 500 };
  // Linha chave→valor pra grids de fatos/atribuição.
  const FactRow = ({ k, v }) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12, padding: "4px 0", borderBottom: "1px solid var(--line-1)" }}>
      <span className="mono dim" style={{ flexShrink: 0, fontSize: 10.5 }}>{k}</span>
      <span style={{ fontWeight: 500, textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{v}</span>
    </div>
  );
  // Linha rótulo→campo pra edição inline do Resumo.
  const editInput = { flex: 1, minWidth: 0, height: 28, padding: "0 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12.5 };
  const EditRow = ({ label, children }) => (
    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span className="mono dim" style={{ width: 92, flexShrink: 0, fontSize: 10.5 }}>{label}</span>
      {children}
    </label>
  );

  // Insights do estágio (roteiro) + checklist editável dos dados do 1º contato —
  // mesma lógica da tela de atividade do Meu dia (lib/scripts.js).
  const script = resolveScript(saasCfg, lead);
  const scriptTk = scriptTokens(lead, saasCfg, salesSummary);
  const checklist = scriptChecklist(saasCfg, lead);
  const renderFala = (text) => scriptSegments(text, scriptTk).map((s, i) => {
    if (s.text != null) return <React.Fragment key={i}>{s.text}</React.Fragment>;
    if (s.value != null) return <strong key={i} style={{ color: "var(--accent)", fontWeight: 600 }}>{s.value}</strong>;
    return (
      <span key={i} className="mono" title="dado não preenchido no lead: descubra nesta conversa"
        style={{ background: "var(--warn-soft)", color: "var(--warn)", borderRadius: 4, padding: "0 5px", fontSize: "0.85em", whiteSpace: "nowrap" }}>{s.gap}</span>
    );
  });

  return (
    <div style={{
      position: "fixed", inset: 0, background: "oklch(0 0 0 / 0.45)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 12,
    }} onClick={close}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "min(1120px, 100%)", maxHeight: "min(92vh, 100%)", background: "var(--bg-1)",
        border: "1px solid var(--line-2)", borderRadius: "var(--r-3)",
        display: "flex", flexDirection: "column",
        boxShadow: "var(--shadow-pop)",
      }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line-1)", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "start" }}>
          <div>
            <div className="mono dim code" style={{ fontSize: 10, letterSpacing: "0.08em" }}>LEAD · {String(lead.id).toUpperCase()}</div>
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
              {/* Proposta mora AQUI (o card antigo saiu): sempre a visão do
                  CLIENTE — o link limpo, o mesmo que ele recebe. */}
              {lead.proposalUrl && (
                <a href={cockpitProposalUrl(lead.proposalUrl)} target="_blank" rel="noreferrer"
                  className="chip" title="Abrir a proposta como o cliente vê"
                  style={{ color: "var(--accent)", borderColor: "var(--accent-line)", background: "var(--accent-soft)", fontWeight: 600, textDecoration: "none" }}>
                  proposta ↗
                </a>
              )}
            </div>
          </div>
          <button onClick={close} className="mono dim" style={{ fontSize: 16, flexShrink: 0 }}>✕</button>
        </div>

        {/* Corpo rolável: duas colunas (Cliente | Insights do estágio atual). */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px", minHeight: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 16, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            <div className="mono" style={{ ...kicker, color: "var(--fg-3)" }}>Cliente</div>
          {/* Resumo do cliente: dor em destaque + os fatos compilados num grid.
              O lápis abre a edição INLINE dos campos do lead (sem trocar de tela). */}
          <div style={box}>
            <div className="mono" style={{ ...kicker, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
              <span>Resumo do cliente</span>
              <button onClick={() => setEditResumo((v) => !v)} title={editResumo ? "Concluir edição" : "Editar os dados do cliente aqui mesmo"}
                style={{ marginLeft: "auto", height: 22, padding: "0 8px", borderRadius: "var(--r-1)", border: "1px solid " + (editResumo ? "var(--accent)" : "var(--line-2)"), background: editResumo ? "var(--accent)" : "var(--bg-1)", color: editResumo ? "var(--accent-fg)" : "var(--fg-3)", fontSize: 11 }}>
                {editResumo ? "✓ pronto" : "✎ editar"}
              </button>
            </div>
            {pain && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 9px", marginBottom: 8, borderRadius: "var(--r-2)", background: "var(--accent-soft)", border: "1px solid var(--accent-line)" }}>
                <span className="mono" style={{ fontSize: 9.5, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.06em", flexShrink: 0 }}>dor do anúncio</span>
                <span style={{ fontSize: 12.5, fontWeight: 600, minWidth: 0 }}>[{pain.code}] {pain.label}</span>
              </div>
            )}
            {editResumo ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                <EditRow label="Nome"><input defaultValue={lead.name || ""} onBlur={(e) => e.target.value !== (lead.name || "") && patch({ name: e.target.value })} style={editInput} /></EditRow>
                <EditRow label="Empresa"><input defaultValue={lead.company || ""} onBlur={(e) => e.target.value !== (lead.company || "") && patch({ company: e.target.value })} style={editInput} /></EditRow>
                <EditRow label="Prioridade">
                  <select value={lead.priority || ""} onChange={(e) => patch({ priority: e.target.value })} style={editInput}>
                    <option value="">—</option><option value="P0">P0</option><option value="P1">P1</option><option value="P2">P2</option>
                  </select>
                </EditRow>
                <EditRow label="Valor (R$)"><input type="number" defaultValue={lead.amount ?? ""} onBlur={(e) => patch({ amount: e.target.value === "" ? "" : Number(e.target.value) })} style={editInput} /></EditRow>
                <EditRow label="Faixa"><input defaultValue={lead.value || ""} onBlur={(e) => e.target.value !== (lead.value || "") && patch({ value: e.target.value })} style={editInput} /></EditRow>
                <EditRow label="E-mail"><input defaultValue={lead.email || ""} onBlur={(e) => e.target.value !== (lead.email || "") && patch({ email: e.target.value })} style={editInput} /></EditRow>
                <EditRow label="Telefone"><input defaultValue={lead.phone || ""} onBlur={(e) => e.target.value !== (lead.phone || "") && patch({ phone: e.target.value })} style={editInput} /></EditRow>
                {[["Dono (SDR)", "owner", "sdr"], ["Closer", "closer", "closer"], ["Integrador", "integrator", "integrator"]].map(([label, field, role]) => {
                  const opts = usersByRole(role);
                  return (
                    <EditRow key={field} label={label}>
                      <select value={lead[field] || ""} onChange={(e) => patch({ [field]: e.target.value })} style={editInput}>
                        <option value="">—</option>
                        {opts.map((u) => <option key={u.id} value={u.id}>{u.name || u.id}</option>)}
                        {lead[field] && !opts.some((u) => u.id === lead[field]) && <option value={lead[field]}>{displayName(lead[field])}</option>}
                      </select>
                    </EditRow>
                  );
                })}
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "0 16px" }}>
                {summaryFacts.map(([k, v]) => <FactRow key={k} k={k} v={v} />)}
              </div>
            )}
          </div>

          {/* Dados do 1º contato — editáveis: preenche/corrige o que faltar. */}
          <div style={box}>
            <div className="mono" style={{ ...kicker, marginBottom: 6 }}>Dados do lead · edite pra completar</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {checklist.map((c) => (
                <div key={c.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "5px 9px", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: c.value ? "var(--bg-1)" : "var(--warn-soft)" }}>
                  <span style={{ color: c.value ? "var(--pos)" : "var(--warn)", flexShrink: 0, fontSize: 12 }}>{c.value ? "✓" : "○"}</span>
                  <span className="dim" style={{ flex: 1, minWidth: 0, fontSize: 11, lineHeight: 1.35 }}>{c.label}</span>
                  {c.type === "select" ? (
                    <select value={c.raw || ""} onChange={(e) => patch({ [c.key]: e.target.value })}
                      style={{ flexShrink: 0, maxWidth: "48%", height: 26, padding: "0 6px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: c.raw ? "var(--fg-1)" : "var(--fg-4)", fontSize: 12, fontWeight: 500 }}>
                      <option value="">selecionar…</option>
                      {c.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      {c.raw && !c.options.some((o) => o.value === c.raw) && <option value={c.raw}>{c.raw}</option>}
                    </select>
                  ) : (
                    <input key={lead.id + c.key} type="text" defaultValue={c.raw || ""} placeholder="preencher…"
                      onBlur={(e) => { if (e.target.value !== (c.raw || "")) patch({ [c.key]: e.target.value }); }}
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                      style={{ flexShrink: 0, width: "48%", height: 26, padding: "0 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12, fontWeight: 500 }} />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* GPS: etapa (gateada) + próximo toque + call agendada, sem sair do
              drawer. RECOLHÍVEL: fechado, o cabeçalho segura o resumo (o pill
              de atraso continua visível). */}
        <div style={{ ...box, display: "flex", flexDirection: "column", gap: 10 }}>
          <button onClick={() => setShowGps((v) => !v)} title={showGps ? "Recolher" : "Abrir o próximo passo (etapa, toque, call, proposta)"}
            className="mono" style={{ ...kicker, display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
            Próximo passo
            {next && <span className="mono" style={{ fontSize: 10, color: next.key === "late" ? "var(--neg)" : next.key === "none" ? "var(--warn)" : "var(--fg-3)", textTransform: "none", letterSpacing: 0 }}>{next.text}</span>}
            <span style={{ marginLeft: "auto", fontSize: 10, flexShrink: 0 }}>{showGps ? "▴ recolher" : "▾ abrir"}</span>
          </button>
          {showGps && (<>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
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
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className="mono dim" style={rowLabel}>Call agendada</span>
            {/* Em etapa de follow-up a fila do Meu dia vence pelo nextActionAt,
                então marcar a call aqui SINCRONIZA o próximo toque no mesmo
                horário (igual o roteiro faz) — senão o card fica com a call
                num dia e a fila cobrando em outro. */}
            <input type="datetime-local" value={lead.callAt || ""}
              onChange={(e) => {
                // Digitação livre também respeita a agenda do closer: aqui não
                // tem a grade do Meu dia pra esconder o slot ocupado, então a
                // checagem é na hora de salvar (era por onde entravam duas
                // calls do mesmo closer no mesmo horário, sem ninguém avisar).
                if (e.target.value && callConflict(e.target.value)) return;
                patch(kind === "followup" && e.target.value
                  ? { callAt: e.target.value, nextActionAt: localToIso(e.target.value) }
                  : { callAt: e.target.value });
              }}
              style={{ height: 26, padding: "0 6px", borderRadius: "var(--r-2)", border: `1px solid ${callBusyMsg ? "var(--neg)" : "var(--line-1)"}`, background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 11, fontFamily: "var(--mono)" }} />
            {lead.callAt && (
              <button onClick={() => patch({ callAt: "" })} className="mono dim" style={{ fontSize: 11 }} title="Limpar call">limpar</button>
            )}
            <span className="mono dim" style={{ fontSize: 10, color: callBusyMsg ? "var(--neg)" : undefined }}>
              {callBusyMsg || "aparece na Agenda"}
            </span>
          </div>
          {/* Link de videochamada: sala Jitsi com slug aleatório (sem conta, abre
              no navegador/celular), salva no lead e vai pro Whats com 1 clique. */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0, flexWrap: "wrap" }}>
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
                    title="Buscar a transcrição da call no Google e gerar o resumo estratégico (dores, objeções, follow-up)"
                    onClick={async (ev) => {
                      const btn = ev.currentTarget;
                      btn.disabled = true; btn.textContent = "resumindo…";
                      try {
                        let r = await api.callSummary(lead.id);
                        if (!r.ok && r.reason === "already_done" && window.confirm("Essa call já tem resumo. Gerar de novo?")) {
                          r = await api.callSummary(lead.id, true);
                        }
                        if (r.ok) {
                          refetchTimeline?.();
                          const f = r.summary?.followup;
                          window.alert(`Resumo pronto ✓ Temperatura: ${r.summary?.temperatura || "?"}.${f?.quando ? " Próximo toque sugerido já foi agendado no GPS." : ""}`);
                        } else if (r.reason === "call_in_progress") {
                          // Encerrar a sala daqui destrava a transcrição sem
                          // ninguém precisar entrar no Meet pra clicar.
                          if (window.confirm("A sala do Meet ainda está ABERTA e o Google só gera a transcrição quando o último participante sai.\n\nEncerrar a sala agora? (não faça isso se a call ainda estiver rolando)")) {
                            try {
                              const e2 = await api.endMeet(lead.id, "call");
                              window.alert(e2.ended
                                ? "Sala encerrada ✓ A transcrição leva alguns minutos pra ficar pronta; o cockpit resume sozinho (ou clique de novo em resumir)."
                                : "Não havia conferência ativa agora. Tente resumir de novo em alguns minutos.");
                            } catch (e3) { window.alert(e3.message || "Não deu pra encerrar a sala."); }
                          }
                        } else if (r.reason === "transcript_not_ready") {
                          // Sem o Doc no Drive, a suspeita nº 1 é a sala que
                          // ficou aberta (o Google só gera a transcrição quando
                          // o último sai). Oferece encerrar mesmo sem detectar:
                          // sem conferência ativa a API responde 404 e nada acontece.
                          if (window.confirm(`A transcrição ainda não está no Google.${r.detail ? `\n\nMotivo: ${r.detail}` : ""}\n\nA causa mais comum é a sala do Meet ter ficado ABERTA (o Google só gera a transcrição quando o último participante sai).\n\nTentar encerrar a sala agora? (não faça isso se a call ainda estiver rolando)`)) {
                            try {
                              const e2 = await api.endMeet(lead.id, "call");
                              window.alert(e2.ended
                                ? "Sala encerrada ✓ A transcrição leva alguns minutos; o cockpit resume sozinho (ou clique de novo em resumir)."
                                : "A sala já não tinha ninguém (a call fechou). Se a transcrição estava ligada, ela sai em alguns minutos e o cockpit resume sozinho — senão, confirme que a transcrição estava ligada no Meet.");
                            } catch (e3) { window.alert(e3.message || "Não deu pra encerrar a sala."); }
                          }
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
                    style={{ height: 26, padding: "0 12px", borderRadius: "var(--r-2)", background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))", fontSize: 11.5, fontWeight: 600 }}>
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
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span className="mono dim" style={rowLabel}>Convidados extras</span>
              <input type="text" placeholder="emails separados por vírgula (além do lead)"
                defaultValue={lead.meetGuests ?? ""}
                onBlur={(e) => e.target.value !== (lead.meetGuests || "") && patch({ meetGuests: e.target.value })}
                title="Entram como convidados do evento no Google Calendar quando o Meet é criado (o e-mail do lead já vai automático)"
                style={{ flex: 1, height: 26, padding: "0 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 11.5, fontFamily: "var(--mono)" }} />
            </div>
          )}
          {(kind === "proposta" || kind === "followup") && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
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
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span className="mono dim" style={rowLabel}>Integração</span>
                <input type="datetime-local" value={lead.integrationAt || ""} onChange={(e) => patch({ integrationAt: e.target.value })}
                  style={{ height: 26, padding: "0 6px", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 11, fontFamily: "var(--mono)" }} />
              </div>
              {/* Briefing de passagem: o cockpit gera sozinho quando o card
                  entra aqui (e re-tenta enquanto a transcrição da venda não
                  fica pronta). Este botão é o "gera agora" / "refaz". */}
              {window.SEED?.CONFIG?.ai?.configured && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="mono dim" style={rowLabel}>Briefing</span>
                  <button className="mono" style={{ fontSize: 11, color: "var(--accent)" }}
                    title="Lê a transcrição da call de venda e monta o briefing pro integrador (contexto, o que foi prometido, o que confirmar e o passo a passo)"
                    onClick={async (ev) => {
                      const btn = ev.currentTarget; const was = btn.textContent;
                      btn.disabled = true; btn.textContent = "montando…";
                      try {
                        let r = await api.integrationBrief(lead.id);
                        if (!r.ok && r.reason === "already_done" && window.confirm("Esse lead já tem briefing. Gerar de novo?")) r = await api.integrationBrief(lead.id, true);
                        if (r.ok) {
                          refetchTimeline?.();
                          window.alert(r.source === "resumo"
                            ? "Briefing pronto ✓ (sem transcrição da call: saiu do resumo que a IA já tinha extraído, então confira antes de usar)"
                            : "Briefing pronto ✓ (lido da transcrição da call de venda)");
                        } else if (r.reason === "no_source") {
                          window.alert("Sem fonte pra montar o briefing: essa venda não tem transcrição do Meet nem resumo de call. Gere o resumo da call primeiro (botão ✨ na linha do vídeo) ou registre o contexto na timeline.");
                        } else if (r.reason) window.alert(`Não deu: ${r.reason}`);
                      } catch (e) { window.alert(e.message || "Falha ao montar o briefing."); }
                      finally { btn.disabled = false; btn.textContent = was; }
                    }}>{lead.integrationBriefAt ? "✨ refazer briefing" : "✨ gerar briefing"}</button>
                </div>
              )}
              {/* Call de vídeo da integração: Meet PRÓPRIO (não o da venda) no
                  horário da integração; depois vira resumo de onboarding. */}
              <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0, flexWrap: "wrap" }}>
                <span className="mono dim" style={rowLabel}>Vídeo integração</span>
                {lead.integrationCallUrl ? (
                  <>
                    <a href={lead.integrationCallUrl} target="_blank" rel="noopener noreferrer" className="mono"
                      style={{ fontSize: 11, color: "var(--accent)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }} title={lead.integrationCallUrl}>
                      {lead.integrationCallUrl.replace("https://", "")}
                    </a>
                    <button className="mono dim" style={{ fontSize: 11, flexShrink: 0 }} title="Copiar link"
                      onClick={() => { try { navigator.clipboard.writeText(lead.integrationCallUrl); } catch { window.prompt("Link da integração:", lead.integrationCallUrl); } }}>copiar</button>
                    {wa && (
                      <a className="mono" style={{ fontSize: 11, color: "#128c4b", textDecoration: "none", flexShrink: 0 }}
                        href={`${wa}?text=${encodeURIComponent(`Oi${lead.name ? " " + String(lead.name).trim().split(/\s+/)[0] : ""}! Aqui é da ${saasCfg?.name || "equipe"}. Nossa call de integração vai ser por este link: ${lead.integrationCallUrl}`)}`}
                        target="_blank" rel="noopener noreferrer" title="Enviar o link pro cliente no WhatsApp">mandar no Whats ↗</a>
                    )}
                    {lead.integrationCallUrl.includes("meet.google.com") && window.SEED?.CONFIG?.ai?.configured && (
                      <button className="mono" style={{ fontSize: 11, flexShrink: 0, color: "var(--accent)" }}
                        title="Buscar a transcrição da integração no Google e gerar o resumo de onboarding"
                        onClick={async (ev) => {
                          const btn = ev.currentTarget; btn.disabled = true; btn.textContent = "resumindo…";
                          try {
                            let r = await api.callSummary(lead.id, false, "integracao");
                            if (!r.ok && r.reason === "already_done" && window.confirm("Essa integração já tem resumo. Gerar de novo?")) r = await api.callSummary(lead.id, true, "integracao");
                            if (r.ok) { refetchTimeline?.(); window.alert(`Resumo da integração pronto ✓ Cliente: ${r.summary?.sentimento || "?"}.`); }
                            // `detail` diz QUAL caminho falhou (Meet API / Drive) — sem ele
                            // o diagnóstico virava adivinhação.
                            else if (r.reason === "call_in_progress") {
                              if (window.confirm("A sala do Meet ainda está ABERTA e o Google só gera a transcrição quando o último participante sai.\n\nEncerrar a sala agora? (não faça isso se a call ainda estiver rolando)")) {
                                try {
                                  const e2 = await api.endMeet(lead.id, "integracao");
                                  window.alert(e2.ended
                                    ? "Sala encerrada ✓ A transcrição leva alguns minutos; o cockpit resume sozinho (ou clique de novo em resumir)."
                                    : "Não havia conferência ativa agora. Tente resumir de novo em alguns minutos.");
                                } catch (e3) { window.alert(e3.message || "Não deu pra encerrar a sala."); }
                              }
                            }
                            else if (r.reason === "transcript_not_ready") {
                              if (window.confirm(`A transcrição ainda não está no Google.${r.detail ? `\n\nMotivo: ${r.detail}` : ""}\n\nA causa mais comum é a sala do Meet ter ficado ABERTA (o Google só gera a transcrição quando o último participante sai).\n\nTentar encerrar a sala agora? (não faça isso se a call ainda estiver rolando)`)) {
                                try {
                                  const e2 = await api.endMeet(lead.id, "integracao");
                                  window.alert(e2.ended
                                    ? "Sala encerrada ✓ A transcrição leva alguns minutos; o cockpit resume sozinho (ou clique de novo em resumir)."
                                    : "A sala já não tinha ninguém (a call fechou). Se a transcrição estava ligada, ela sai em alguns minutos e o cockpit resume sozinho — senão, confirme que a transcrição estava ligada no Meet.");
                                } catch (e3) { window.alert(e3.message || "Não deu pra encerrar a sala."); }
                              }
                            }
                            else if (r.reason) window.alert(`Não deu: ${r.reason}`);
                          } catch (e) { window.alert(e.message || "Falha ao resumir a integração."); }
                          finally { btn.disabled = false; btn.textContent = "✨ resumir integração"; }
                        }}>✨ resumir integração</button>
                    )}
                  </>
                ) : (
                  window.SEED?.CONFIG?.google?.connected && (
                    <button
                      onClick={async () => {
                        if (!lead.integrationAt) { window.alert("Marque a data e hora da integração primeiro (campo acima)."); return; }
                        try {
                          const r = await api.createMeet(lead.id, { kind: "integracao" });
                          dirty.current = true;
                          setLead((prev) => ({ ...prev, integrationCallUrl: r.callUrl, integrationMeetEventId: r.eventId }));
                        } catch (e) { window.alert(e.message || "Falha ao criar o Meet da integração."); }
                      }}
                      title="Cria um Meet na agenda no horário da integração, com gravação e transcrição automáticas (resumo de onboarding depois)"
                      style={{ height: 26, padding: "0 12px", borderRadius: "var(--r-2)", background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))", fontSize: 11.5, fontWeight: 600 }}>
                      🎥 criar Meet da integração
                    </button>
                  )
                )}
              </div>
            </>
          )}
          </>)}
        </div>

        {/* De onde veio: recolhível (consulta, não fluxo do dia a dia). */}
        {attribution.length > 0 && (
          <div style={box}>
            <button onClick={() => setShowFrom((v) => !v)} title={showFrom ? "Recolher" : "Abrir a atribuição (campanha, conjunto, anúncio, origem)"}
              className="mono" style={{ ...kicker, display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
              De onde veio · atribuição do anúncio
              <span style={{ marginLeft: "auto", fontSize: 10, flexShrink: 0 }}>{showFrom ? "▴ recolher" : "▾ abrir"}</span>
            </button>
            {showFrom && (
              <div style={{ marginTop: 6 }}>
                {attribution.map(([k, v]) => <FactRow key={k} k={k} v={v} />)}
              </div>
            )}
          </div>
        )}
          </div>

          {/* Coluna direita: insights (roteiro) do estágio atual + histórico. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            <div className="mono" style={{ ...kicker, color: "var(--fg-3)" }}>Insights do estágio · {lead.stage || (saasCfg?.funnel?.[0]?.stage ?? "")}</div>
            {/* Briefing de passagem em cima de tudo: é o que o integrador lê
                primeiro quando abre o card que acabou de chegar nele. */}
            <IntegrationBriefCard brief={integrationBrief} phone={lead.phone}
              deal={{
                amount: lead.amount, planClosed: lead.planClosed, paymentMethod: lead.paymentMethod,
                integrationAt: lead.integrationAt, integrationCallUrl: lead.integrationCallUrl,
              }} />
            {/* Resumo da última call por IA em cima dos insights do estágio
                (some quando o briefing já cobre a call de venda). */}
            <CallSummaryCard summary={showCallSummary ? callSummary : null} phone={lead.phone} />
            <div style={{ ...box, background: "var(--accent-soft)", border: "1px solid var(--accent-line)" }}>
              <div className="mono" style={{ ...kicker, color: "var(--accent)", marginBottom: 4 }}>Como se comportar</div>
              <div style={{ fontSize: 12, lineHeight: 1.45 }}>{script.resumo}</div>
            </div>
            <div style={box}>
              <div className="mono" style={{ ...kicker, marginBottom: 4 }}>Objetivo do contato</div>
              <div style={{ fontSize: 12, lineHeight: 1.45, fontWeight: 500 }}>{script.objetivo}</div>
            </div>
            <div style={box}>
              <div className="mono" style={{ ...kicker, marginBottom: 6 }}>Passo a passo</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {script.passos.map((p, i) => (
                  <div key={i} style={{ display: "flex", gap: 10 }}>
                    <span className="mono tnum" style={{ width: 20, height: 20, borderRadius: 999, flexShrink: 0, marginTop: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "var(--bg-inset)", border: "1px solid var(--line-2)", fontSize: 10.5, fontWeight: 700, color: "var(--fg-3)" }}>{i + 1}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      {p.t && <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 1 }}>{p.t}</div>}
                      {p.fala && <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--fg-1)", borderLeft: "3px solid var(--accent-line)", paddingLeft: 10, whiteSpace: "pre-wrap" }}>{renderFala(p.fala)}</div>}
                      {p.dica && <div className="dim" style={{ fontSize: 10.5, marginTop: 2, paddingLeft: 13 }}>{renderFala(p.dica)}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* UniqueKids: sugestão de solução da rotina (IA · método R.O.T.I.N.A),
                gerada do desafio + exemplo e editável pela Ana. Só aparece quando há desafio. */}
            {(lead.desafio || lead.desafio_exemplo) && <RoutineSuggestion lead={lead} patch={patch} />}

        {/* Aviso de número inválido / descadastro (dos webhooks do WhatsApp): o
            operador vê antes de tentar mandar, e os disparos já pulam sozinhos. */}
        {(lead.whatsappInvalid || lead.whatsappOptOut) && (
          <div className="mono" style={{ margin: "0 0 8px", padding: "7px 10px", borderRadius: "var(--r-2)", fontSize: 11.5,
            border: "1px solid " + (lead.whatsappInvalid ? "var(--neg)" : "var(--line-2)"),
            background: lead.whatsappInvalid ? "var(--neg-soft)" : "var(--bg-inset)",
            color: lead.whatsappInvalid ? "var(--neg)" : "var(--fg-3)" }}>
            {lead.whatsappInvalid
              ? `número inválido no WhatsApp${lead.whatsappInvalidReason ? ` (${lead.whatsappInvalidReason})` : ""} · os disparos pulam esse número`
              : "descadastrou do WhatsApp (parar promoções) · fora dos disparos"}
          </div>
        )}

        {/* Timeline RECOLHÍVEL: nasce fechada (o histórico é consulta, não fluxo
            do dia a dia) — o cabeçalho mostra a contagem e abre no clique, com o
            composer de registrar toque junto. */}
        <div style={{ ...box, display: "flex", flexDirection: "column", ...(showTimeline ? { minHeight: 160 } : {}) }}>
          <button onClick={() => setShowTimeline((v) => !v)}
            title={showTimeline ? "Recolher a timeline" : "Abrir a timeline (histórico + registrar toque)"}
            className="mono" style={{ ...kicker, display: "flex", alignItems: "center", width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--fg-3)", textAlign: "left" }}>
            <span>Timeline {activities ? `· ${timelineActs.length + (lead.comments?.length || 0)}` : ""}</span>
            <span style={{ marginLeft: "auto", fontSize: 10 }}>{showTimeline ? "▴ recolher" : "▾ abrir"}</span>
          </button>
          {showTimeline && (
            <>
              <div style={{ marginTop: 10 }}>
                <ActivityComposer lead={lead} onLogged={refetchTimeline} />
              </div>
              <div style={{ marginTop: 8 }}>
                {activities === null
                  ? <div className="mono dim" style={{ fontSize: 11.5, padding: "10px 0" }}>carregando…</div>
                  : <ActivityList activities={timelineActs} comments={lead.comments} />}
              </div>
            </>
          )}
        </div>
          </div>{/* fim coluna Insights */}
        </div>{/* fim grid duas colunas */}
        </div>

        <div style={{ flexShrink: 0, padding: "12px 20px", borderTop: "1px solid var(--line-1)", display: "flex", gap: 8, background: "var(--bg-inset)" }}>
          {wa ? (
            <a href={wa} target="_blank" rel="noopener noreferrer" title={`WhatsApp · ${lead.phone}`}
              style={{ flex: 1, textAlign: "center", padding: "10px 12px", background: "#25D366", color: "#06120c", borderRadius: "var(--r-2)", fontSize: 13.5, fontWeight: 700, textDecoration: "none" }}>
              WhatsApp ↗
            </a>
          ) : (
            <span className="mono dim" style={{ flex: 1, textAlign: "center", padding: "10px 12px", fontSize: 12 }}>sem telefone cadastrado</span>
          )}
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
