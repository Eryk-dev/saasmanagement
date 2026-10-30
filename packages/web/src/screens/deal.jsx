import React from "react";
import { MoreMenu, WaButton } from "../atoms.jsx";
import { Pill } from "../components/viz.jsx";
import { Drawer, Modal } from "../components/overlay.jsx";
import { LeadGrade, LeadSection, LeadDisclosure, LeadPhoneCopy } from "../components/lead-card.jsx";
import { CallfaceButton } from "../components/callface-button.jsx";
import { ActivityList, ActivityComposer, mergeTimeline } from "../components/timeline.jsx";
import { RoutineSuggestion } from "../components/routine-suggestion.jsx";
import { moveGate, MoveLeadModal, applyGatedMove, moveErrorText } from "../components/stage-move.jsx";
import { clientSummary, leadBox, ClientSummaryCard, AttributionCard, LeadChecklist, ScriptBlocks } from "../components/lead-blocks.jsx";
import { waLink, leadTier, cockpitProposalUrl } from "../lib/ui.js";
import { meetingInviteText } from "../lib/wa-copy.js";
import { stageKind, lossReasonLabel, nextTouchPill, workableStages, stageByKind, isLossKind, phaseOf } from "../lib/funnel.js";
import { SelectPopover } from "../components/select-popover.jsx";
import { DateTimeField, formatDateTime } from "../components/datetime-field.jsx";
import { brtMs } from "../lib/format.js";
import { Checkbox } from "../components/form-controls.jsx";
import { displayName, usersByRole, currentUser } from "../lib/users.js";
import { CallCopilot } from "../components/call-copilot.jsx";
import { api } from "../lib/api.js";
import { useAttribution } from "../lib/pains.js";
import { sourceLabel } from "../lib/sources.js";
import { resolveScript, scriptTokens, scriptChecklist, isNoShowStage } from "../lib/scripts.js";
import { CallSummaryCard, IntegrationBriefCard, callBusyKeys, callSlotKeys, integBusyKeys, destinationsFor, withoutWonStep, parseMoneyInput, secondCallPatch } from "./today.jsx";
import { summaryReason } from "../components/customer-meeting.jsx";
import { CustomProposalModal } from "../components/custom-proposal.jsx";
import { PaymentLinkModal } from "../components/payment-link-modal.jsx";
import { LeadSendActions, useLeadProposalActions } from "../components/lead-send-actions.jsx";
import { useData } from "../data.jsx";
import { DayPicker } from "../components/followup-contact.jsx";
import { followupBadge, followupNextContact, followupDayOf } from "../lib/followup.js";
import { CustomerCard } from "./tickets/customer-card.jsx";
import { LeadActiveProducts } from "../components/customer-active-products.jsx";
import { LeadCrmStrip, LeadLeverIdBadge, ProposalVersionsLine } from "../components/deal-meta.jsx";
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
// Atalho de próximo toque: N dias à frente, às 9h, e nunca no fim de semana.
// "+45d" é uma intenção ("daqui a um mês e meio"), não uma data exata, então
// cair num sábado só gera toque atrasado na segunda: sábado e domingo empurram
// pra segunda. Fica aqui em cima porque a lista de atalhos ficou longa e
// repetir o corpo em cada um escondia a única coisa que muda, o número de dias.
const emDias = (n) => () => {
  const t = new Date();
  t.setDate(t.getDate() + n);
  t.setHours(9, 0, 0, 0);
  const dia = t.getDay();
  if (dia === 6) t.setDate(t.getDate() + 2);
  else if (dia === 0) t.setDate(t.getDate() + 1);
  return t;
};

const isoToLocal = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? localDT(d) : "";
};
// callAt/integrationAt são naive ("YYYY-MM-DDTHH:MM") na esmagadora maioria, mas
// lead vindo de integração pode ter ISO com fuso — o input datetime-local NÃO
// renderiza esse formato, e o campo aparecia vazio num lead que tem call
// marcada. Converte só pra exibir; o próximo save regrava no formato canônico.
const dtLocal = (v) => (/([Zz]|[+-]\d{2}:?\d{2})$/.test(String(v || "")) ? isoToLocal(v) : (v || ""));
const localToIso = (v) => {
  if (!v) return "";
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : "";
};

