import React from "react";
import { Avatar, useEsc, WaButton } from "../atoms.jsx";
import { ActivityList, ActivityComposer } from "../components/timeline.jsx";
import { RoutineSuggestion } from "../components/routine-suggestion.jsx";
import { moveGate, MoveLeadModal, applyGatedMove } from "../components/stage-move.jsx";
import { clientSummary, leadBox, ClientSummaryCard, AttributionCard, LeadChecklist, ScriptBlocks } from "../components/lead-blocks.jsx";
import { waLink, leadTier, cockpitProposalUrl } from "../lib/ui.js";
import { stageKind, lossReasonLabel, nextTouchPill, workableStages, stageByKind, isLossKind } from "../lib/funnel.js";
import { displayName, usersByRole, currentUser } from "../lib/users.js";
import { PAYMENT_METHODS, CLOSED_PLANS, DEAL_PRODUCTS, dealProductLabel, dealProductsOf } from "../lib/payments.js";
import { api } from "../lib/api.js";
import { useAttribution } from "../lib/pains.js";
import { sourceLabel } from "../lib/sources.js";
import { resolveScript, scriptTokens, scriptChecklist } from "../lib/scripts.js";
import { CallSummaryCard, IntegrationBriefCard, callBusyKeys, callSlotKeys } from "./today.jsx";
import { CustomProposalModal } from "../components/custom-proposal.jsx";
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

// Editor explícito de data/hora. Mantém o input UNCONTROLLED para o Safari não
// apagar os pedaços enquanto a pessoa digita e só confirma depois que a API
// respondeu. O botão sempre visível deixa claro que escolher a data não basta:
// é preciso salvar o horário.
function DateTimeEditor({ value, onSave, validate, style }) {
  const inputRef = React.useRef(null);
  const [status, setStatus] = React.useState(""); // "dirty" | "saving" | "saved"
  const stored = String(value || "");

  React.useEffect(() => {
    if (inputRef.current && inputRef.current.value !== stored) inputRef.current.value = stored;
    setStatus((cur) => (cur === "saving" || cur === "saved") ? "saved" : "");
  }, [stored]);

  async function save() {
    const raw = inputRef.current?.value || "";
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
    <input ref={inputRef} type="datetime-local" defaultValue={stored} disabled={status === "saving"}
      onInput={(e) => setStatus(e.currentTarget.value === stored ? "" : "dirty")}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } }}
      style={style} />
    <button type="button" onClick={save} disabled={status !== "dirty"}
      className="mono" title="Salvar a nova data e hora"
      style={{ height: 26, padding: "0 9px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: status === "dirty" ? "var(--accent)" : "var(--bg-2)", color: status === "dirty" ? "var(--accent-fg)" : status === "saved" ? "var(--pos)" : "var(--fg-4)", fontSize: 10.5, fontWeight: 700, cursor: status === "dirty" ? "pointer" : "default" }}>
      {status === "saving" ? "salvando…" : status === "saved" ? "salvo ✓" : "salvar horário"}
    </button>
  </>);
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

function LeadDetail({ lead: initial, onClose, onOpenWhatsapp }) {
  useEsc(onClose); // drawer fecha no Esc; modal aberto por cima fecha primeiro (pilha)
  const { refresh, version } = useData();
  // Cópia local: as ações rápidas (etapa, próximo contato) editam aqui e
  // persistem otimisticamente; o pipeline ressincroniza no fechar (refresh).
  const [lead, setLead] = React.useState(initial);
  const dirty = React.useRef(false);
  const [editResumo, setEditResumo] = React.useState(false); // lápis do Resumo → edita inline
  const [showTimeline, setShowTimeline] = React.useState(false); // timeline recolhida por padrão
  const [showGps, setShowGps] = React.useState(false);   // Próximo passo: a linha grande fica sempre visível; isto abre os editores
  const [showCall, setShowCall] = React.useState(false); // "Detalhes da call" (vídeo/convidados) recolhido por padrão
  const [customProp, setCustomProp] = React.useState(false); // modal da proposta personalizada
  const [payLink, setPayLink] = React.useState(false); // modal do link de pagamento (MP) do lead
  const [showEntrega, setShowEntrega] = React.useState(false); // "Entrega" (briefing/vídeo integração) recolhido
  const [showFrom, setShowFrom] = React.useState(false); // atribuição do anúncio recolhida
  const [pendingMove, setPendingMove] = React.useState(null); // { toStage, gate }
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
  const [propBusy, setPropBusy] = React.useState(false);
  async function propostaNoWhats() {
    setPropBusy(true);
    // Abre ainda dentro do clique: depois dos awaits o navegador pode tratar a
    // nova aba como popup e bloquear. A navegação acontece quando o link do
    // cliente estiver pronto.
    const win = wa ? window.open("", "_blank") : null;
    try {
      if (!lead.proposta_id || !lead.proposalUrl) {
        await api.generateProposal(lead.id);
        const fresh = await api.get("leads", lead.id);
        setLead((prev) => ({ ...prev, ...fresh }));
        dirty.current = true;
      }
      const shared = await api.shareProposal(lead.id, 1);
      const url = shared?.url || "";
      if (!url) { if (win) win.close(); window.alert("Não consegui preparar a proposta deste produto."); return; }
      const msg = `Aqui está a proposta sobre a qual conversamos: ${url}`;
      // SEMPRE WhatsApp Web (decisão do Leo, 03/08): wa.me com o texto pronto,
      // independente de o produto ter número oficial conectado — quem envia a
      // proposta é o closer, do WhatsApp dele. O inbox segue existindo pros
      // outros fluxos; aqui só cai nele se o lead não tiver telefone.
      if (wa) {
        const whatsappUrl = `${wa}?text=${encodeURIComponent(msg)}`;
        if (win) win.location.replace(whatsappUrl);
        else window.open(whatsappUrl, "_blank", "noopener");
      }
      else if (onOpenWhatsapp) onOpenWhatsapp(lead, msg);
    } catch (e) {
      if (win) win.close();
      window.alert(e?.message || "não deu pra gerar/enviar a proposta");
    } finally { setPropBusy(false); }
  }
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
    api.update("leads", lead.id, { stage }).catch((err) => { console.warn("lead move not persisted:", err.message); window.toast && window.toast("O movimento do card não foi salvo · tente de novo", "neg"); });
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
  const primaryStep = kind === "call" ? { label: "Call", verb: "agendar call" }
    : (kind === "integracao" || kind === "posvenda") ? { label: "Integração", verb: "marcar integração" }
    : { label: "Próximo toque", verb: "marcar toque" };
  // Cartão: a MESMA caixa dos blocos compartilhados (lead-blocks.jsx), pra o
  // card e o painel de atividade terem o mesmo respiro.
  const box = leadBox;
  const rowLabel = { fontSize: 11, width: 104, flexShrink: 0 };
  const presetBtn = { height: 26, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 11.5, fontWeight: 500 };
  // Linha rótulo→campo pra edição inline do Resumo.
  const editInput = { flex: 1, minWidth: 0, height: 28, padding: "0 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12.5 };
  const EditRow = ({ label, children }) => (
    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span className="mono dim" style={{ width: 92, flexShrink: 0, fontSize: 10.5 }}>{label}</span>
      {children}
    </label>
  );

  // Roteiro do estágio + checklist editável dos dados do 1º contato — a MESMA
  // lógica (lib/scripts.js) e os MESMOS blocos do painel de atividade do Meu dia.
  const script = resolveScript(saasCfg, lead);
  const scriptTk = scriptTokens(lead, saasCfg, salesSummary);
  const checklist = scriptChecklist(saasCfg, lead);

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
        {/* Cabeçalho na MESMA anatomia do painel de atividade do Meu dia:
            rótulo do painel em cima e a linha de identidade com nome, nota do
            lead (A-E), etapa e empresa · telefone. Os chips de origem,
            temperatura e prioridade saíram: repetiam o "Resumo do cliente"
            logo abaixo. As AÇÕES ficam na linha de baixo, separadas da
            identidade. */}
        <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--line-1)", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "start", gap: 10 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="kicker">Lead · <span className="code">{String(lead.id).toUpperCase()}</span></div>
            <div style={{ fontSize: 16.5, fontWeight: 600, marginTop: 2, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {lead.name}
              {tier.grade && (
                <span className="tnum" title={`${tier.label} · soma de contas operadas + anúncios publicados`}
                  style={{ width: 18, height: 18, borderRadius: 5, display: "inline-flex", alignItems: "center", justifyContent: "center", background: tier.tone, color: tier.badgeFg, fontFamily: "var(--display)", fontSize: 11, fontWeight: 700 }}>{tier.grade}</span>
              )}
              {lead.stage && <span className="chip">{lead.stage}</span>}
              {(lead.company || lead.phone) && (
                <span className="mono dim" style={{ fontSize: 11 }}>{[lead.company, lead.phone].filter(Boolean).join(" · ")}</span>
              )}
              {(lead.owner || lead.closer) && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  {lead.owner && <span title={`SDR: ${displayName(lead.owner)}`}><Avatar id={lead.owner} name={displayName(lead.owner)} size={18} /></span>}
                  {lead.closer && <span title={`Closer: ${displayName(lead.closer)}`}><Avatar id={lead.closer} name={displayName(lead.closer)} size={18} /></span>}
                </span>
              )}
            </div>
            <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {/* Apresentação do CLOSER (link com a chave): abre a tela zero
                  com régua/produto/SPIN — é por aqui que a call roda. */}
              {lead.proposal_edit_url && (
                <a href={lead.proposal_edit_url} target="_blank" rel="noreferrer"
                  className="chip" title="Abrir a apresentação do closer (tela zero com régua e SPIN)"
                  style={{ color: "var(--accent-fg)", borderColor: "var(--accent)", background: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>
                  apresentar ↗
                </a>
              )}
              {/* Proposta PERSONALIZADA: pra quem fechou solução sob medida numa
                  conversa. Capa + o combinado (entregáveis + valor), no layout
                  do deck. Independe da proposta automática acima. */}
              {lead.customProposalUrl && (
                <a href={cockpitProposalUrl(lead.customProposalUrl)} target="_blank" rel="noreferrer"
                  className="chip" title="Abrir a proposta personalizada como o cliente vê"
                  style={{ color: "var(--accent)", borderColor: "var(--accent-line)", background: "var(--accent-soft)", fontWeight: 600, textDecoration: "none" }}>
                  personalizada ↗
                </a>
              )}
              {/* Enviar a proposta pro cliente: gera se faltar e abre o
                  WhatsApp com a mensagem pronta (link limpo do cliente). */}
              {(onOpenWhatsapp || wa) && (
                <button onClick={propostaNoWhats} disabled={propBusy} className="chip"
                  title={(lead.proposalUrl
                    ? "Abrir o WhatsApp Web com o produto escolhido em apresentar, já pronto para o cliente"
                    : "Gerar a apresentação e abrir o WhatsApp Web com a versão pronta para o cliente")}
                  style={{ cursor: "pointer", background: "var(--wa-brand)", borderColor: "var(--wa-brand)", color: "var(--wa-brand-fg)", fontWeight: 700 }}>
                  {propBusy ? "gerando…" : "➤ proposta no Whats"}
                </button>
              )}
              <button onClick={() => setCustomProp(true)} className="chip" title="Montar/editar uma proposta personalizada (objetiva)"
                style={{ cursor: "pointer" }}>
                {lead.customProposalUrl ? "editar personalizada" : "+ proposta personalizada"}
              </button>
              {/* Link de pagamento do MP pelo card: o checkout nasce com o id
                  do LEAD — o dinheiro entra no Financeiro rastreado à origem. */}
              <button onClick={() => setPayLink(true)} className="chip"
                title="Criar link de pagamento do Mercado Pago já rastreado pra este lead (o pagamento casa sozinho no Financeiro)"
                style={{ cursor: "pointer" }}>
                {lead.mpChargeUrl ? "link de pagamento" : "+ link de pagamento"}
              </button>
            </div>
          </div>
          <button onClick={close} aria-label="Fechar" className="mono dim" style={{ fontSize: 16, flexShrink: 0, width: 36, height: 36, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: "var(--r-2)" }}>✕</button>
        </div>

        {/* Corpo rolável: duas colunas (Cliente | Roteiro) — mesma divisão do
            painel de atividade do Meu dia. */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 18px", minHeight: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 16, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
            <div className="kicker" style={{ color: "var(--fg-3)" }}>Cliente</div>

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
                  style={{ height: 28, padding: "0 12px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 12 }}>
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
          {/* Resumo do cliente: MESMO bloco do painel de atividade (dor em
              destaque + os fatos na mesma ordem). O lápis é exclusivo da ficha:
              abre a edição INLINE dos campos do lead, no lugar do grid. */}
          <ClientSummaryCard
            pain={pain}
            facts={editResumo ? null : summaryFacts}
            action={(
              <button onClick={() => setEditResumo((v) => !v)} title={editResumo ? "Concluir edição" : "Editar os dados do cliente aqui mesmo"}
                style={{ marginLeft: "auto", height: 22, padding: "0 8px", borderRadius: "var(--r-1)", border: "1px solid " + (editResumo ? "var(--accent)" : "var(--line-2)"), background: editResumo ? "var(--accent)" : "var(--bg-1)", color: editResumo ? "var(--accent-fg)" : "var(--fg-3)", fontSize: 11 }}>
                {editResumo ? "✓ pronto" : "✎ editar"}
              </button>
            )}>
            {editResumo && (
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
            )}
          </ClientSummaryCard>

          {/* Contatos logo abaixo do resumo, como no painel de atividade (lá é
              "registrar contato · últimos contatos"). Aqui é a timeline COMPLETA
              e nasce recolhida: o histórico é consulta, não fluxo do dia. */}
          <div style={{ ...box, display: "flex", flexDirection: "column", ...(showTimeline ? { minHeight: 160 } : {}) }}>
            <button onClick={() => setShowTimeline((v) => !v)}
              title={showTimeline ? "Recolher a timeline" : "Abrir a timeline (histórico + registrar contato)"}
              className="kicker" style={{ display: "flex", alignItems: "center", width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
              <span>Contatos · timeline {activities ? `· ${timelineActs.length + (lead.comments?.length || 0)}` : ""}</span>
              <span style={{ marginLeft: "auto", fontSize: 10 }}>{showTimeline ? "▴ recolher" : "▾ registrar contato"}</span>
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

          {/* De onde veio · atribuição do anúncio: mesmo bloco (e mesmo lugar,
              depois dos contatos) do painel de atividade. Recolhível porque a
              ficha lista a atribuição inteira. */}
          <AttributionCard rows={attribution} open={showFrom} onToggle={() => setShowFrom((v) => !v)} />

          {/* Dados do lead: mesmo checklist, mesmo título do painel de atividade. */}
          <LeadChecklist checklist={checklist} onPatch={patch} leadId={lead.id} />

          {/* GPS: etapa (gateada) + próximo toque + call agendada, sem sair do
              drawer. RECOLHÍVEL: fechado, o cabeçalho segura o resumo (o pill
              de atraso continua visível). */}
        <div style={{ ...box, display: "flex", flexDirection: "column", gap: 10 }}>
          {/* A LINHA GRANDE: o compromisso REAL da etapa (call na etapa de call,
              integração na entrega, senão o toque), colorido por atrasado/hoje/
              futuro. É o "próximo passo"; etapa, call, proposta e entrega viram
              contexto por fase, recolhido abaixo. */}
          {/* Lead finalizado TAMBÉM abre: desqualificado/perdido que volta a
              falar (e às vezes fecha) precisa voltar pro funil por aqui — o
              bloco fechado virava beco sem saída e o jeito era abrir card novo,
              perdendo histórico, origem e proposta. */}
          <button onClick={() => setShowGps((v) => !v)}
            title={showGps ? "Recolher os editores" : isOpen ? "Editar etapa, toque, call…" : "Reabrir o lead: voltar pro funil ou mover de etapa"}
            style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
            <span className="kicker" style={{ flexShrink: 0 }}>Próximo passo</span>
            {!isOpen
              ? <span className="dim" style={{ fontSize: 12.5 }}>lead finalizado{lead.lostReason ? ` · ${lossReasonLabel(saasCfg, lead.lostReason)}` : ""}</span>
              : next && next.key !== "none"
                ? <span style={{ fontSize: 13.5, fontWeight: 700, color: next.tone }}>{primaryStep.label} <span style={{ fontWeight: 400, color: "var(--fg-4)" }}>·</span> {next.text.replace(/^[◆●]\s*/, "")}</span>
                : <span style={{ fontSize: 13, fontWeight: 600, color: "var(--warn)" }}>sem {primaryStep.label.toLowerCase()} · {primaryStep.verb}</span>}
            <span className="mono" style={{ marginLeft: "auto", fontSize: 10, color: "var(--fg-4)", flexShrink: 0 }}>{showGps ? "▴ recolher" : isOpen ? "▾ editar" : "▾ reabrir"}</span>
          </button>
          {showGps && isOpen && (<>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <span className="mono dim" style={{ ...rowLabel, paddingTop: 6 }}>Próximo toque</span>
            <div style={{ display: "flex", gap: 5, flex: 1, flexWrap: "wrap", alignItems: "center" }}>
              {/* Atalhos curtos tocam a semana; os longos (15 a 60 dias) são pra
                  quem pediu pra voltar depois, que hoje virava data digitada na
                  mão. Todos caem às 9h, começo do dia de trabalho. */}
              {[["hoje +1h", () => { const t = new Date(); t.setHours(t.getHours() + 1, 0, 0, 0); return t; }],
                ["amanhã 9h", () => { const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0); return t; }],
                ["+2d", emDias(2)],
                ["+1sem", emDias(7)],
                ["+15d", emDias(15)],
                ["+30d", emDias(30)],
                ["+45d", emDias(45)],
                ["+60d", emDias(60)]].map(([label, mk]) => (
                <button key={label} onClick={() => patch({ nextActionAt: mk().toISOString() })} style={presetBtn}>
                  {label}
                </button>
              ))}
              <DateTimeEditor value={isoToLocal(lead.nextActionAt)}
                onSave={async (raw) => {
                  const saved = await persistSchedule({ nextActionAt: localToIso(raw) });
                  return !!saved;
                }}
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
            <DateTimeEditor value={dtLocal(lead.callAt)}
              validate={(raw) => raw && callConflict(raw) ? (callBusyMsg || "Esse horário já está ocupado") : ""}
              onSave={async (raw) => {
                const saved = await persistSchedule(kind === "followup" && raw
                  ? { callAt: raw, nextActionAt: localToIso(raw) }
                  : { callAt: raw });
                return !!saved;
              }}
              style={{ height: 26, padding: "0 6px", borderRadius: "var(--r-2)", border: `1px solid ${callBusyMsg ? "var(--neg)" : "var(--line-1)"}`, background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 11, fontFamily: "var(--mono)" }} />
            {lead.callAt && (
              <button onClick={() => patch({ callAt: "" })} className="mono dim" style={{ fontSize: 11 }} title="Limpar call">limpar</button>
            )}
            <span className="mono dim" style={{ fontSize: 10, color: callBusyMsg ? "var(--neg)" : undefined }}>
              {callBusyMsg || "aparece na Agenda"}
            </span>
          </div>
          {/* Detalhes da call: link do vídeo + convidados extras, recolhidos —
              logística, não o "quando". */}
          <button onClick={() => setShowCall((v) => !v)}
            className="kicker" style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
            Detalhes da call
            <span style={{ marginLeft: "auto", fontSize: 10, flexShrink: 0, textTransform: "none", letterSpacing: 0 }}>{showCall ? "▴ recolher" : "▾ vídeo · convidados"}</span>
          </button>
          {showCall && (<>
          {/* Link de videochamada: evento com Meet na agenda (Google), salvo no
              lead e mandado pro Whats com 1 clique. */}
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
                  <a className="mono" style={{ fontSize: 11, color: "var(--wa-brand-deep)", textDecoration: "none", flexShrink: 0 }}
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
                        } else if (r.reason === "call_in_progress" || r.reason === "transcript_not_ready") {
                          // Quase sempre é a sala que ficou ABERTA (o Google só
                          // gera a transcrição quando o último sai). Encerrar
                          // pela API não rola: o Meet nasce do Google Calendar e
                          // a Meet API nega (403) — quem encerra é um humano na
                          // sala. Então abrimos o Meet pra o SDR encerrar/sair.
                          if (window.confirm(`A transcrição ainda não está no Google.${r.detail ? `\n\nMotivo: ${r.detail}` : ""}\n\nQuase sempre é a sala do Meet que ficou ABERTA (o Google só gera a transcrição quando o último participante sai).\n\nAbrir o Meet pra encerrar? Entre e clique em "Encerrar a chamada para todos" (ou saia, se estiver sozinho). Em alguns minutos a transcrição sai e o cockpit resume.`)) {
                            window.open(lead.callUrl, "_blank", "noopener");
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
                  title="Criar outro evento com Meet na agenda"
                  onClick={async () => {
                    if (!window.SEED?.CONFIG?.google?.connected) { window.alert("Conecte o Google em Ajustes pra criar o Meet da call."); return; }
                    try {
                      const r = await api.createMeet(lead.id);
                      dirty.current = true;
                      setLead((prev) => ({ ...prev, callUrl: r.callUrl, meetEventId: r.eventId }));
                    } catch (e) { window.alert(e.message || "Falha ao criar o Meet."); }
                  }}>
                  ↻
                </button>
              </>
            ) : window.SEED?.CONFIG?.google?.connected ? (
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
            ) : (
              <span className="mono dim" style={{ fontSize: 11 }}>conecte o Google em Ajustes pra criar o Meet da call</span>
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
          </>)}
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
                <input type="datetime-local" value={dtLocal(lead.integrationAt)} onChange={(e) => patch({ integrationAt: e.target.value })}
                  style={{ height: 26, padding: "0 6px", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 11, fontFamily: "var(--mono)" }} />
              </div>
              {/* Entrega: briefing pro integrador + vídeo/resumo da integração,
                  recolhidos — a DATA fica em cima, sempre visível. */}
              <button onClick={() => setShowEntrega((v) => !v)}
                className="kicker" style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
                Entrega
                <span style={{ marginLeft: "auto", fontSize: 10, flexShrink: 0, textTransform: "none", letterSpacing: 0 }}>{showEntrega ? "▴ recolher" : "▾ briefing · vídeo"}</span>
              </button>
              {showEntrega && (<>
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
                      <a className="mono" style={{ fontSize: 11, color: "var(--wa-brand-deep)", textDecoration: "none", flexShrink: 0 }}
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
                            // Sala aberta / sem transcrição: encerrar via API não
                            // rola (Meet do Calendar → 403), então abrimos o Meet
                            // pra o integrador encerrar/sair — aí o Google gera a
                            // transcrição e o poller resume.
                            else if (r.reason === "call_in_progress" || r.reason === "transcript_not_ready") {
                              if (window.confirm(`A transcrição ainda não está no Google.${r.detail ? `\n\nMotivo: ${r.detail}` : ""}\n\nQuase sempre é a sala do Meet que ficou ABERTA (o Google só gera a transcrição quando o último participante sai).\n\nAbrir o Meet pra encerrar? Entre e clique em "Encerrar a chamada para todos" (ou saia, se estiver sozinho). Em alguns minutos a transcrição sai e o cockpit resume.`)) {
                                window.open(lead.integrationCallUrl, "_blank", "noopener");
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
              </>)}
            </>
          )}
          </>)}
          {/* Lead FINALIZADO (ganho/perdido/desqualificado): as únicas ações que
              fazem sentido são reclassificar ou REABRIR. Um clique manda o card
              de volta pra etapa escolhida pelos mesmos gates do board (call pede
              hora, ganho pede valor e pagamento) e o servidor limpa o motivo da
              perda sozinho no revival. */}
          {showGps && !isOpen && (
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
          {/* mover etapa: demoted, no fim — a etapa é CONSEQUÊNCIA do trabalho,
              não o "próximo passo". Antes era a 1ª linha e confundia. Serve
              também de saída completa pro lead finalizado (inclui reclassificar
              a perda: desqualificado ↔ perdido). */}
          {showGps && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 2 }}>
              <span className="mono dim" style={{ fontSize: 11, flexShrink: 0 }}>mover etapa</span>
              <select value={lead.stage || ""} onChange={(e) => moveStage(e.target.value)}
                style={{ flex: 1, height: 26, padding: "0 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 12 }}>
                {(saasCfg?.funnel || []).map((f) => <option key={f.stage} value={f.stage}>{f.stage}</option>)}
                {saasCfg?.funnel?.every((f) => f.stage !== lead.stage) && lead.stage && <option value={lead.stage}>{lead.stage}</option>}
              </select>
            </div>
          )}
        </div>

          </div>

          {/* Coluna direita: o ROTEIRO do estágio (mesmo nome e mesma ordem do
              painel de atividade do Meu dia) + o que é da entrega/mentoria. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
            <div className="kicker" style={{ color: "var(--fg-3)" }}>Roteiro · {lead.stage || (saasCfg?.funnel?.[0]?.stage ?? "")}</div>
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
            {/* Como se comportar + objetivo + passo a passo: bloco único
                compartilhado com o painel de atividade — inclusive o "copiar"
                de cada fala, que só existia lá. */}
            <ScriptBlocks script={script} tokens={scriptTk} />

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
                  style={{ height: 32, padding: "0 14px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 12.5, fontWeight: 600 }}>{cBusy === "meet" ? "criando…" : "Criar Meet"}</button>
              )}
              <button disabled={!!cBusy || !consulta.meetUrl}
                onClick={() => consultaAction("sum", () => api.consultationSummary(consulta.id, true))}
                title="busca a transcrição do Meet e resume (também acontece sozinho após a consulta)"
                style={{ height: 32, padding: "0 12px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-3)", fontSize: 12.5 }}>{cBusy === "sum" ? "resumindo…" : "↻ Resumir com IA"}</button>
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

          </div>{/* fim coluna Roteiro */}
        </div>{/* fim grid duas colunas */}
        </div>

        {/* Rodapé no mesmo desenho do painel de atividade: o WhatsApp esticado
            (WaButton do DS). O "Web ↗" ao lado é da ficha, pra quem prefere
            atender do WhatsApp Web em vez do inbox. */}
        <div style={{ flexShrink: 0, padding: "10px 18px", borderTop: "1px solid var(--line-1)", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", background: "var(--bg-inset)" }}>
          {wa ? (
            <>
              {onOpenWhatsapp
                ? <WaButton block onClick={() => onOpenWhatsapp(lead)} title={`Abrir a conversa no inbox do cockpit · ${lead.phone}`}>WhatsApp</WaButton>
                : <WaButton block href={wa} title={`WhatsApp · ${lead.phone}`}>WhatsApp ↗</WaButton>}
              {onOpenWhatsapp && (
                <a href={wa} target="_blank" rel="noopener noreferrer" title={`Abrir no WhatsApp Web/app · ${lead.phone}`}
                  style={{ flex: "0 1 auto", textAlign: "center", padding: "10px 14px", background: "var(--bg-1)", color: "var(--fg-2)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", fontSize: 13.5, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}>
                  Web ↗
                </a>
              )}
            </>
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
              applyGatedMove(p, extra, lead.id).then(refetchTimeline).catch((err) => { console.warn("movimento não persistido:", err.message); window.toast && window.toast("O movimento do card não foi salvo · tente de novo", "neg"); });
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
      </div>
    </div>
  );
}

// Link de pagamento do LEAD (atalho do card): cria o checkout do MP com
// external_reference = lead — o pagamento entra no Financeiro já casado com a
// origem (e com o cliente quando o lead vira Ganho). Não cria fatura: fatura é
// do cliente, pós-Ganho. Gerar de novo substitui o link salvo no card.
//
// O bloco "fechamento" grava DIRETO os campos que o gate de Ganho usa
// (planClosed/amount/paymentMethod): pagamento confirmado + card virado, o
// cliente e a assinatura nascem com plano, duração e valor certos.
function PaymentLinkModal({ lead, onClose, onSaved }) {
  useEsc(onClose);
  const product = (window.SEED?.SAAS || []).find((s) => s.id === lead.saas);
  // Mesmo rótulo do servidor (PLAN_LABEL/PRODUCT_LABEL em routes.mp.js):
  // título default do checkout = produto do catálogo + plano.
  const PLAN_TITLE = { anual: "Plano Anual", semestral: "Plano Semestral", unico: "Serviço único" };
  const titleFor = (p, prod) => [dealProductLabel(prod, lead.saas) || product?.name || lead.saas, PLAN_TITLE[p] || "pagamento"].filter(Boolean).join(" · ");

  const [amount, setAmount] = React.useState(lead.mpChargeAmount || "");
  const [installments, setInstallments] = React.useState(12);
  const [plan, setPlan] = React.useState(lead.planClosed || "anual");
  const [dealProduct, setDealProduct] = React.useState(lead.dealProduct || "");
  const [contract, setContract] = React.useState(Number(lead.amount) > 0 ? String(lead.amount) : "");
  const [method, setMethod] = React.useState(lead.paymentMethod || "");
  const [payerEmail, setPayerEmail] = React.useState(lead.email || "");
  const [title, setTitle] = React.useState(lead.mpChargeTitle || titleFor(lead.planClosed || "anual", lead.dealProduct || ""));
  const [titleDirty, setTitleDirty] = React.useState(!!lead.mpChargeTitle);
  const [description, setDescription] = React.useState("");
  const [url, setUrl] = React.useState(lead.mpChargeUrl || "");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const wa = waLink(lead.phone);
  const inputStyle = { height: 36, padding: "0 12px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 13, width: "100%" };

  // Título acompanha produto e plano até o closer mexer nele na mão.
  function pickPlan(p) {
    setPlan(p);
    if (!titleDirty) setTitle(titleFor(p, dealProduct));
  }
  function pickProduct(prod) {
    setDealProduct(prod);
    if (!titleDirty) setTitle(titleFor(plan, prod));
  }

  async function create() {
    const value = Number(String(amount).replace(",", "."));
    if (!(value > 0)) { setErr("Informe o valor da cobrança."); return; }
    const contractValue = Number(String(contract).replace(",", "."));
    setBusy(true); setErr(null);
    try {
      const r = await api.mpLeadLink(lead.id, {
        amount: value, maxInstallments: Number(installments) || undefined,
        title: title.trim() || undefined, description: description.trim() || undefined,
        payerEmail: payerEmail.trim() || undefined,
        plan, product: dealProduct || undefined,
        contractValue: contractValue > 0 ? contractValue : undefined,
        paymentMethod: method || undefined,
      });
      setUrl(r.url || "");
      onSaved && onSaved(r);
    } catch (e) { setErr(e.message || "MP não respondeu"); }
    finally { setBusy(false); }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "oklch(0 0 0 / 0.45)", zIndex: 130, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(100%, 500px)", maxHeight: "90vh", overflowY: "auto", background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-pop)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Link de pagamento · {lead.name || "lead"}</div>
            <div className="mono dim" style={{ fontSize: 11, marginTop: 2 }}>{product?.name || lead.saas} · o pagamento entra no Financeiro já casado com este lead</div>
          </div>
          <button onClick={onClose} className="mono dim" style={{ fontSize: 15 }}>✕</button>
        </div>

        {/* O que o cliente vê ao abrir o checkout do MP. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="kicker accent">checkout</span>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 96px", gap: 8 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="kicker">Valor da cobrança (R$)</span>
              <input type="number" min="0" step="0.01" placeholder="0,00" value={amount} autoFocus
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") create(); }}
                style={{ ...inputStyle, fontFamily: "var(--mono)", textAlign: "right" }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="kicker">Parcelas até</span>
              <select value={installments} onChange={(e) => setInstallments(e.target.value)} style={inputStyle}>
                {[1, 3, 6, 12].map((n) => <option key={n} value={n}>{n}x</option>)}
              </select>
            </label>
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="kicker">Título no checkout</span>
            <input type="text" value={title} placeholder={titleFor(plan, dealProduct)}
              onChange={(e) => { setTitle(e.target.value); setTitleDirty(true); }}
              style={inputStyle} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="kicker">Descrição (opcional)</span>
            <input type="text" value={description} placeholder="ex.: 12 meses de LeverAds com contas ilimitadas"
              onChange={(e) => setDescription(e.target.value)}
              style={inputStyle} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="kicker">E-mail do pagador</span>
            <input type="email" value={payerEmail} placeholder="pré-preenche o checkout e reforça o casamento"
              onChange={(e) => setPayerEmail(e.target.value)}
              style={inputStyle} />
          </label>
        </div>

        {/* O combinado do negócio: mesmos campos do gate de Ganho — virar o
            card depois do pagamento vira 1 clique com tudo certo. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="kicker accent">fechamento</span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="kicker">Produto</span>
              <select value={dealProduct} onChange={(e) => pickProduct(e.target.value)} style={inputStyle}
                title="produto do catálogo da apresentação — vai pro card, pro cliente e pro card da Integração">
                <option value="">escolher…</option>
                {/* catálogo real do SaaS (SEED); sem catálogo, a lista estática */}
                {(dealProductsOf(lead.saas).length ? dealProductsOf(lead.saas) : DEAL_PRODUCTS).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="kicker">Plano · duração</span>
              <select value={plan} onChange={(e) => pickPlan(e.target.value)} style={inputStyle}>
                {CLOSED_PLANS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="kicker">Valor do contrato (R$)</span>
              <input type="number" min="0" step="0.01" placeholder="se a cobrança for só a entrada" value={contract}
                onChange={(e) => setContract(e.target.value)}
                title="valor do negócio inteiro — a cobrança do link pode ser só a entrada"
                style={{ ...inputStyle, fontFamily: "var(--mono)", textAlign: "right" }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="kicker">Forma combinada</span>
              <select value={method} onChange={(e) => setMethod(e.target.value)} style={inputStyle}>
                <option value="">escolher…</option>
                {PAYMENT_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
          </div>
          <div className="mono dim" style={{ fontSize: 10.5 }}>
            esses campos vão pro card: quando o pagamento cair e você virar pra Ganho, cliente e assinatura já nascem com produto, plano, duração e valor certos
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button onClick={create} disabled={busy}
            style={{ height: 36, padding: "0 16px", borderRadius: "var(--r-2)", background: "var(--btn-bg)", color: "var(--btn-fg)", fontSize: 12.5, fontWeight: 600, opacity: busy ? 0.6 : 1 }}>
            {busy ? "gerando…" : (url ? "gerar novo link" : "gerar link")}
          </button>
        </div>

        {err && <div className="mono" style={{ fontSize: 12, color: "var(--neg)" }}>{err}</div>}

        {url && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 12px", borderRadius: "var(--r-2)", background: "var(--bg-inset)", border: "1px solid var(--line-1)", minWidth: 0 }}>
            <span className="mono" style={{ flex: 1, fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={url}>{url}</span>
            <button className="mono dim" style={{ fontSize: 11, flexShrink: 0 }} title="Copiar link"
              onClick={() => { try { navigator.clipboard.writeText(url); } catch { window.prompt("Link:", url); } }}>
              copiar
            </button>
            {wa && (
              <a className="mono" style={{ fontSize: 11, flexShrink: 0, color: "var(--accent)", textDecoration: "none" }}
                href={`${wa}?text=${encodeURIComponent(`Segue o link pra pagamento: ${url}`)}`}
                target="_blank" rel="noopener noreferrer" title="Enviar o link pro lead no WhatsApp">mandar no Whats ↗</a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export { LeadDetail };