// Editor explícito de data/hora: o DateTimeField (calendário + horários do
// cockpit, no lugar do datetime-local do navegador) escolhe um rascunho e só
// confirma depois que a API respondeu. O botão sempre visível deixa claro que
// escolher a data não basta: é preciso salvar o horário.
function DateTimeEditor({ value, onSave, validate, style, label = "Data e hora", saveLabel = "salvar horário" }) {
  const [status, setStatus] = React.useState(""); // "dirty" | "saving" | "saved"
  const stored = String(value || "");
  const [draft, setDraft] = React.useState(stored);

  React.useEffect(() => {
    setDraft(stored);
    setStatus((cur) => (cur === "saving" || cur === "saved") ? "saved" : "");
  }, [stored]);

  async function save() {
    const raw = draft || "";
    if (raw === stored) { setStatus(""); return; }
    const invalid = validate?.(raw) || "";
    if (invalid) {
      window.toast && window.toast(invalid, "neg");
      return;
    }
    setStatus("saving");
    let ok = false;
    try { ok = (await onSave(raw)) !== false; } catch { ok = false; }
    setStatus(ok ? "saved" : "dirty");
  }

  return (<>
    <span style={{ display: "inline-flex", width: 196, maxWidth: "100%" }}>
      <DateTimeField label={label} value={draft} disabled={status === "saving"} style={style}
        onChange={(v) => { setDraft(v); setStatus(v === stored ? "" : "dirty"); }} />
    </span>
    <button type="button" onClick={save} disabled={status !== "dirty"}
      className="mono" title="Salvar a nova data e hora"
      style={{ height: 26, padding: "0 9px", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", background: status === "dirty" ? "var(--accent)" : "var(--bg-2)", color: status === "dirty" ? "var(--accent-fg)" : status === "saved" ? "var(--pos)" : "var(--fg-4)", fontSize: 10.5, fontWeight: 700, cursor: status === "dirty" ? "pointer" : "default" }}>
      {status === "saving" ? "salvando…" : status === "saved" ? "salvo ✓" : saveLabel}
    </button>
  </>);
}

// Pendência do cliente concluída pela ficha: marca na hora, trava enquanto a
// API responde e desmarca se falhar.
function PendingCheck({ label, onDone }) {
  const [state, setState] = React.useState(""); // "" | "saving" | "done"
  return (
    <Checkbox label={label} checked={state !== ""} disabled={state !== ""}
      onChange={async () => {
        setState("saving");
        try { await onDone(); setState("done"); }
        catch (e) { setState(""); window.alert(e.message || "Não consegui concluir."); }
      }} />
  );
}
// Compromisso marcado com o cliente, no Próximo passo (30/10/2026). A call de
// venda e a integração usam o MESMO bloco, com o nome do compromisso escrito:
// antes as duas apareciam juntas (a call de venda já feita em cima da
// integração, sob o título genérico "Agenda e detalhes da call"), o convite
// ficava escondido em "Logística da call" e não havia "remarcar" nem
// "reenviar convite". Aqui: quando e com quem; entrar, reenviar e copiar o
// convite; remarcar e desmarcar. O resto (briefing, convidados, copiloto) vai
// em "mais opções". O servidor move o evento do Google junto com o horário
// novo (autoCallMeet/autoIntegrationMeet em google/routes.google.js).
function MeetingControls({ kind, lead, wa, busyMsg = "", conflict, onSaveAt, onClear, onCreateMeet, onSummarize, more = null }) {
  const integ = kind === "integracao";
  const name = integ ? "integração" : "call";
  const at = dtLocal(integ ? lead.integrationAt : lead.callAt);
  const url = integ ? lead.integrationCallUrl : lead.callUrl;
  const ms = brtMs(at);
  const started = Number.isFinite(ms) && ms <= Date.now();
  const over = Number.isFinite(ms) && ms + 60 * 60_000 < Date.now(); // passou a hora da reunião
  const googleOn = !!window.SEED?.CONFIG?.google?.connected;
  const aiOn = !!window.SEED?.CONFIG?.ai?.configured;
  const invite = url && !over ? meetingInviteText(lead, kind) : "";
  const [editing, setEditing] = React.useState(!at);
  const [busy, setBusy] = React.useState("");
  React.useEffect(() => { if (!at) setEditing(true); }, [at]);
  async function run(key, fn) { setBusy(key); try { await fn(); } finally { setBusy(""); } }
  async function copyInvite() {
    try { await navigator.clipboard.writeText(invite); window.toast?.("Convite copiado", "pos"); }
    catch { window.prompt(`Convite da ${name}:`, invite); }
  }
  const who = integ ? (lead.integrator || lead.closer) : lead.closer;
  const confirmed = integ ? lead.integrationConfirmed : lead.callConfirmed;
  const state = !at ? "" : over ? "já aconteceu" : started ? "acontecendo agora" : confirmed ? "confirmada" : "aguardando confirmação";
  const fresh = !at || over; // marcar do zero (nenhuma ou a anterior já foi)
  return (
    <div className="lead-meet">
      {at && (
        <div className="lead-meet-meta">
          {[formatDateTime(at), who && `com ${displayName(who)}`, state].filter(Boolean).join(" · ")}
        </div>
      )}
      {busyMsg && !over && <div className="lead-meet-warn" role="alert">{busyMsg}</div>}
      {at && !editing && (
        <div className="lead-meet-actions">
          {url && !over && <a className="lead-meet-btn is-primary" href={url} target="_blank" rel="noopener noreferrer" title={url}>Entrar na sala ↗</a>}
          {invite && wa && (
            <a className="lead-meet-btn is-wa" href={`${wa}?text=${encodeURIComponent(invite)}`} target="_blank" rel="noopener noreferrer"
              title="Abre o WhatsApp com dia, hora e link da sala">Reenviar convite ↗</a>
          )}
          {invite && <button type="button" className="lead-meet-btn" onClick={copyInvite} title="Copiar dia, hora e link da sala">Copiar convite</button>}
          {!url && !over && (googleOn
            ? <button type="button" className="lead-meet-btn is-primary" disabled={busy === "meet"} onClick={() => run("meet", onCreateMeet)}>{busy === "meet" ? "Criando sala…" : "Criar sala do Meet"}</button>
            : <span className="lead-meet-note">sem sala do Meet · conecte o Google em Ajustes</span>)}
          {started && aiOn && onSummarize && String(url || "").includes("meet.google.com") && (
            <button type="button" className="lead-meet-btn" disabled={busy === "sum"} onClick={() => run("sum", onSummarize)}
              title={`Buscar a transcrição no Google e gerar o resumo da ${name}`}>
              {busy === "sum" ? "resumindo…" : `✨ Resumir ${name}`}
            </button>
          )}
          <span className="lead-meet-links">
            <button type="button" onClick={() => setEditing(true)}>{over ? `marcar nova ${name}` : "remarcar"}</button>
            {!over && (
              <button type="button" onClick={() => {
                const msg = integ
                  ? "Desmarcar a integração? Ela sai da Agenda e o cliente recebe o cancelamento do convite do Google."
                  : "Desmarcar a call de venda? Ela sai da Agenda.";
                if (window.confirm(msg)) onClear();
              }}>desmarcar</button>
            )}
          </span>
        </div>
      )}
      {editing && (
        <div className="lead-meet-edit">
          <span className="lead-meet-label">{fresh ? `Marcar ${at ? `nova ${name}` : name}` : "Novo horário"}</span>
          <span className="lead-meet-edit-row">
            <DateTimeEditor value={fresh ? "" : at} future label={integ ? "Integração" : "Call de venda"}
              saveLabel={fresh ? "marcar" : "remarcar"}
              validate={(raw) => (raw && conflict?.(raw) ? (busyMsg || "Esse horário já está ocupado") : "")}
              onSave={async (raw) => { const ok = await onSaveAt(raw, { fresh }); if (ok) setEditing(false); return ok; }}
              style={{ height: 30, padding: "0 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 11.5, fontFamily: "var(--mono)" }} />
            {at && <button type="button" className="lead-meet-cancel" onClick={() => setEditing(false)}>cancelar</button>}
          </span>
          {googleOn && (
            <span className="lead-meet-note">
              {fresh ? "A sala do Meet é criada sozinha e o convite vai pro e-mail do cliente." : "O evento do Google muda junto e o cliente recebe o convite atualizado."}
            </span>
          )}
        </div>
      )}
      {more && (
        <details className="lead-meet-more">
          <summary>mais opções</summary>
          <div className="lead-meet-more-body">{more}</div>
        </details>
      )}
    </div>
  );
}

// Catálogo de atribuição e dor do criativo: helpers compartilhados com o
// pipeline (lib/pains.js) — cache por SaaS no módulo.

// Consulta (UniqueKids · mentoria R.O.T.I.N.A) — rótulos do painel de Meet que o
// card do lead centraliza pra quem tem uma consulta marcada (entra na sala, cria
// o Meet ou resume por aqui, sem abrir a tela de Consultas).
const CONSULTA_STATUS = { scheduled: "agendada", done: "realizada", no_show: "faltou", canceled: "cancelada" };

// Região de venda do funil (espelho do SOLD_KINDS do lead-flow.js): sair dela
// pro funil aberto desfaz o fechamento no servidor.
const SOLD_KINDS = new Set(["ganho", "integracao", "posvenda"]);
function consultaWhen(at) {
  if (!at) return "sem horário";
  const d = new Date(String(at).length === 16 ? `${at}:00` : at);
  if (Number.isNaN(d.getTime())) return String(at);
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(", ", " · ");
}

// Etapa do lead na ficha (06/10/2026). Antes eram "avançar etapa →" / "← voltar"
// pela ORDEM do funil, um <select> com todas as colunas e "marcar ganho": do
// Follow-up o avançar caía no Ganho, que as Atividades já tinham tirado (a
// Integração registra a venda). Agora o próximo passo é o MESMO do bloco das
// Atividades (destinationsFor + withoutWonStep, respeitando Ajustes → Próximos
// passos) e o resto do funil fica num seletor por fase, para exceções. Ganho só
// aparece em funil sem Integração. Tudo passa pelo moveStage (gates de
// fechamento/perda e o confirm de desfazer a venda). O rodapé da ficha do
// Pipeline usa o mesmo bloco (a coluna Ganho do quadro continua para o arraste).
const STAGE_GROUPS = [["sdr", "Pré-venda"], ["closer", "Venda"], ["entrega", "Entrega"], ["fim", "Encerrar"], ["", "Outras"]];
export function leadStageMoves(saasCfg, lead, isOpen) {
  const funnel = saasCfg?.funnel || [];
  const integ = stageByKind(saasCfg, "integracao");
  const next = isOpen
    ? withoutWonStep(saasCfg, lead, destinationsFor(saasCfg, lead)).filter((d) => !d.retry && d.stage !== lead.stage)
    : [];
  const shown = new Set([lead.stage, ...next.map((d) => d.stage)]);
  const group = (st) => { const k = stageKind(saasCfg, st); return STAGE_GROUPS.findIndex(([ph]) => ph === phaseOf(k)); };
  const others = funnel
    .filter((f) => f?.stage && !shown.has(f.stage) && !(integ && stageKind(saasCfg, f.stage) === "ganho"))
    .map((f, i) => { const g = group(f.stage); return { f, i, g: g === -1 ? STAGE_GROUPS.length - 1 : g }; })
    .sort((a, b) => a.g - b.g || a.i - b.i)
    .map(({ f, g }) => ({ value: f.stage, label: f.stage, tone: f.color || undefined, group: STAGE_GROUPS[g][1] }));
  return { next, others };
}

const stageColor = (saasCfg, st) => (saasCfg?.funnel || []).find((f) => f.stage === st)?.color || "var(--fg-4)";

function LeadStageSection({ saasCfg, lead, isOpen, onMove }) {
  return (
    <LeadSection title="Etapa" className="lead-stage"
      action={<span className="lead-stage-current"><i style={{ background: stageColor(saasCfg, lead.stage) }} />{lead.stage || "sem etapa"}</span>}>
      <LeadStageMoves saasCfg={saasCfg} lead={lead} isOpen={isOpen} onMove={onMove} />
    </LeadSection>
  );
}

// Destinos ("Mover para") + outra etapa. `compact` = rodapé da ficha do Pipeline: a etapa
// atual já está no topo da ficha, então o bloco não repete o título.
function LeadStageMoves({ saasCfg, lead, isOpen, onMove, compact = false }) {
  const color = (st) => stageColor(saasCfg, st);
  const { next, others } = leadStageMoves(saasCfg, lead, isOpen);
  const closes = next.some((d) => d.kind === "integracao" || d.kind === "ganho");
  return (
    <div className={"lead-stage-moves" + (compact ? " is-compact" : "")}>
      {next.length > 0 ? (
        <>
          <div className="kicker">Mover para</div>
          <div className="lead-stage-next">
            {next.map((d) => (
              <button key={d.stage} type="button" onClick={() => onMove(d.stage)}
                className={"lead-stage-chip" + (isLossKind(d.kind) ? " is-loss" : "")}>
                <i style={{ background: color(d.stage) }} />{d.stage} →
              </button>
            ))}
          </div>
          {closes && <p className="lead-stage-hint">Integração registra a venda e pede os dados do fechamento.</p>}
        </>
      ) : (
        <p className="lead-stage-hint">{isOpen ? "Sem próximo passo configurado para esta etapa." : "Lead fora da régua. Para retomar, escolha a etapa abaixo."}</p>
      )}
      {others.length > 0 && (
        <div className="lead-stage-other">
          <span className="kicker">{isOpen ? "Outra etapa" : "Reabrir em"}</span>
          <SelectPopover label="Mover para outra etapa" placeholder="escolher etapa…" value="" options={others} onChange={onMove} size="sm" />
        </div>
      )}
    </div>
  );
}

function LeadDetail({ lead: initial, onClose, onOpenWhatsapp, pipeline = false }) {
  const [scheduleEditor, setScheduleEditor] = React.useState(false);
  const { refresh, version } = useData();
  // Cópia local: as ações rápidas (etapa, próximo contato) editam aqui e
  // persistem otimisticamente; o pipeline ressincroniza no fechar (refresh).
  const [lead, setLead] = React.useState(initial);
  const dirty = React.useRef(false);
  const [editResumo, setEditResumo] = React.useState(false); // lápis do Resumo → edita inline
  const [showTimeline, setShowTimeline] = React.useState(false);
  const [showComposer, setShowComposer] = React.useState(false);
  const [customProp, setCustomProp] = React.useState(false); // modal da proposta personalizada
  const [payLink, setPayLink] = React.useState(false); // modal do link de pagamento (MP) do lead
  // Decks alternativos do produto (opção C · slides, Starter, Mentoria): o card
  // só oferecia o padrão, e a escolha de apresentação vivia só no roteiro do
  // Meu dia — que não serve pra quem trabalha pelo pipeline. Hook aqui em cima,
  // antes do `if (!lead) return null` lá embaixo.
  const [showFrom, setShowFrom] = React.useState(false); // atribuição do anúncio recolhida
  const [pendingMove, setPendingMove] = React.useState(null); // { toStage, gate }
  const [customerAnchor, setCustomerAnchor] = React.useState(null); // nome do cliente clicado → cartão do cliente
  // Timeline: fetch por lead (fora do bootstrap) + refetch quando o tempo real
  // avisa (version) — o drawer vive fora da árvore remontada do App.
  const [activities, setActivities] = React.useState(null);
  const [consultas, setConsultas] = React.useState(null); // consultas (UniqueKids) ligadas a este lead/cliente
  const [cBusy, setCBusy] = React.useState(""); // "meet" | "sum" enquanto a ação roda
  React.useEffect(() => { setLead(initial); setPendingMove(null); }, [initial?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (!initial?.id) return;
    let alive = true;
    api.listActivities(initial.id).then((a) => alive && setActivities(a)).catch(() => alive && setActivities([]));
    return () => { alive = false; };
  }, [initial?.id, version]);
  // O SEED vem SEM os campos que só este card lê (sourceUrl: "página de entrada"
  // da atribuição) — 1 MB a menos em todo bootstrap. Busca o lead inteiro ao
  // abrir e completa a cópia local sem sobrescrever o que já foi editado aqui.
  React.useEffect(() => {
    if (!initial?.id) return;
    let alive = true;
    api.get("leads", initial.id)
      .then((full) => { if (alive && full?.id) setLead((cur) => (cur && cur.id === full.id ? { ...cur, sourceUrl: full.sourceUrl } : cur)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [initial?.id]);
  // Consultas 1:1 ligadas a este lead OU cliente (UniqueKids) — pra centralizar o
  // Meet e o resumo da mentoria no próprio card, sem abrir a tela de Consultas.
  React.useEffect(() => {
    if (!initial?.id) return;
    let alive = true;
    api.list("consultations")
      .then((rows) => alive && setConsultas((rows || []).filter((c) =>
        (c.leadId && c.leadId === initial.id) || (initial.customerId && c.customerId && c.customerId === initial.customerId))))
      .catch(() => alive && setConsultas([]));
    return () => { alive = false; };
  }, [initial?.id, initial?.customerId, version]); // eslint-disable-line react-hooks/exhaustive-deps
  // A consulta em foco no card: a próxima agendada (ou a última, se já passaram).
  const consulta = React.useMemo(() => {
    const list = consultas || [];
    if (!list.length) return null;
    const now = Date.now();
    const upcoming = list.filter((c) => c.status === "scheduled" && c.at)
      .sort((a, b) => new Date(a.at) - new Date(b.at));
    return upcoming.find((c) => new Date(c.at).getTime() >= now - 2 * 3600 * 1000) || upcoming[0]
      || list.slice().sort((a, b) => (Number(b.n) || 0) - (Number(a.n) || 0))[0] || null;
  }, [consultas]);
  if (!lead) return null;
  const wa = waLink(lead.phone);
  const saasCfg = (window.SEED?.SAAS || []).find((s) => s.id === lead.saas);
  const kind = stageKind(saasCfg, lead.stage || (saasCfg?.funnel?.[0]?.stage ?? ""));
  const isOpen = workableStages(saasCfg).includes(lead.stage) || !lead.stage;
  // Destinos de UM CLIQUE pra um lead finalizado: tudo que não é perda, na ordem
  // do funil (inclui o Ganho — o caso que motivou isto é o desqualificado que
  // voltou e fechou). Reclassificar entre perdido/desqualificado fica no select.
  const reopenStages = (saasCfg?.funnel || [])
    .map((f) => f.stage)
    .filter((st) => st && st !== lead.stage && !isLossKind(stageKind(saasCfg, st)));

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
  // O que está ocupando importa: "já tem call" numa consulta da mentoria mandaria
  // o SDR procurar uma call que não existe.
  const callConflictInfo = (v) => {
    for (const k of callSlotKeys(v)) { const i = callBusy.info(k); if (i) return i; }
    return null;
  };
  const conflictAt = lead.callAt ? callConflictInfo(lead.callAt) : null;
  const callBusyMsg = !conflictAt ? ""
    : `${displayName(lead.closer) || "o closer"} já tem ${conflictAt.kind === "call" ? "call" : (conflictAt.reason || "compromisso")} nesse horário`;
  // Integração tem a MESMA régua da call: ocupa 1h na agenda do integrador e
  // avisa colisão antes de salvar.
  const integBusy = React.useMemo(
    () => integBusyKeys(window.SEED?.LEADS || [], lead.integrator, lead.id),
    [lead.integrator, lead.id],
  );
  const integConflict = (v) => callSlotKeys(v).some((k) => integBusy.has(k));
  const integConflictInfo = (v) => {
    for (const k of callSlotKeys(v)) { const i = integBusy.info(k); if (i) return i; }
    return null;
  };
  const integAt = lead.integrationAt ? integConflictInfo(lead.integrationAt) : null;
  const integBusyMsg = !integAt ? ""
    : `${displayName(lead.integrator) || "o integrador"} já tem ${integAt.kind === "call" ? "integração" : (integAt.reason || "compromisso")} nesse horário`;

  // Pacotes do produto (Lever CRM): aplicar um preenche os itens do fechamento
  // com o preço rateado por produto (billing/bundles.js).
  const [bundles, setBundles] = React.useState([]);
  React.useEffect(() => {
    let alive = true;
    if (lead.saas) api.bundles(lead.saas).then((r) => alive && setBundles(((r && r.bundles) || []).filter((b) => b.status === "active"))).catch(() => {});
    return () => { alive = false; };
  }, [lead.saas]);
  async function applyBundle(b) {
    try {
      const saved = await api.applyLeadBundle(lead.id, b.id);
      setLead((prev) => ({ ...prev, ...saved }));
      window.toast?.(`Pacote "${b.name}" aplicado: ${window.fmt.moneyFull(b.price)} em ${b.dealItems.length} produtos`, "pos");
    } catch (e) { window.toast?.(`${e.message || "Não foi possível aplicar o pacote"} · tente de novo`, "neg"); }
  }
  function patch(p) {
    dirty.current = true;
    setLead((prev) => ({ ...prev, ...p }));
    api.update("leads", lead.id, p).catch((err) => { console.warn("lead patch not persisted:", err.message); window.toast && window.toast("Alteração no lead não foi salva · tente de novo", "neg"); });
  }
  // Horário usa confirmação real: não atualiza o drawer otimisticamente. Assim
  // "salvo ✓" significa que a API respondeu, e uma falha deixa o botão pronto
  // para tentar de novo com o valor ainda digitado.
  async function persistSchedule(p) {
    try {
      const saved = await api.update("leads", lead.id, p);
      dirty.current = true;
      setLead((prev) => ({ ...prev, ...saved }));
      return saved;
    } catch (err) {
      console.warn("lead schedule not persisted:", err.message);
      window.toast && window.toast("Horário não foi salvo · tente de novo", "neg");
      return null;
    }
  }
  // Proposta direto no WhatsApp: garante a apresentação-mãe e cria/atualiza a
  // versão própria do CLIENTE com a oferta principal. O share roda no servidor
  // sobre o state.product salvo pela tela zero de "apresentar", então o cliente
  // recebe exatamente o produto decidido pelo closer, sem setup, sem edição e
  // com benefícios/preço já visíveis (nada depende de Espaço/Shift+Espaço).
  const { busy: propBusy, altDecks, generate: gerarCom, share: propostaNoWhats } = useLeadProposalActions({
    lead, onOpenWhatsapp,
    onSaved: fresh => { dirty.current = true; setLead(prev => ({ ...prev, ...fresh })); },
  });
  function moveStage(stage) {
    if (!stage || stage === lead.stage) return;
    // Espelho do applyStageMove: sair da região de venda (Ganho/Integração/CS)
    // pra uma etapa aberta DESFAZ o fechamento no servidor — o cliente e a
    // assinatura criados na venda somem da base. É irreversível demais pra
    // acontecer num clique distraído no select, então confirma antes.
    if (SOLD_KINDS.has(kind) && !SOLD_KINDS.has(stageKind(saasCfg, stage)) && (lead.customerId || lead.wonAt)
      && !window.confirm(`Tirar este lead de "${lead.stage}" DESFAZ o fechamento: o cliente e a assinatura criados na venda saem da base (cobrança real no Mercado Pago fica). Continuar?`)) return;
    const gate = moveGate(saasCfg, lead, stage);
    if (gate) { setPendingMove({ toStage: stage, gate }); return; }
    dirty.current = true;
    setLead((prev) => ({ ...prev, stage, stageSince: new Date().toISOString(), stageAttempts: 0 }));
    api.update("leads", lead.id, { stage }).catch((err) => { console.warn("lead move not persisted:", err.message); window.toast && window.toast(moveErrorText(err), "neg"); });
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
  // Ação da consulta (criar Meet / resumir) direto do card: roda, recarrega as
  // consultas do lead e mostra o erro sem quebrar o drawer.
  async function consultaAction(key, run) {
    setCBusy(key);
    try {
      await run();
      const rows = await api.list("consultations");
      setConsultas((rows || []).filter((c) =>
        (c.leadId && c.leadId === lead.id) || (lead.customerId && c.customerId && c.customerId === lead.customerId)));
    } catch (e) { window.alert(e?.message || "não deu certo"); }
    finally { setCBusy(""); }
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

  // Atribuição: resolve utm.campaign/term/content pra nomes via catálogo, e a
  // dor do criativo ("[X]" no nome do anúncio → rótulo do painMap do produto).
  const cat = useAttribution(lead.saas, !!lead.utm);
  const utm = lead.utm || {};
  const tier = leadTier(lead);
  // Lead que virou cliente: o vínculo gravado na venda (lead.customerId) ou o
  // cadastro que aponta pra este lead. O próprio nome no título vira o link
  // pro cartão do cliente (nada de linha nova no cabeçalho).
  const customer = (window.SEED?.CUSTOMERS || []).find((c) =>
    (lead.customerId && c.id === lead.customerId) || (c.leadId && c.leadId === lead.id)) || null;
  const leadName = customer
    ? <button type="button" className="lead-customer-link" title={`Ver dados do cliente ${customer.name}`}
        onClick={(e) => setCustomerAnchor(e.currentTarget)}>{lead.name}</button>
    : lead.name;
  // Resumo do cliente: MESMA compilação do roteiro do Meu dia (clientSummary em
  // components/lead-blocks.jsx), com `full` acrescentando no fim o que só a
  // ficha mostra (contato, integrador, perda). Os fatos de cima ficam idênticos
  // aos do painel de atividade — dado igual, rótulo igual, ordem igual.
  const { pain, facts: summaryFacts } = clientSummary(saasCfg, lead, lead.stage || (saasCfg?.funnel?.[0]?.stage ?? ""), cat, { full: true });

  // De onde veio: as duas primeiras linhas são as do roteiro (anúncio +
  // headline); a ficha continua mostrando a atribuição crua embaixo.
  const attribution = [
    ["Anúncio", cat?.ads?.[utm.content]?.name || utm.content],
    ["Headline do formulário", lead.formHeadline || (lead.formVariant ? `versão ${lead.formVariant}` : null)],
    ["Campanha", cat?.campaigns?.[utm.campaign]?.name || utm.campaign],
    ["Conjunto", cat?.adsets?.[utm.term]?.name || utm.term],
    ["Origem", [sourceLabel(utm), utm.medium].filter(Boolean).join(" / ") || null],
    ["Veio de", utm.referrer || null],           // referrer externo (orgânico/bio)
    ["Página de entrada", lead.sourceUrl || null],
  ].filter(([, v]) => v != null && v !== "");

  const next = nextTouchPill(lead, { isOpen, kind });
  // O compromisso QUE a etapa está esperando (o "próximo passo" de verdade):
  // call na etapa de call, integração na entrega, senão o toque do GPS. É o que
  // vira a linha grande no topo do bloco; o resto é contexto por fase.
  // Pós-venda não marca integração aqui: o editor dela só existe na etapa de
  // Integração, e a integração do cliente tem card próprio (bloco Cliente).
  const primaryStep = kind === "call" ? { label: "Call", verb: "agendar call" }
    : kind === "integracao" ? { label: "Integração", verb: "marcar integração" }
    : { label: "Próximo toque", verb: "marcar toque" };
  // Cartão: a MESMA caixa dos blocos compartilhados (lead-blocks.jsx), pra o
  // card e o painel de atividade terem o mesmo respiro.
  const box = leadBox;
  // Botão secundário da fileira de ações (32px, a altura do WaButton).
  const actBtn = { display: "inline-flex", alignItems: "center", height: 32, padding: "0 13px", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 12.5, fontWeight: 600, textDecoration: "none", cursor: "pointer" };
  const rowLabel = { fontSize: 11, width: 104, flexShrink: 0 };
  const presetBtn = { height: 32, padding: "0 13px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 11.5, fontWeight: 500 };
  // Linha rótulo→campo pra edição inline do Resumo.
  const editInput = { flex: 1, minWidth: 0, height: 28, padding: "0 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12.5 };
  const editPick = { height: 28, borderRadius: "var(--r-2)", borderColor: "var(--line-1)", background: "var(--bg-1)" };
  // div, não <label>: o clique numa opção do SelectPopover subia até o label
  // e reabria a lista. O grupo leva o nome do campo pro leitor de tela.
  const EditRow = ({ label, children }) => (
    <div role="group" aria-label={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span className="mono dim" style={{ width: 92, flexShrink: 0, fontSize: 10.5 }}>{label}</span>
      {children}
    </div>
  );

  // Roteiro do estágio + checklist editável dos dados do 1º contato — a MESMA
  // lógica (lib/scripts.js) e os MESMOS blocos do painel de atividade do Meu dia.
  const script = resolveScript(saasCfg, lead);
  const scriptTk = scriptTokens(lead, saasCfg, salesSummary);
  const checklist = scriptChecklist(saasCfg, lead);

  const funnel = saasCfg?.funnel || [];
  const history = mergeTimeline(timelineActs, lead.comments);
  const daysSince = (at) => at && Number.isFinite(new Date(at).getTime()) ? `${Math.max(0, Math.floor((Date.now() - new Date(at).getTime()) / 86400000))}d` : "—";

  const summaryCard = (
          <ClientSummaryCard
            pain={pipeline ? null : pain}
            facts={editResumo ? null : pipeline ? summaryFacts.filter(([key])=>["Potencial","Temperatura","Faixa de faturamento","Etapa","Toques na etapa","Valor","Origem","Indicado por","SDR / closer","Próximo passo (nota)","Proposta na mesa","Telefone","E-mail","Entrada"].includes(key)) : summaryFacts}
            action={(
              <button onClick={() => setEditResumo((v) => !v)} title={editResumo ? "Concluir edição" : "Editar os dados do cliente aqui mesmo"}
                style={{ marginLeft: "auto", height: 22, padding: "0 8px", borderRadius: "var(--r-1)", border: "1px solid " + (editResumo ? "var(--accent)" : "var(--line-2)"), background: editResumo ? "var(--accent)" : "var(--bg-1)", color: editResumo ? "var(--accent-fg)" : "var(--fg-3)", fontSize: 11 }}>
                {editResumo ? "✓ pronto" : "✎ editar"}
              </button>
            )}>
            {editResumo && (
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                <EditRow label="Nome"><input aria-label="Nome" defaultValue={lead.name || ""} onBlur={(e) => e.target.value !== (lead.name || "") && patch({ name: e.target.value })} style={editInput} /></EditRow>
                <EditRow label="Empresa"><input aria-label="Empresa" defaultValue={lead.company || ""} onBlur={(e) => e.target.value !== (lead.company || "") && patch({ company: e.target.value })} style={editInput} /></EditRow>
                <EditRow label="Prioridade">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <SelectPopover label="Prioridade" value={lead.priority || ""} onChange={(v) => patch({ priority: v })} style={editPick}
                      options={[{ value: "", label: "—" }, { value: "P0", label: "P0" }, { value: "P1", label: "P1" }, { value: "P2", label: "P2" }]} />
                  </div>
                </EditRow>
                <EditRow label={lead.planClosed === "mensal" ? "Valor mensal (R$)" : "Valor (R$)"}><input aria-label="Valor" type="text" inputMode="decimal" autoComplete="off" defaultValue={lead.amount ?? ""} onBlur={(e) => { const t = e.target.value.trim(); patch({ amount: t === "" ? "" : parseMoneyInput(t) }); }} style={editInput} /></EditRow>
                <EditRow label="Faixa"><input aria-label="Faixa" defaultValue={lead.value || ""} onBlur={(e) => e.target.value !== (lead.value || "") && patch({ value: e.target.value })} style={editInput} /></EditRow>
                <EditRow label="E-mail"><input aria-label="E-mail" defaultValue={lead.email || ""} onBlur={(e) => e.target.value !== (lead.email || "") && patch({ email: e.target.value })} style={editInput} /></EditRow>
                <EditRow label="Telefone"><input aria-label="Telefone" defaultValue={lead.phone || ""} onBlur={(e) => e.target.value !== (lead.phone || "") && patch({ phone: e.target.value })} style={editInput} /></EditRow>
                {[["Dono (SDR)", "owner", "sdr"], ["Closer", "closer", "closer"], ["Integrador", "integrator", "integrator"]].map(([label, field, role]) => {
                  const opts = usersByRole(role);
                  return (
                    <EditRow key={field} label={label}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <SelectPopover label={label} value={lead[field] || ""} onChange={(v) => patch({ [field]: v })} style={editPick}
                          options={[
                            { value: "", label: "—" },
                            ...opts.map((u) => ({ value: u.id, label: u.name || u.id })),
                            ...(lead[field] && !opts.some((u) => u.id === lead[field]) ? [{ value: lead[field], label: displayName(lead[field]) }] : []),
                          ]} />
                      </div>
                    </EditRow>
                  );
                })}
              </div>
            )}
          </ClientSummaryCard>
  );
  // Ações das salas do Meet (call de venda e integração), usadas pelo bloco
  // MeetingControls. Recarrega o lead depois de mexer no horário: a sala e o
  // convite nascem/mudam no servidor DEPOIS do PATCH responder.
  function reloadLead() {
    return api.get("leads", lead.id).then((fresh) => { if (fresh?.id) { dirty.current = true; setLead((prev) => ({ ...prev, ...fresh })); } }).catch(() => {});
  }
  async function saveCallAt(raw) {
    // Call anterior que já aconteceu vai pro histórico com a sala dela; a nova
    // ganha sala própria (mesma régua da 2ª reunião do Meu dia).
    const saved = await persistSchedule({ callAt: raw, ...secondCallPatch(lead) });
    if (!saved) return false;
    window.toast?.(lead.callAt ? "Call remarcada" : "Call marcada", "pos");
    reloadLead();
    return true;
  }
  // Integração passa pela rota do Remarcar de Minhas atividades: confere a
  // agenda do integrador, solta a sala da que já aconteceu e move o convite.
  async function saveIntegrationAt(raw, force = false) {
    try {
      const r = await api.integrationMeeting(lead.id, { at: raw, force });
      dirty.current = true;
      if (r?.lead) setLead((prev) => ({ ...prev, ...r.lead }));
      if (r?.meetError) window.toast?.(`Integração marcada, sem sala do Meet: ${r.meetError}`, "warn");
      else window.toast?.(lead.integrationAt ? "Integração remarcada · convite atualizado" : "Integração marcada", "pos");
      refetchTimeline();
      return true;
    } catch (e) {
      if (e.status === 409 && e.body?.reason === "previous_without_summary" && !force) {
        const ok = window.confirm(`A integração anterior ainda não tem resumo (${summaryReason(e.body.previous)}).\n\nSe remarcar agora, ela não será mais resumida automaticamente. Remarcar mesmo assim?`);
        return ok ? saveIntegrationAt(raw, true) : false;
      }
      window.toast?.(e.message || "Não foi possível marcar a integração", "neg");
      return false;
    }
  }
  async function createMeetFor(kind) {
    const integ = kind === "integracao";
    try {
      const r = await api.createMeet(lead.id, integ ? { kind: "integracao" } : undefined);
      dirty.current = true;
      setLead((prev) => ({ ...prev, ...(integ ? { integrationCallUrl: r.callUrl, integrationMeetEventId: r.eventId } : { callUrl: r.callUrl, meetEventId: r.eventId }) }));
      const cfg = r.meetConfig || {};
      const faltou = [!cfg.open && "entrada sem aprovação", !cfg.recording && "gravação automática", !cfg.transcription && "transcrição automática"].filter(Boolean);
      const motivo = cfg.errors ? ` Motivo do Google: ${Object.values(cfg.errors)[0]}` : "";
      // O calendário configurado no servidor pode não ser visível pela conta
      // conectada (404): a sala nasce mesmo assim, no calendário dela.
      if (r.fellBackFrom) window.alert(`Sala criada ✓ mas o calendário "${r.fellBackFrom}" não está acessível pela conta Google conectada, então o evento nasceu na agenda dela. Ajustes → Integrações mostra qual calendário está configurado.`);
      else if (r.meetConfig && faltou.length) window.alert(`Sala criada ✓ Mas não deu pra ativar: ${faltou.join(", ")}.${motivo}`);
      else window.toast?.("Sala do Meet criada", "pos");
    } catch (e) { window.alert(e.message || "Falha ao criar a sala do Meet."); }
  }
  async function summarizeFor(kind) {
    const integ = kind === "integracao";
    const nome = integ ? "integração" : "call";
    const url = integ ? lead.integrationCallUrl : lead.callUrl;
    try {
      let r = await api.callSummary(lead.id, false, integ ? "integracao" : undefined);
      if (!r.ok && r.reason === "already_done" && window.confirm(`Essa ${nome} já tem resumo. Gerar de novo?`)) {
        r = await api.callSummary(lead.id, true, integ ? "integracao" : undefined);
      }
      if (r.ok) {
        refetchTimeline();
        const f = r.summary?.followup;
        window.alert(integ
          ? `Resumo da integração pronto ✓ Cliente: ${r.summary?.sentimento || "?"}.`
          : `Resumo pronto ✓ Temperatura: ${r.summary?.temperatura || "?"}.${f?.quando ? " Próximo toque sugerido já foi agendado no GPS." : ""}`);
      } else if (r.reason === "call_in_progress" || r.reason === "transcript_not_ready") {
        // Quase sempre é a sala que ficou ABERTA (o Google só gera a
        // transcrição quando o último sai). Encerrar pela API não rola (o Meet
        // nasce do Calendar e a Meet API nega), então abrimos a sala.
        if (window.confirm(`A transcrição ainda não está no Google.${r.detail ? `\n\nMotivo: ${r.detail}` : ""}\n\nQuase sempre é a sala do Meet que ficou ABERTA (o Google só gera a transcrição quando o último participante sai).\n\nAbrir o Meet pra encerrar? Entre e clique em "Encerrar a chamada para todos" (ou saia, se estiver sozinho). Em alguns minutos a transcrição sai e o cockpit resume.`)) {
          window.open(url, "_blank", "noopener");
        }
      } else if (r.reason === "not_connected") {
        window.alert("Google não conectado. Ajustes → Integrações → Conectar Google.");
      } else if (r.reason) window.alert(`Não deu: ${r.reason}`);
    } catch (e) { window.alert(e.message || `Falha ao resumir a ${nome}.`); }
  }
  async function makeBrief() {
    try {
      let r = await api.integrationBrief(lead.id);
      if (!r.ok && r.reason === "already_done" && window.confirm("Esse lead já tem briefing. Gerar de novo?")) r = await api.integrationBrief(lead.id, true);
      if (r.ok) {
        refetchTimeline();
        window.alert(r.source === "resumo"
          ? "Briefing pronto ✓ (sem transcrição da call: saiu do resumo que a IA já tinha extraído, então confira antes de usar)"
          : "Briefing pronto ✓ (lido da transcrição da call de venda)");
      } else if (r.reason === "no_source") {
        window.alert("Sem fonte pra montar o briefing: essa venda não tem transcrição do Meet nem resumo de call. Gere o resumo da call primeiro ou registre o contexto na timeline.");
      } else if (r.reason) window.alert(`Não deu: ${r.reason}`);
    } catch (e) { window.alert(e.message || "Falha ao montar o briefing."); }
  }

  // Qual compromisso o card mostra. Integração: só ela (a call de venda já
  // ficou pra trás e confundia). Etapa de call: a call. Outras etapas de
  // pré-venda/venda com call marcada (proposta, no-show): a call recolhida
  // embaixo, pra remarcar ou resumir sem disputar com o próximo toque.
  const meetingStep = isOpen && (kind === "call" || kind === "integracao");
  const sideCall = isOpen && !meetingStep && ["sdr", "closer"].includes(phaseOf(kind)) && !!lead.callAt;
  const callMs = brtMs(dtLocal(lead.callAt));
  const sideCallOpen = sideCall && (isNoShowStage(lead.stage) || callMs > Date.now());
  const googleOn = !!window.SEED?.CONFIG?.google?.connected;
  const aiOn = !!window.SEED?.CONFIG?.ai?.configured;
  const callControls = (
    <MeetingControls key={`call-${lead.id}`} kind="call" lead={lead} wa={wa}
      busyMsg={callBusyMsg} conflict={callConflict}
      onSaveAt={saveCallAt} onClear={() => patch({ callAt: "" })}
      onCreateMeet={() => createMeetFor("call")} onSummarize={() => summarizeFor("call")}
      more={(googleOn || aiOn) ? (<>
        {googleOn && (
          <label className="lead-meet-field">
            <span>Convidados extras</span>
            <input type="text" placeholder="e-mails separados por vírgula (além do lead)" defaultValue={lead.meetGuests ?? ""}
              onBlur={(e) => e.target.value !== (lead.meetGuests || "") && patch({ meetGuests: e.target.value })}
              title="Entram como convidados do evento no Google Calendar quando a sala é criada (o e-mail do lead já vai automático)" />
          </label>
        )}
        {/* Copiloto: ouve a call pelo navegador e orienta em tempo real. */}
        {aiOn && <CallCopilot lead={lead} />}
      </>) : null} />
  );
  const scheduleCard = (
        <div style={{ ...box, display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <span className="kicker">Próximo passo</span>
            <div className="lead-panel-step">
              {!isOpen ? `Lead finalizado${lead.lostReason ? ` · ${lossReasonLabel(saasCfg, lead.lostReason)}` : ""}`
                : kind === "call" ? "Call de venda"
                : kind === "integracao" ? "Integração"
                : lead.nextActionNote || primaryStep.label}
            </div>
            {isOpen && <div className="lead-panel-deadline" style={{ color: next?.tone || "var(--fg-3)" }}>
              {next && next.key !== "none" ? next.text.replace(/^[◆●]\s*/, "") : `Sem horário · ${primaryStep.verb}`}
            </div>}
            {meetingStep && lead.nextActionNote && <div className="lead-meet-note" style={{ marginTop: 4 }}>{lead.nextActionNote}</div>}
          </div>
          {/* Follow-up em 4 contatos: o próximo passo é o DIA do contato da vez
              (sem horário, não ocupa a agenda). O registro do contato mora na
              atividade (Minhas atividades); aqui só o dia muda. */}
          {isOpen && kind === "followup" && (
            <div style={{ display: "grid", gap: 6 }}>
              <span className="mono dim" style={{ fontSize: 10.5 }}>
                {followupBadge(lead)} · dia do próximo contato (sem horário)
              </span>
              {followupNextContact(lead) > 0 && <DayPicker value={followupDayOf(lead.followupAt)} label="Dia do próximo contato"
                onChange={(day) => day && patch({ followupAt: day })} />}
            </div>
          )}
          {/* Próximo toque (etapas sem reunião): uma data e o que fazer. Os
              atalhos "hoje +1h / amanhã 9h / +2d / +1sem" saíram (30/10/2026):
              o calendário já resolve qualquer dia em dois cliques. */}
          {isOpen && !meetingStep && kind !== "followup" && (
            <div className="lead-meet-edit">
              <span className="lead-meet-edit-row">
                <DateTimeEditor value={isoToLocal(lead.nextActionAt)} label="Próximo toque" saveLabel="salvar"
                  onSave={async (raw) => !!(await persistSchedule({ nextActionAt: localToIso(raw) }))}
                  style={{ height: 30, padding: "0 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 11.5, fontFamily: "var(--mono)" }} />
                {lead.nextActionAt && (
                  <button type="button" className="lead-meet-cancel" onClick={() => patch({ nextActionAt: "", nextActionNote: "" })} title="Limpar próximo toque">limpar</button>
                )}
              </span>
              <input type="text" aria-label="O que fazer no próximo toque" placeholder="o que fazer nesse toque? (ex.: cobrar proposta)" defaultValue={lead.nextActionNote ?? ""}
                onBlur={(e) => e.target.value !== (lead.nextActionNote || "") && patch({ nextActionNote: e.target.value })}
                className="lead-meet-input" />
            </div>
          )}
          {isOpen && kind === "call" && callControls}
          {isOpen && kind === "integracao" && (
            <MeetingControls key={`integ-${lead.id}`} kind="integracao" lead={lead} wa={wa}
              busyMsg={integBusyMsg} conflict={integConflict}
              onSaveAt={(raw) => saveIntegrationAt(raw)} onClear={() => patch({ integrationAt: "" })}
              onCreateMeet={() => createMeetFor("integracao")} onSummarize={() => summarizeFor("integracao")}
              more={aiOn ? (
                // Briefing de passagem: o cockpit gera sozinho quando o card
                // entra aqui; este botão é o "gera agora" / "refaz".
                <button type="button" className="lead-meet-btn" onClick={(ev) => { const b = ev.currentTarget; b.disabled = true; makeBrief().finally(() => { b.disabled = false; }); }}
                  title="Lê a transcrição da call de venda e monta o briefing pro integrador (contexto, o que foi prometido, o que confirmar e o passo a passo)">
                  {lead.integrationBriefAt ? "✨ Refazer briefing" : "✨ Gerar briefing"}
                </button>
              ) : null} />
          )}
          {/* Compromissos do CLIENTE: o que ele ficou de fazer na integração,
              com prazo. Visível porque é a razão mais comum de ela estar parada. */}
          {isOpen && kind === "integracao" && lead.clientPending?.open > 0 && (
            <div>
              <div className="mono dim" style={{ fontSize: 10.5, marginBottom: 4 }}>
                aguardando o cliente ({lead.clientPending.open}
                {lead.clientPending.overdue ? ` · ${lead.clientPending.overdue} atrasado${lead.clientPending.overdue === 1 ? "" : "s"}` : ""})
              </div>
              {(lead.clientPending.items || []).map((it) => (
                <div key={it.task} style={{ display: "flex", alignItems: "flex-start", gap: 7, padding: "3px 0", fontSize: 12 }}>
                  <PendingCheck label={`Concluir: ${it.item}`} onDone={async () => { await api.taskComplete(it.task); refetchTimeline?.(); }} />
                  <span style={{ flex: 1, minWidth: 0 }}>{it.item}</span>
                  <span className="mono dim" style={{ fontSize: 10.5, flexShrink: 0 }}>{it.dueDate ? it.dueDate.slice(8, 10) + "/" + it.dueDate.slice(5, 7) : ""}</span>
                </div>
              ))}
            </div>
          )}
          {isOpen && (kind === "proposta" || kind === "followup") && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span className="mono dim" style={rowLabel}>Proposta</span>
              <input type="text" inputMode="decimal" autoComplete="off" aria-label="Valor da proposta (R$)" placeholder="Valor (R$)" defaultValue={lead.proposalValue ?? ""}
                onBlur={(e) => { const t = e.target.value.trim(); patch({ proposalValue: t === "" ? "" : parseMoneyInput(t) }); }}
                style={{ width: 110, height: 26, padding: "0 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 11.5, fontFamily: "var(--mono)" }} />
              <input type="text" placeholder="Período (ex: 12 meses)" defaultValue={lead.proposalPeriod ?? ""}
                onBlur={(e) => patch({ proposalPeriod: e.target.value })}
                style={{ flex: 1, height: 26, padding: "0 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 11.5 }} />
            </div>
          )}
          {/* Call de venda fora da etapa de call: recolhida, com o nome dela. */}
          {sideCall && (
            <details className="lead-meet-side" open={sideCallOpen || undefined}>
              <summary>
                <span>Call de venda</span>
                <small>{formatDateTime(dtLocal(lead.callAt))}{callMs < Date.now() ? " · já aconteceu" : ""}</small>
              </summary>
              {callControls}
            </details>
          )}
          {/* O que o cliente tem contratado e até quando (some se ainda não é cliente). */}
          {isOpen && kind === "integracao" && <LeadActiveProducts lead={lead} />}
          {/* Lead FINALIZADO (ganho/perdido/desqualificado): as únicas ações que
              fazem sentido são reclassificar ou REABRIR. Um clique manda o card
              de volta pra etapa escolhida pelos mesmos gates do board (call pede
              hora, ganho pede valor e pagamento) e o servidor limpa o motivo da
              perda sozinho no revival. */}
          {!isOpen && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="dim" style={{ fontSize: 11.5, lineHeight: 1.45 }}>
                {kind === "ganho"
                  ? "Tirar do Ganho desfaz o fechamento (o cliente e a assinatura criados na venda saem da base). Pra registrar churn, use a etapa de perda."
                  : `Reabrir devolve o card pro funil${lead.lostReason ? ` (o motivo “${lossReasonLabel(saasCfg, lead.lostReason)}” é apagado)` : ""} e o próximo toque volta a ser cobrado na fila do Meu dia.`}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <span className="mono dim" style={{ fontSize: 11, flexShrink: 0 }}>{kind === "ganho" ? "mover pra" : "reabrir em"}</span>
                {reopenStages.map((st) => (
                  <button key={st} onClick={() => moveStage(st)} style={presetBtn} title={`Mover este lead pra “${st}”`}>{st}</button>
                ))}
              </div>
            </div>
          )}
        </div>
  );
  const qualificationCard = (<>
          {/* Requalificação (Receita Previsível): a oportunidade que o SDR
              passou só CONTA quando o closer requalifica e ACEITA (fit + decisor
              + quer avançar). Aparece nas etapas do closer enquanto não houver
              aceite; devolver manda o card de volta pra qualificação com o
              motivo gravado no lead (o SDR vê no card). */}
          {isOpen && !lead.customerId && ["call", "proposta", "followup"].includes(kind) && (
            lead.oppAccepted ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: "var(--r-2)", background: "var(--pos-soft, var(--bg-inset))", border: "1px solid var(--line-1)", fontSize: 11.5, color: "var(--fg-3)" }}>
                <span style={{ color: "var(--pos)" }}>✓</span>
                <span>Oportunidade aceita{lead.oppAcceptedBy ? ` por ${displayName(lead.oppAcceptedBy)}` : ""} em {new Date(lead.oppAccepted).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</span>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "9px 10px", borderRadius: "var(--r-2)", background: "var(--warn-soft)", border: "1px solid var(--line-1)" }}>
                <div style={{ flex: "1 1 180px", minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>Oportunidade aguardando o seu aceite</div>
                  <div style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 1 }}>Requalifique: tem fit, o decisor participa e quer o próximo passo?</div>
                </div>
                <button onClick={() => patch({ oppAccepted: new Date().toISOString(), oppAcceptedBy: currentUser()?.id || "" })}
                  style={{ height: 28, padding: "0 12px", borderRadius: "var(--r-2)", border: "1px solid var(--pos)", background: "var(--pos)", color: "#fff", fontSize: 12, fontWeight: 600 }}>
                  ✓ aceitar
                </button>
                <button onClick={() => {
                  const nota = window.prompt("Por que está devolvendo pro SDR? (fica no card)");
                  if (nota == null) return;
                  patch({ oppReturned: new Date().toISOString(), oppReturnNote: nota, oppAccepted: "", oppAcceptedBy: "" });
                  const back = stageByKind(saasCfg, "qualificacao");
                  // stageByKind devolve o NOME da etapa (string) — ler `.stage`
                  // aqui deixava a devolução sem mover o card.
                  if (back) moveStage(back);
                }}
                  style={{ height: 28, padding: "0 12px", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 12 }}>
                  devolver pro SDR
                </button>
              </div>
            )
          )}
          {/* A devolução fica visível pro SDR retrabalhar com o motivo na mão. */}
          {lead.oppReturnNote && ["novo", "contato", "qualificacao"].includes(kind) && (
            <div style={{ padding: "7px 10px", borderRadius: "var(--r-2)", background: "var(--warn-soft)", border: "1px solid var(--line-1)", fontSize: 11.5, color: "var(--fg-2)" }}>
              <b>Devolvida pelo closer:</b> {lead.oppReturnNote}
            </div>
          )}

  </>);
  const meetingDetails = (<>
            {/* Briefing de passagem em cima de tudo: é o que o integrador lê
                primeiro quando abre o card que acabou de chegar nele. */}
            <IntegrationBriefCard brief={integrationBrief} phone={lead.phone}
              onSend={onOpenWhatsapp ? (msg) => onOpenWhatsapp(lead, msg) : null}
              deal={{
                amount: lead.amount, planClosed: lead.planClosed, paymentMethod: lead.paymentMethod,
                integrationAt: lead.integrationAt, integrationCallUrl: lead.integrationCallUrl,
              }} />
            {/* Resumo da última call por IA em cima dos insights do estágio
                (some quando o briefing já cobre a call de venda). */}
            <CallSummaryCard summary={showCallSummary ? callSummary : null} phone={lead.phone}
              onSend={onOpenWhatsapp ? (msg) => onOpenWhatsapp(lead, msg) : null} />
            <LeadDisclosure title="Roteiro da conversa" hint={lead.stage}>
              <ScriptBlocks script={script} tokens={scriptTk} />
            </LeadDisclosure>

            {/* UniqueKids: sugestão de solução da rotina (IA · método R.O.T.I.N.A),
                gerada do desafio + exemplo e editável pela Ana. Só aparece quando há desafio. */}
            {(lead.desafio || lead.desafio_exemplo) && <RoutineSuggestion lead={lead} patch={patch} />}

        {/* Consulta (UniqueKids): centraliza o Meet e o resumo da mentoria no
            card do lead — quem tem consulta marcada entra na sala, cria o Meet ou
            resume por aqui, sem precisar abrir a tela de Consultas. */}
        {consulta && (
          <div style={{ ...box, display: "flex", flexDirection: "column", gap: 9 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <span className="kicker" style={{ flexShrink: 0 }}>Consulta {consulta.n || "?"}/{consulta.packageTotal || 8}</span>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{consultaWhen(consulta.at)}</span>
              <span style={{ fontSize: 11.5, color: "var(--fg-4)" }}>{CONSULTA_STATUS[consulta.status] || consulta.status || ""}</span>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {consulta.meetUrl ? (
                <a href={consulta.meetUrl} target="_blank" rel="noreferrer"
                  style={{ height: 32, display: "inline-flex", alignItems: "center", padding: "0 14px", borderRadius: "var(--r-2)", background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, #fff)", fontSize: 12.5, fontWeight: 600, textDecoration: "none" }}>Entrar no Meet ↗</a>
              ) : (
                <button disabled={!!cBusy || !consulta.at}
                  onClick={() => consultaAction("meet", () => api.consultationMeet(consulta.id))}
                  title={consulta.at ? "cria o Meet no horário da consulta e envia o convite por e-mail" : "a consulta está sem horário"}
                  style={{ height: 32, padding: "0 14px", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 12.5, fontWeight: 600 }}>{cBusy === "meet" ? "criando…" : "Criar Meet"}</button>
              )}
              <button disabled={!!cBusy || !consulta.meetUrl}
                onClick={() => consultaAction("sum", () => api.consultationSummary(consulta.id, true))}
                title="busca a transcrição do Meet e resume (também acontece sozinho após a consulta)"
                style={{ height: 32, padding: "0 12px", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-3)", fontSize: 12.5 }}>{cBusy === "sum" ? "resumindo…" : "↻ Resumir com IA"}</button>
            </div>
            {!consulta.meetUrl && (
              <div className="dim" style={{ fontSize: 11 }}>
                {(consulta.clientEmail?.trim() || lead.email)
                  ? <>o convite (com o link do Meet) vai por e-mail pra <b>{consulta.clientEmail?.trim() || lead.email}</b></>
                  : "sem e-mail: o Meet é criado, mas ninguém recebe o convite"}
              </div>
            )}
            {consulta.summary?.resumo && (
              <div style={{ fontSize: 12, color: "var(--fg-3)", lineHeight: 1.5, borderTop: "1px solid var(--line-1)", paddingTop: 8 }}>
                <b style={{ color: "var(--fg-2)" }}>Resumo (IA):</b> {consulta.summary.resumo}
                {!!consulta.summary.tarefas?.length && <div style={{ marginTop: 4 }}><b>Tarefas:</b> {consulta.summary.tarefas.join(" · ")}</div>}
              </div>
            )}
          </div>
        )}


  </>);
  return (
    <>
      <Drawer onClose={close} label={`Lead · ${lead.name}`} largura={pipeline ? 428 : 520}
        style={pipeline ? {padding:"80px 18px 18px",background:"transparent"} : undefined}
        painelStyle={{ background: pipeline ? "var(--bg-1)" : "var(--bg-0)", overflow:pipeline?"hidden":"auto" }}>
        {pipeline ? <div className="pipeline-lead-panel">
          <header><LeadGrade tier={tier} size={28} placeholder/><div><div className="lead-panel-name-row"><h2>{leadName}</h2><LeadPhoneCopy phone={lead.phone} /><CallfaceButton variant="inline" phone={lead.phone} leadId={lead.id} /></div><p>{lead.company}</p></div><button aria-label="Fechar lead" onClick={close}>✕</button></header>
          <div className="pipeline-lead-body">
            {summaryCard}
            <LeadDisclosure title="Respostas do formulário" hint={`${checklist.filter(c=>c.value).length} de ${checklist.length}`}><LeadChecklist key={lead.id} checklist={checklist} onPatch={patch} leadId={lead.id}/></LeadDisclosure>
            <AttributionCard rows={attribution} open={showFrom} onToggle={()=>setShowFrom(v=>!v)} />
            <LeadDisclosure title="Histórico de ações" hint={`${history.length} registros`}>
              {activities===null ? <div role="status">Carregando histórico…</div> : <ActivityList activities={history}/>}
              <button className="lead-panel-button" onClick={()=>setShowComposer(v=>!v)}>{showComposer?"Fechar registro":"Registrar contato"}</button>
              {showComposer&&<ActivityComposer embedded lead={lead} onLogged={refetchTimeline}/>}
            </LeadDisclosure>
            <LeadDisclosure title="Anotações" hint={lead.recapNote?"com anotação":"sem anotação"}>
              <textarea aria-label="Anotações" defaultValue={lead.recapNote||""} onBlur={e=>{if(e.target.value!==(lead.recapNote||""))patch({recapNote:e.target.value});}} placeholder="o que ficou combinado, quem decide, objeção que apareceu…"/>
            </LeadDisclosure>
            {qualificationCard}
            <LeadSendActions lead={lead} busy={propBusy} altDecks={altDecks}
              onGenerate={gerarCom} onPayment={() => setPayLink(true)} onShare={propostaNoWhats}
              onCustom={() => setCustomProp(true)} onOpenWhatsapp={onOpenWhatsapp} />
          </div>
          <footer className="pipeline-lead-footer">
            <div><span>próximo passo</span><small style={{color:next?.tone}}>{next?.text?.replace(/^[◆●]\s*/,"")||"sem data"}</small></div>
            <strong>{isOpen?(lead.nextActionNote||primaryStep.label):"Lead finalizado"}</strong>
            <input aria-label="Nota do próximo toque" defaultValue={lead.nextActionNote||""} onBlur={e=>{if(e.target.value!==(lead.nextActionNote||""))patch({nextActionNote:e.target.value});}} placeholder="o que fazer nesse toque?"/>
            <div className="pipeline-lead-postpone"><span>adiar o toque</span>{[1,2].map(n=><button key={n} onClick={()=>patch({nextActionAt:emDias(n)().toISOString()})}>Adiar {n}d</button>)}<button onClick={()=>setScheduleEditor(true)}>Agendamento</button></div>
            <LeadStageMoves saasCfg={saasCfg} lead={lead} isOpen={isOpen} onMove={moveStage} compact />
          </footer>
        </div> : (
        <div className="lead-panel">
          <header className="lead-panel-header">
            <div className="lead-panel-title-row">
              <div>
                <div className="lead-panel-name-row">
                  <h2 className="lead-panel-title"><LeadGrade tier={tier} />{leadName}</h2>
                  <LeadLeverIdBadge lead={lead} />
                  <LeadPhoneCopy phone={lead.phone} />
                </div>
                <div className="lead-panel-subtitle">{[lead.company, lead.source].filter(Boolean).join(" · ")}</div>
              </div>
              <button className="lead-panel-close" onClick={close} aria-label="Fechar lead">✕</button>
            </div>
            <dl className="lead-panel-facts">
              <div><dt>valor</dt><dd className="tnum">{window.fmt.moneyFull(lead.amount || 0)}</dd></div>
              <div><dt>etapa</dt><dd>{lead.stage || "—"}</dd></div>
              <div><dt>no funil</dt><dd className="tnum">{daysSince(lead.createdAt)}</dd></div>
              <div><dt>tentativas</dt><dd className="tnum">{Number(lead.stageAttempts) || 0}</dd></div>
            </dl>
            <div className="lead-panel-owners">
              {[["SDR", lead.owner], ["Closer", lead.closer], ["Integrador", lead.integrator]].filter(([, id]) => id).map(([role, id]) => <span key={role}>{role} · {displayName(id)}</span>)}
              <span title={`Lead ${lead.id}`}>Nesta etapa · {daysSince(lead.stageSince || lead.createdAt)}</span>
            </div>
            {/* Tipo do negócio, tags e o caminho pro cliente e pra integração. */}
            <LeadCrmStrip lead={lead} onPatch={patch} onLeave={close} />
          </header>
          <div className="lead-panel-body">
          {/* Próximo passo e agendamento mantêm os handlers da ficha. */}
        {scheduleCard}

          {/* Uma fileira só (20/10/2026): o WhatsApp é a ação principal, no
              tamanho do botão verde do design system, ao lado das outras.
              Antes era um botão escuro de largura inteira + duas fileiras. */}
          <LeadSection title="A ação de agora">
            <div className="lead-panel-actions">
              {wa
                ? (onOpenWhatsapp
                  ? <WaButton onClick={() => onOpenWhatsapp(lead)} title="Abrir a conversa no Inbox do cockpit">WhatsApp</WaButton>
                  : <WaButton href={wa} title="Abrir no WhatsApp Web">WhatsApp ↗</WaButton>)
                : <button style={actBtn} onClick={() => setShowComposer(true)}>Registrar contato</button>}
              {/* Ligar pela Callface (29/10/2026): abre o discador deles com o
                  número e o id do card; a ligação volta pelo webhook e vira
                  toque na timeline. Some quando o número não é BR discável. */}
              <CallfaceButton phone={lead.phone} leadId={lead.id} />
              {(onOpenWhatsapp || wa) && (
                <button onClick={propostaNoWhats} disabled={propBusy} style={{ ...actBtn, opacity: propBusy ? 0.6 : 1 }}
                  title={lead.proposalUrl
                    ? "Abrir o WhatsApp Web com o produto escolhido em apresentar, já pronto para o cliente"
                    : "Gerar a apresentação e abrir o WhatsApp Web com a versão pronta para o cliente"}>
                  {propBusy ? "gerando…" : "proposta no Whats"}
                </button>
              )}
              {lead.proposal_edit_url && (
                <a href={lead.proposal_edit_url} target="_blank" rel="noreferrer" title="Abrir a apresentação do closer (tela zero com régua e SPIN)"
                  style={{ ...actBtn, borderColor: "var(--accent-line)", background: "var(--accent-soft)", color: "var(--accent)" }}>
                  apresentar ↗
                </a>
              )}
              {/* Link de pagamento à vista no CARD (Leo, 13/09): é o passo
                  seguinte à apresentação — quem fecha na call cobra sem procurar. */}
              <button onClick={() => setPayLink(true)} style={actBtn}
                title={lead.mpChargeUrl ? "Abrir/refazer o link de pagamento deste lead" : "Criar o link de pagamento deste lead (Mercado Pago, Asaas ou Appmax)"}>
                {lead.mpChargeUrl && lead.mpChargeKind === "recurring" ? "link da assinatura" : "link de pagamento"}
              </button>
              <MoreMenu size={32} label="Mais ações" items={[
                onOpenWhatsapp && wa && { label: "abrir no WhatsApp Web ↗", onClick: () => window.open(wa, "_blank", "noopener,noreferrer") },
                ...altDecks.map((t) => ({ label: `gerar ${t.pickLabel || t.name}`, onClick: () => gerarCom(t) })),
                ...bundles.map((b) => ({ label: `aplicar pacote: ${b.name}${lead.bundleId === b.id ? " ✓" : ""}`, onClick: () => applyBundle(b) })),
                lead.customProposalUrl && { label: "abrir proposta personalizada ↗", onClick: () => window.open(cockpitProposalUrl(lead.customProposalUrl), "_blank", "noreferrer") },
                { label: lead.customProposalUrl ? "editar proposta personalizada" : "montar proposta personalizada", onClick: () => setCustomProp(true) },
              ]} />
            </div>
            <ProposalVersionsLine lead={lead} />
          </LeadSection>

          <LeadStageSection saasCfg={saasCfg} lead={lead} isOpen={isOpen} onMove={moveStage} />

          <LeadSection title="Histórico" action={<button className="lead-script-copy-button" onClick={() => setShowComposer((v) => !v)} aria-expanded={showComposer}>{showComposer ? "fechar anotação" : "registrar contato"}</button>}>
            {showComposer && <div style={{ marginBottom: 14 }}><ActivityComposer embedded lead={lead} onLogged={refetchTimeline} /></div>}
            {activities === null ? <div className="lead-script-copy">Carregando histórico…</div> : <ActivityList activities={showTimeline ? history : history.slice(0, 3)} />}
            {history.length > 3 && <button className="lead-script-copy-button" style={{ marginTop: 10 }} onClick={() => setShowTimeline((v) => !v)}>{showTimeline ? "mostrar menos" : "ver histórico completo"}</button>}
          </LeadSection>
          {qualificationCard}
          {/* Resumo do cliente: MESMO bloco do painel de atividade (dor em
              destaque + os fatos na mesma ordem). O lápis é exclusivo da ficha:
              abre a edição INLINE dos campos do lead, no lugar do grid. */}
          {summaryCard}

          {/* De onde veio · atribuição do anúncio: mesmo bloco (e mesmo lugar,
              depois dos contatos) do painel de atividade. Recolhível porque a
              ficha lista a atribuição inteira. */}
          <AttributionCard rows={attribution} open={showFrom} onToggle={() => setShowFrom((v) => !v)} />

          <LeadDisclosure title="Dados do lead" hint={`${checklist.filter((c) => c.value).length} de ${checklist.length} preenchidos`}>
            <LeadChecklist key={lead.id} checklist={checklist} onPatch={patch} leadId={lead.id} />
          </LeadDisclosure>

          {meetingDetails}
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
          </div>
        </div>
        )}
      </Drawer>
      {pipeline&&scheduleEditor&&<Modal label="Agendamento do lead" onClose={()=>setScheduleEditor(false)} largura={520}>
        <div style={{padding:20}}><button className="lead-panel-button" onClick={()=>setScheduleEditor(false)}>Fechar agendamento</button>{scheduleCard}{meetingDetails}</div>
      </Modal>}

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
              applyGatedMove(p, extra, lead.id).then(refetchTimeline).catch((err) => { console.warn("movimento não persistido:", err.message); window.toast && window.toast(moveErrorText(err), "neg"); });
              setPendingMove(null);
            }}
          />
        )}

        {customProp && (
          <CustomProposalModal
            lead={lead}
            onClose={() => setCustomProp(false)}
            onSaved={(r) => { dirty.current = true; setLead((prev) => ({ ...prev, customProposalId: r.id, customProposalUrl: r.url })); }}
          />
        )}

        {payLink && (
          <PaymentLinkModal
            lead={lead}
            onClose={() => setPayLink(false)}
            onSaved={(r) => { dirty.current = true; setLead((prev) => ({ ...prev, ...(r.lead || {}) })); }}
          />
        )}

        {customer && customerAnchor && (
          <CustomerCard customer={customer} anchor={customerAnchor} note="cliente deste negócio"
            onOpenFile={close} onClose={() => setCustomerAnchor(null)} />
        )}
    </>
  );
}

export { LeadDetail };
