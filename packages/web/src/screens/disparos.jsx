import React from "react";
import "./marketing.css";
import "./disparos.css";
import { InfoNota } from "../components/story.jsx";
import { SelectPopover } from "../components/select-popover.jsx";
import { Modal } from "../components/overlay.jsx";
import { EmptyState, PrimaryButton, SecondaryButton } from "../atoms.jsx";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { useActiveSaas } from "../lib/workspace.js";
import { waLink } from "../lib/ui.js";
import { currentUser } from "../lib/users.js";
import { stageKind, workableStages } from "../lib/funnel.js";
import { WaHealthBanner } from "../components/wa-health-banner.jsx";
import { WaTemplateManager } from "../components/wa-template-manager.jsx";
import { useSwr } from "../lib/swr.js";
import { CAMPAIGN_TOKENS, campaignTokens, interpolate } from "../../../api/src/shared/campaign-tokens.js";
import { broadcastDailyCap, tierLimit } from "../../../api/src/shared/wa-tier.js";

// Disparos (docs/PLANO-DISPAROS.md): mensagens em massa para a base, por canal.
// Abas: Broadcasts (envio único, o canal é escolhido primeiro) · Sequências
// (automáticas, por etapa) · Fila do WhatsApp (passos de sequência que o time
// manda à mão) · Modelos (livres e os oficiais da Meta).
// WhatsApp sai pela API oficial com modelo aprovado, em lotes no servidor;
// e-mail sai pelo provedor de Configurações → Integrações (Resend ou Gmail).
// Na API e no banco o broadcast continua sendo a coleção `campaigns`.
// Menus suspensos: SelectPopover (o seletor do Cockpit), nunca o <select>
// nativo do navegador (pedido do Yudi em 22/10/2026), em todas as abas. Ele não
// pode ficar dentro de <label> (o clique na opção reabre a lista): rótulo é div.

const { useState: useS, useEffect: useE, useMemo: useM, useRef: useR } = React;

// Kinds que contam como "qualificado + Nutrição" (o público padrão).
const QUALIFIED_KINDS = new Set(["qualificacao", "call", "proposta", "followup", "contato"]);
const CH_LABEL = { email: "E-mail", whatsapp: "WhatsApp", both: "WhatsApp + E-mail" };
const STATUS_LABEL = { draft: ["", "rascunho"], sending: ["warn", "enviando"], paused: ["neg", "pausado"], done: ["pos", "concluído"] };
const TABS = [["broadcasts", "Broadcasts"], ["sequencias", "Sequências"], ["fila", "Fila do WhatsApp"], ["modelos", "Modelos"]];
const LEGACY_TAB = { disparos: "broadcasts", templates: "modelos" };

// Canal do broadcast. Os antigos (antes de 22/10/2026) não têm `channel`: o de
// WhatsApp era assistido (abria o app do operador) e fica só para consulta.
export const channelOf = (c) => c?.channel || (c?.channels?.email && !c?.channels?.whatsapp ? "email" : "whatsapp-assistido");
const daysSince = (at) => {
  if (!at) return "—";
  const d = Math.max(0, Math.floor((Date.now() - new Date(at).getTime()) / 86400e3));
  return d === 0 ? "hoje" : d === 1 ? "ontem" : `há ${d} dias`;
};

function useDraftGuard(value, leaveRef, busy = false) {
  const snapshot = JSON.stringify(value);
  const saved = useR(snapshot);
  const dirty = saved.current !== snapshot;
  const confirm = () => !busy && (!dirty || window.confirm("Descartar as alterações não salvas?"));
  useE(() => {
    if (leaveRef) leaveRef.current = confirm;
    return () => { if (leaveRef) leaveRef.current = null; };
  });
  useE(() => {
    if (!dirty) return;
    const warn = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  return { confirm, clean: (next = value) => { saved.current = JSON.stringify(next); } };
}
const sequenceDraft = (s) => ({ name: s.name, status: s.status, trigger: s.trigger, exitOn: s.exitOn, steps: s.steps });
const emptyTemplate = () => ({ id: null, channel: "email", name: "", subject: "", body: "", text: "" });

function DisparosScreen(props) {
  const [product] = useActiveSaas();
  return <DisparosWorkspace key={product?.id} {...props} />;
}

function DisparosWorkspace({ onOpenLead }) {
  const { version } = useData();
  const [product] = useActiveSaas();
  const leads = useM(() => (window.SEED?.LEADS || []).filter((l) => l.saas === product?.id), [product?.id, version]);
  const stageOptions = useM(() => workableStages(product), [product?.id, version]);
  // Sequências podem disparar do funil inteiro (onboarding no Ganho, reativação no Desqualificado).
  const allStages = useM(() => (product?.funnel || []).map((f) => f?.stage).filter(Boolean), [product?.id, version]);
  const defaultStages = useM(() => stageOptions.filter((st) => QUALIFIED_KINDS.has(stageKind(product, st))), [stageOptions, product?.id, version]);
  const [tab, setTabState] = useS(() => {
    try { const t = localStorage.getItem("cockpit_disparos_tab") || "broadcasts"; return LEGACY_TAB[t] || (TABS.some(([k]) => k === t) ? t : "broadcasts"); } catch { return "broadcasts"; }
  });
  const leaveRef = useR(null);
  const [tabBusy, setTabBusy] = useS(false);
  const setTab = (t) => {
    if (t === tab || tabBusy || (leaveRef.current && !leaveRef.current())) return;
    setTabState(t);
    try { localStorage.setItem("cockpit_disparos_tab", t); } catch { /* ignore */ }
  };
  if (!product) return <EmptyState title="Sem produto ativo" hint="Escolha um produto no seletor da barra lateral." />;
  const common = { product, leads, onBusy: setTabBusy, leaveRef };
  return <div className="marketing-page disparos-page" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
    <header className="disparos-head"><h1>Disparos</h1>
      <div className="disparos-tabs" aria-label="Seções de disparos">{TABS.map(([id, label]) => <button key={id} disabled={tabBusy} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}</div>
    </header>
    {tab === "broadcasts" && <BroadcastsTab key={`bc-${product.id}`} {...common} stageOptions={stageOptions} defaultStages={defaultStages} onOpenLead={onOpenLead} goTab={setTab} />}
    {tab === "sequencias" && <SequencesTab key={`seq-${product.id}`} {...common} stageOptions={allStages} />}
    {tab === "fila" && <QueueTab key={`fila-${product.id}`} {...common} />}
    {tab === "modelos" && <ModelsTab key={`mod-${product.id}`} {...common} />}
  </div>;
}

// ─────────────────────────────────────────────── Broadcasts ─────────────────
function BroadcastsTab({ product, leads, stageOptions, defaultStages, onOpenLead, onBusy, leaveRef, goTab }) {
  const [list, setList] = useS([]);
  const [metrics, setMetrics] = useS([]);
  const [filter, setFilter] = useS("all");
  const [open, setOpen] = useS(null); // broadcast aberto no editor (ou { id: null } para novo)
  const [readError, setReadError] = useS("");
  const [loading, setLoading] = useS(true);
  const readVersion = useR(0);
  async function reload() {
    const v = ++readVersion.current;
    setLoading(true); setReadError("");
    const [cs, ms] = await Promise.allSettled([api.list("campaigns", { saas: product.id }), api.campaignMetrics(product.id)]);
    if (v !== readVersion.current) return;
    if (cs.status === "fulfilled") setList(Array.isArray(cs.value) ? cs.value : []);
    if (ms.status === "fulfilled") setMetrics(Array.isArray(ms.value?.campaigns) ? ms.value.campaigns : []);
    if (cs.status === "rejected" || ms.status === "rejected") setReadError("Não foi possível atualizar os broadcasts. Os dados anteriores foram mantidos.");
    setLoading(false);
  }
  useE(() => { reload(); return () => { readVersion.current++; }; }, [product.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (open) return <BroadcastEditor key={open.id || "novo"} initial={open} product={product} leads={leads} stageOptions={stageOptions} defaultStages={defaultStages}
    onOpenLead={onOpenLead} onBusy={onBusy} leaveRef={leaveRef} goTab={goTab} onClose={() => { setOpen(null); reload(); }} />;

  const mById = Object.fromEntries(metrics.map((m) => [m.id, m]));
  const rows = [...list].filter((c) => { const ch = channelOf(c); return filter === "all" || ch.startsWith(filter) || ch === "both"; })
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const counts = (c) => {
    const vals = Object.values(c.sent || {});
    const sent = vals.filter((s) => (s?.whatsapp && s?.waStatus !== "failed") || s?.email).length;
    return { sent, queued: vals.filter((s) => s?.waStatus === "queued").length, failed: vals.filter((s) => s?.waStatus === "failed").length };
  };
  return <div className="marketing-body disparos-tab" style={{ flex: 1, overflow: "auto" }}>
    <WaHealthBanner style={{ margin: 0 }} />
    {readError && <div role="alert" className="disparos-error">{readError} <button onClick={reload}>Tentar novamente</button></div>}
    <section className="marketing-card">
      <div className="marketing-toolbar" style={{ flexWrap: "wrap", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="card-title">Broadcasts</div>
          <div className="card-sub">uma mensagem para muitos leads de uma vez · WhatsApp pela API oficial ou e-mail</div>
        </div>
        <div role="group" aria-label="Filtrar por canal" style={{ display: "flex", gap: 6 }}>
          {[["all", "Todos"], ["whatsapp", "WhatsApp"], ["email", "E-mail"]].map(([k, l]) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={`chip ${filter === k ? "accent" : ""}`} style={{ height: 28, cursor: "pointer" }}>{l}</button>)}
        </div>
        <PrimaryButton onClick={() => setOpen({ id: null })}>+ Novo broadcast</PrimaryButton>
      </div>
      {loading && !list.length && <div role="status" className="dim" style={{ padding: 16 }}>Carregando broadcasts…</div>}
      {!loading && !rows.length && <EmptyState title={filter === "all" ? "Nenhum broadcast ainda" : "Nenhum broadcast neste canal"} hint="Escolha o canal, o público e a mensagem; o envio sai em lotes, com prévia antes." action={<PrimaryButton onClick={() => setOpen({ id: null })}>+ Novo broadcast</PrimaryButton>} />}
      {rows.length > 0 && <div className="tbl-x"><table className="disparos-table" style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>{["Canal", "Broadcast", "Status", "Enviados", "Avançaram", "Calls", "Ganhos"].map((h, i) => <th key={h} className="kicker" style={{ padding: "8px 10px", textAlign: i >= 3 ? "right" : "left" }}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((c) => {
          const ch = channelOf(c);
          const st = STATUS_LABEL[c.status] || STATUS_LABEL.draft;
          const m = mById[c.id] || {};
          const n = counts(c);
          return <tr key={c.id} onClick={() => setOpen(c)} style={{ cursor: "pointer" }} title="abrir broadcast">
            <td style={{ padding: "9px 10px", borderTop: "1px solid var(--line-1)", fontSize: 12.5 }}>{ch === "whatsapp-assistido" ? "WhatsApp (assistido, antigo)" : CH_LABEL[ch]}</td>
            <td style={{ padding: "9px 10px", borderTop: "1px solid var(--line-1)", fontSize: 13, fontWeight: 600 }}><span>{c.name || "sem nome"}</span>{c.pauseReason ? <div style={{ fontSize: 11.5, fontWeight: 400, color: "var(--neg)" }}>{c.pauseReason}</div> : null}</td>
            <td style={{ padding: "9px 10px", borderTop: "1px solid var(--line-1)" }}><span className={`chip ${st[0]}`} style={{ height: 20 }}>{st[1]}</span>{n.queued ? <span className="dim" style={{ fontSize: 11.5, marginLeft: 6 }}>{n.queued} na fila</span> : null}</td>
            <td className="tnum" style={{ padding: "9px 10px", borderTop: "1px solid var(--line-1)", textAlign: "right" }}>{n.sent}{n.failed ? <span style={{ color: "var(--neg)", fontSize: 11.5 }}> · {n.failed} falha{n.failed > 1 ? "s" : ""}</span> : null}</td>
            <td className="tnum" style={{ padding: "9px 10px", borderTop: "1px solid var(--line-1)", textAlign: "right" }}>{m.advanced ?? "—"}</td>
            <td className="tnum" style={{ padding: "9px 10px", borderTop: "1px solid var(--line-1)", textAlign: "right" }}>{m.booked ?? "—"}</td>
            <td className="tnum" style={{ padding: "9px 10px", borderTop: "1px solid var(--line-1)", textAlign: "right", color: m.won ? "var(--pos)" : undefined }}>{m.won ?? "—"}</td>
          </tr>;
        })}</tbody>
      </table></div>}
      <InfoNota style={{ margin: 12 }}>Avançaram, calls e ganhos contam os 30 dias depois do primeiro envio de cada broadcast.</InfoNota>
    </section>
  </div>;
}

// Já recebeu (ou está na fila) pelo WhatsApp neste broadcast? Falha, inclusive
// a de entrega avisada depois pela Meta, não conta: pode reenviar. Espelho de
// waReceived (broadcast-wa.js); `whatsapp` sem waStatus é o envio assistido antigo.
const waGot = (st) => ["queued", "sent", "delivered", "read"].includes(st?.waStatus) || (!!st?.whatsapp && !st?.waStatus);

// Por que o lead não recebe por este canal ("" = recebe). Espelho do servidor (broadcast-wa.js / send-email).
function skipReason(lead, camp, channel, tplParams) {
  const st = camp.sent?.[lead.id];
  if (channel === "whatsapp") {
    if (!waLink(lead.phone)) return "sem telefone";
    if (lead.whatsappOptOut) return "pediu para não receber";
    if (lead.whatsappInvalid) return "número sem WhatsApp";
    if (waGot(st)) return "já recebeu";
    if (tplParams && tplParams(lead).some((p) => !p)) return "variável sem valor";
    return "";
  }
  if (!lead.email) return "sem e-mail";
  if (lead.emailOptOut) return "descadastrado";
  if (lead.emailInvalid) return "e-mail devolvido";
  if (st?.email) return "já recebeu";
  return "";
}
const paramsFor = (tpl, lead, product) => {
  const toks = campaignTokens(lead, product);
  return Array.from({ length: Number(tpl?.params) || 0 }, (_, i) => {
    const v = (tpl?.vars || [])[i] || {};
    return String(v.source === "text" ? v.value || "" : toks[v.value] || "").trim();
  });
};
// Modelo oficial aprovado + o valor de cada variável ({{n}} → campo do lead ou
// texto fixo). Broadcast e passo de sequência usam o mesmo bloco; `prefix`
// diferencia os rótulos quando há mais de um na tela (ex.: "Passo 2 · ").
function WaTemplateFields({ tpl, approved, listError, disabled, onChange, prefix = "" }) {
  const pick = (key) => {
    const t = approved.find((x) => `${x.name}|${x.language}` === key);
    onChange(t ? { name: t.name, language: t.language, body: t.body, params: t.params, header: t.header || "", category: t.category || "",
      vars: Array.from({ length: t.params }, (_, i) => (i === 0 ? { source: "token", value: "nome" } : { source: "text", value: "" })) } : null);
  };
  const setVar = (i, patch) => { const vars = [...(tpl?.vars || [])]; vars[i] = { ...(vars[i] || {}), ...patch }; onChange({ ...tpl, vars }); };
  return <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
    <div className="disparos-label" style={{ maxWidth: 420 }}>Modelo aprovado
      <SelectPopover label={`${prefix}Modelo aprovado`} disabled={disabled} value={tpl ? `${tpl.name}|${tpl.language}` : ""} onChange={pick} width={360}
        placeholder={listError ? "não foi possível listar os modelos" : approved.length ? "escolha o modelo…" : "nenhum modelo aprovado"}
        options={[
          ...(tpl && !approved.some((x) => x.name === tpl.name && x.language === tpl.language) ? [{ value: `${tpl.name}|${tpl.language}`, label: `${tpl.name} (${tpl.language})`, hint: "fora dos aprovados", tone: "var(--neg)" }] : []),
          ...approved.map((x) => ({ value: `${x.name}|${x.language}`, label: `${x.name} (${x.language})`, hint: x.category === "MARKETING" ? "marketing" : x.category ? "utilidade" : "" })),
        ]} /></div>
    {tpl && <>
      <div style={{ background: "var(--bg-inset)", borderRadius: 16, padding: "10px 14px", whiteSpace: "pre-wrap", fontSize: 13 }}>{tpl.header === "image" && <div className="dim" style={{ fontSize: 11.5 }}>[imagem padrão do modelo no cabeçalho]</div>}{tpl.body}</div>
      {Array.from({ length: tpl.params || 0 }, (_, i) => { const v = (tpl.vars || [])[i] || {}; return (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="disparos-label" style={{ width: 220 }}>{`Variável {{${i + 1}}}`}
            <SelectPopover label={`${prefix}Valor da variável ${i + 1}`} disabled={disabled} value={v.source === "text" ? "__text" : v.value || ""} placeholder="escolha…"
              onChange={(val) => setVar(i, val === "__text" ? { source: "text", value: "" } : { source: "token", value: val })}
              options={[...CAMPAIGN_TOKENS.map(([k, l]) => ({ value: k, label: `${l} do lead` })), { value: "__text", label: "texto fixo" }]} /></div>
          {v.source === "text" && <label className="disparos-label" style={{ flex: "1 1 220px" }}>Texto fixo
            <input aria-label={`${prefix}Texto fixo da variável ${i + 1}`} disabled={disabled} value={v.value || ""} onChange={(e) => setVar(i, { value: e.target.value })} placeholder="o mesmo para todos" /></label>}
        </div>); })}
    </>}
  </div>;
}
const templateReady = (tpl) => !!tpl?.name && (tpl.vars || []).length >= (tpl.params || 0) && (tpl.vars || []).slice(0, tpl.params).every((v) => v?.source && (v.source === "token" || String(v.value || "").trim()));

const renderTpl = (body, params) => String(body || "").replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => params[Number(n) - 1] || `{{${n}}}`);

function BroadcastEditor({ initial, product, leads, stageOptions, defaultStages, onOpenLead, onBusy, leaveRef, goTab, onClose }) {
  const me = currentUser()?.id || "";
  const cfg = window.SEED?.CONFIG || {};
  const waOn = !!cfg.whatsapp?.configured;
  const emailOn = cfg.email ? !!cfg.email.ready : !!cfg.google?.gmail;
  const emailVia = cfg.email?.provider === "resend" ? "pelo Resend" : "pela conta Google do sistema";
  const legacy = channelOf(initial) === "whatsapp-assistido" && !!initial.id;
  const [camp, setCamp] = useS(() => ({
    id: initial.id || null, name: initial.name || "", channel: initial.id ? channelOf(initial) : (waOn ? "whatsapp" : "email"),
    status: initial.status || "draft", pauseReason: initial.pauseReason || "", sent: initial.sent || {},
    email: { subject: initial.email?.subject || "", body: initial.email?.body || "" },
    wa: { template: initial.wa?.template || null, text: initial.wa?.text || "" },
    createdAt: initial.createdAt || "", createdBy: initial.createdBy || me,
  }));
  const [stagesSel, setStagesSel] = useS(() => new Set(initial.stages?.length ? initial.stages : defaultStages));
  // Público escolhido: gravado no broadcast (`audience`); nos antigos, quem
  // consta no envio. Reabrir mostra esse público, não a etapa inteira.
  const pinned = useM(() => new Set(initial.audience?.length ? initial.audience : Object.keys(initial.sent || {})), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [selected, setSelected] = useS(() => (pinned.size ? new Set(pinned)
    : new Set(leads.filter((l) => (initial.stages?.length ? initial.stages : defaultStages).includes(l.stage)).map((l) => l.id))));
  const [search, setSearch] = useS("");
  const [view, setView] = useS("all"); // all | selected | unselected | failed
  const [busy, setBusy] = useS("");
  const [note, setNote] = useS(null);
  const [progress, setProgress] = useS(null);
  const writing = useR(false);
  const draft = { name: camp.name, channel: camp.channel, email: camp.email, wa: camp.wa, stages: [...stagesSel].sort() };
  const guard = useDraftGuard(draft, leaveRef, !!busy);
  useE(() => { onBusy(!!busy); return () => onBusy(false); }, [busy, onBusy]);
  // Canais do broadcast: WhatsApp, e-mail ou os dois ("both").
  const ch = camp.channel;
  const hasWa = ch === "whatsapp" || ch === "both";
  const hasEmail = ch === "email" || ch === "both";
  const toggleChannel = (k) => setCamp((c) => {
    const set = new Set(c.channel === "both" ? ["whatsapp", "email"] : [c.channel]);
    if (set.has(k)) { if (set.size === 1) return c; set.delete(k); } else set.add(k);
    return { ...c, channel: set.size === 2 ? "both" : [...set][0] };
  });
  // Canal e mensagem travam quando alguém recebeu (ou está na fila); o público
  // só trava durante o envio. Broadcast que falhou inteiro volta a ser editável,
  // e quem falhou pode ser reenviado.
  const locked = legacy || camp.status === "sending" || Object.values(camp.sent || {}).some((s) => waGot(s) || s?.email);
  const audienceLocked = legacy || camp.status === "sending";
  const pid = product.id;

  // Modelos: oficiais aprovados (WhatsApp) e livres de e-mail.
  const tplRes = useSwr(waOn && hasWa ? "wa/templates" : null, () => api.waMetaTemplates(), { ttl: 60_000 });
  const approved = tplRes.data?.templates || [];
  const freeRes = useSwr(hasEmail ? `drip_templates/${pid}` : null, () => api.list("drip_templates", { saas: pid }), { ttl: 30_000 });
  const freeEmail = (Array.isArray(freeRes.data) ? freeRes.data : []).filter((t) => t.channel === "email");
  const numInfo = useSwr(waOn && hasWa ? `wa/number/${pid}` : null, () => api.waNumber(pid), { ttl: 10 * 60_000 }).data ?? null;
  const waStats = useSwr(waOn && hasWa ? "wa/insights" : null, () => api.waInsights(), { ttl: 60_000 }).data ?? null;

  // Público: etapas → leads (mais quem já estava no broadcast, mesmo que tenha
  // mudado de etapa). Trocar as etapas seleciona todo mundo do novo recorte;
  // lead novo chegando na lista não mexe na seleção feita à mão.
  const stagesKey = [...stagesSel].sort().join("|");
  const recipients = useM(() => leads.filter((l) => stagesSel.has(l.stage) || pinned.has(l.id)), [leads, stagesKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const prevStages = useR(stagesKey);
  useE(() => {
    if (prevStages.current === stagesKey) return;
    prevStages.current = stagesKey;
    setSelected(new Set(leads.filter((l) => stagesSel.has(l.stage)).map((l) => l.id)));
  }, [stagesKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const failedOf = (l) => camp.sent?.[l.id]?.waStatus === "failed" || camp.sent?.[l.id]?.emailStatus === "failed";
  const failedCount = recipients.filter(failedOf).length;
  const q = search.trim().toLowerCase();
  const visible = recipients.filter((l) => (!q || `${l.name || ""} ${l.company || ""}`.toLowerCase().includes(q))
    && (view === "all" || (view === "selected" ? selected.has(l.id) : view === "unselected" ? !selected.has(l.id) : failedOf(l))));
  const chosen = recipients.filter((l) => selected.has(l.id));
  const allVisibleOn = visible.length > 0 && visible.every((l) => selected.has(l.id));
  const someVisibleOn = visible.some((l) => selected.has(l.id));
  const toggleVisible = () => setSelected((s) => { const n = new Set(s); for (const l of visible) { if (allVisibleOn) n.delete(l.id); else n.add(l.id); } return n; });
  const tpl = camp.wa.template;
  const tplParams = hasWa && tpl ? (lead) => paramsFor(tpl, lead, product) : null;
  // Por canal: quem recebe e por que fica fora. Com os dois canais, o lead
  // entra se recebe por pelo menos um.
  const waReason = (l) => (hasWa ? skipReason(l, camp, "whatsapp", tplParams) : "fora");
  const emailReason = (l) => (hasEmail ? skipReason(l, camp, "email", null) : "fora");
  const eligibleWa = hasWa ? chosen.filter((l) => !waReason(l)) : [];
  const eligibleEmail = hasEmail ? chosen.filter((l) => !emailReason(l)) : [];
  const eligible = chosen.filter((l) => (hasWa && !waReason(l)) || (hasEmail && !emailReason(l)));
  const situation = (l) => {
    const w = hasWa ? waReason(l) : null, e = hasEmail ? emailReason(l) : null;
    if (ch === "both") {
      if (!w && !e) return ["", "WhatsApp e e-mail"];
      if (!w) return ["", `só WhatsApp · e-mail: ${e}`];
      if (!e) return ["", `só e-mail · WhatsApp: ${w}`];
      return ["out", `${w} · ${e}`];
    }
    const r = hasWa ? w : e;
    const fail = camp.sent?.[l.id]?.waStatus === "failed" ? camp.sent[l.id].waError || "falha na entrega" : "";
    if (fail && !r) return ["fail", `falhou: ${fail} · ${selected.has(l.id) ? "vai reenviar" : "marque para reenviar"}`];
    return r ? ["out", r] : ["", "recebe"];
  };
  const skipped = chosen.length - eligible.length;
  const skipSummary = Object.entries(chosen.reduce((acc, l) => {
    if (hasWa && waReason(l)) { const k = `${ch === "both" ? "sem WhatsApp: " : ""}${waReason(l)}`; acc[k] = (acc[k] || 0) + 1; }
    if (hasEmail && emailReason(l)) { const k = `${ch === "both" ? "sem e-mail: " : ""}${emailReason(l)}`; acc[k] = (acc[k] || 0) + 1; }
    return acc;
  }, {}));
  const emailReady = !!(camp.email.subject.trim() && camp.email.body.trim());
  const messageReady = (!hasWa || templateReady(tpl)) && (!hasEmail || emailReady);
  const channelsOn = (!hasWa || waOn) && (!hasEmail || emailOn);
  const sample = eligible[0] || chosen[0] || null;
  const toks = sample ? campaignTokens(sample, product) : null;
  const previewEmail = sample && hasEmail ? `${interpolate(camp.email.subject, toks)}\n\n${interpolate(camp.email.body, toks)}` : "";
  const previewWa = sample && hasWa && tpl ? renderTpl(tpl.body, paramsFor(tpl, sample, product)) : "";
  const dailyCap = broadcastDailyCap(numInfo?.tier);
  const tierN = tierLimit(numInfo?.tier);
  const avgCost = waStats?.costs?.messages > 0 ? Number(waStats.costs.cost) / Number(waStats.costs.messages) : null;
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  const sendLabel = ch === "both" ? `Enviar ${eligibleWa.length} WhatsApp e ${plural(eligibleEmail.length, "e-mail", "e-mails")}`
    : ch === "email" ? `Enviar ${plural(eligibleEmail.length, "e-mail", "e-mails")}` : `Enviar ${plural(eligibleWa.length, "mensagem", "mensagens")}`;

  // Progresso do envio (o servidor manda as duas filas em lotes).
  useE(() => {
    if (!camp.id || !["sending", "paused", "done"].includes(camp.status)) return undefined;
    let alive = true;
    const poll = async () => { try { const p = await api.campaignProgress(camp.id); if (alive) { setProgress(p); setCamp((c) => ({ ...c, ...(p.byLead ? { sent: p.byLead } : {}), ...(p.status !== c.status ? { status: p.status, pauseReason: p.pauseReason || "" } : {}) })); } } catch { /* mantém o último */ } };
    poll();
    const id = camp.status === "sending" ? setInterval(poll, 5000) : null;
    return () => { alive = false; if (id) clearInterval(id); };
  }, [camp.id, camp.status]);

  const payload = () => ({
    name: camp.name.trim() || "Broadcast sem nome", saas: pid, channel: ch, status: camp.status || "draft", stages: [...stagesSel], audience: [...selected],
    channels: { email: hasEmail, whatsapp: hasWa },
    email: camp.email, wa: { ...(camp.wa.text ? { text: camp.wa.text } : {}), template: hasWa ? camp.wa.template : null },
    createdAt: camp.createdAt || new Date().toISOString(), createdBy: camp.createdBy || me,
  });
  async function persist() {
    if (camp.id) { await api.update("campaigns", camp.id, payload()); return camp.id; }
    const created = await api.create("campaigns", payload());
    setCamp((c) => ({ ...c, id: created.id, createdAt: created.createdAt || c.createdAt }));
    return created.id;
  }
  async function run(kind, fn) {
    if (writing.current) return;
    writing.current = true; setBusy(kind); setNote(null);
    try { await fn(); } catch (e) { setNote({ ok: false, text: e.message || "Não deu certo." }); }
    finally { writing.current = false; setBusy(""); }
  }
  const save = () => run("save", async () => { await persist(); guard.clean(draft); setNote({ ok: true, text: "Broadcast salvo." }); });
  const send = () => {
    const parts = [hasWa && eligibleWa.length ? plural(eligibleWa.length, "mensagem de WhatsApp", "mensagens de WhatsApp") : "", hasEmail && eligibleEmail.length ? plural(eligibleEmail.length, "e-mail", "e-mails") : ""].filter(Boolean);
    if (!window.confirm(`Enviar ${parts.join(" e ")} agora? O servidor envia em lotes e pode levar alguns minutos.`)) return;
    run("send", async () => {
      const id = await persist();
      guard.clean(draft);
      const notes = [];
      let ok = true;
      // Cada canal entra na sua fila; o servidor envia em lotes.
      if (hasEmail && eligibleEmail.length) {
        const r = await api.campaignSendEmail(id, eligibleEmail.map((l) => l.id));
        setCamp((c) => ({ ...c, sent: r.sent || c.sent, status: r.status || "sending" }));
        notes.push(`${r.queued} e-mail(s) na fila, saem ${emailVia}${r.skipped?.length ? `; ${r.skipped.length} ficaram fora` : ""}`);
      }
      if (hasWa && eligibleWa.length) {
        const r = await api.campaignSendWhatsapp(id, eligibleWa.map((l) => l.id));
        setCamp((c) => ({ ...c, status: r.status || "sending" }));
        notes.push(`${r.queued} mensagem(ns) de WhatsApp na fila${r.skipped?.length ? `; ${r.skipped.length} ficaram fora` : ""}. O servidor envia em lotes`);
      }
      setNote({ ok, text: `${notes.join(" · ")}.` });
    });
  };
  const pauseResume = () => run("pause", async () => {
    const c = camp.status === "sending" ? await api.campaignPause(camp.id) : await api.campaignResume(camp.id);
    setCamp((x) => ({ ...x, status: c.status, pauseReason: c.pauseReason || "" }));
  });
  const remove = () => {
    if (!window.confirm(`Apagar o broadcast “${camp.name || "sem nome"}”? O histórico de envios na timeline dos leads continua.`)) return;
    run("remove", async () => { await api.remove("campaigns", camp.id); guard.clean(draft); onClose(); });
  };
  const back = () => { if (guard.confirm()) onClose(); };
  const toggleStage = (st) => setStagesSel((s) => { const n = new Set(s); n.has(st) ? n.delete(st) : n.add(st); return n; });
  const insertToken = (field, tok) => setCamp((c) => ({ ...c, email: { ...c.email, [field]: `${c.email[field] || ""}{{${tok}}}` } }));
  const genCopy = () => run("ai", async () => {
    const r = await api.campaignAiCopy({ channel: "email", objetivo: camp.name || "retomar contato", publico: [...stagesSel].join(", "), productName: product.name });
    setCamp((c) => ({ ...c, email: { subject: r.subject || c.email.subject, body: r.body || c.email.body } }));
  });

  const step = (n, title, sub) => <div className="disparos-step" style={{ display: "flex", gap: 10, alignItems: "baseline", marginBottom: 12 }}>
    <span className="tnum" style={{ width: 24, height: 24, borderRadius: 99, background: "var(--btn-bg)", color: "var(--btn-fg)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{n}</span>
    <div><div className="card-title">{title}</div>{sub && <div className="card-sub">{sub}</div>}</div></div>;
  const st = STATUS_LABEL[camp.status] || STATUS_LABEL.draft;
  const subhead = (t) => ch === "both" ? <div className="kicker accent" style={{ marginTop: 4 }}>{t}</div> : null;
  const boxPreview = (label, text) => text ? <div style={{ marginBottom: 10 }}>{ch === "both" && <div className="kicker" style={{ marginBottom: 4 }}>{label}</div>}<div style={{ background: "var(--bg-inset)", borderRadius: 16, padding: "10px 14px", whiteSpace: "pre-wrap", fontSize: 13 }}>{text}</div></div> : null;

  return <div className="marketing-body disparos-tab" style={{ flex: 1, overflow: "auto" }}>
    {/* Topo do editor: navegação e estado numa linha (centralizados), o nome
        embaixo com o rótulo visível — rótulo em cima do campo na mesma linha do
        botão deixava os três desalinhados. */}
    <section className="marketing-card disparos-editor-head" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <SecondaryButton onClick={back} disabled={!!busy}>← Broadcasts</SecondaryButton>
        <span style={{ flex: 1 }} />
        <span className={`chip ${st[0]}`} style={{ height: 24 }}>{st[1]}</span>
        {camp.id && !locked && <SecondaryButton onClick={remove} disabled={!!busy}>apagar</SecondaryButton>}
      </div>
      <label className="disparos-label">Nome do broadcast
        <input aria-label="Nome do broadcast" value={camp.name} disabled={legacy || !!busy} onChange={(e) => setCamp((c) => ({ ...c, name: e.target.value }))} placeholder="ex.: Retomada de outubro" /></label>
    </section>
    {note && <div role={note.ok ? "status" : "alert"} style={{ fontSize: 13, color: note.ok ? "var(--pos)" : "var(--neg)" }}>{note.text}</div>}
    {legacy && <InfoNota>Broadcast antigo de WhatsApp assistido (abria o WhatsApp de quem enviava). Fica só para consulta; os novos saem pela API oficial.</InfoNota>}
    <fieldset className="disparos-fields" disabled={!!busy || legacy} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 14 }}>
      <section className="marketing-card" style={{ padding: 16 }}>
        {step(1, "Canal", locked ? "o canal não muda depois do primeiro envio" : "marque um ou os dois: o canal define quem pode receber")}
        <div role="group" aria-label="Canais do broadcast" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 10 }}>
          {[["whatsapp", "WhatsApp", waOn ? "pela API oficial, com modelo aprovado pela Meta" : "configure o WhatsApp em Configurações → Integrações", waOn, hasWa],
            ["email", "E-mail", emailOn ? `sai ${emailVia}` : "configure o e-mail (Resend) em Configurações → Integrações", emailOn, hasEmail]].map(([k, l, sub, on, active]) => (
            <button key={k} type="button" role="checkbox" aria-checked={active} disabled={locked || !on} onClick={() => toggleChannel(k)}
              style={{ textAlign: "left", padding: "12px 14px", borderRadius: 18, border: `1.5px solid ${active ? "var(--accent)" : "var(--line-1)"}`, background: active ? "var(--accent-soft)" : "var(--bg-1)", opacity: on ? 1 : 0.6, display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span aria-hidden="true" style={{ width: 18, height: 18, marginTop: 1, borderRadius: 6, flexShrink: 0, border: `1.5px solid ${active ? "var(--accent)" : "var(--line-2)"}`, background: active ? "var(--accent)" : "transparent", color: "#fff", fontSize: 12, lineHeight: "15px", textAlign: "center" }}>{active ? "✓" : ""}</span>
              <span><span style={{ display: "block", fontSize: 14, fontWeight: 700 }}>{l}</span><span className="dim" style={{ display: "block", fontSize: 12, marginTop: 2 }}>{sub}</span></span>
            </button>))}
        </div>
      </section>

      <section className="marketing-card" style={{ padding: 16 }}>
        {step(2, "Público", `${chosen.length} selecionado${chosen.length === 1 ? "" : "s"} · ${ch === "both" ? `${eligibleWa.length} por WhatsApp, ${eligibleEmail.length} por e-mail` : `${eligible.length} podem receber por ${CH_LABEL[ch] || "este canal"}`}`)}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {stageOptions.map((s) => { const on = stagesSel.has(s); return <button key={s} type="button" aria-pressed={on} disabled={audienceLocked} onClick={() => toggleStage(s)} className={`chip ${on ? "accent" : ""}`} style={{ height: 28, cursor: "pointer" }}>{s} · {leads.filter((l) => l.stage === s).length}</button>; })}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <input aria-label="Buscar lead" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="buscar por nome ou empresa" style={{ flex: "1 1 220px" }} />
          <SecondaryButton size="sm" disabled={audienceLocked || !visible.length || allVisibleOn} onClick={toggleVisible}>
            {q || view !== "all" ? `Selecionar os ${visible.length} da lista` : `Selecionar todos (${recipients.length})`}
          </SecondaryButton>
          <SecondaryButton size="sm" disabled={audienceLocked || !selected.size} onClick={() => setSelected(new Set())}>Limpar seleção</SecondaryButton>
          {failedCount > 0 && <SecondaryButton size="sm" disabled={audienceLocked} onClick={() => { setSelected(new Set(recipients.filter(failedOf).map((l) => l.id))); setView("failed"); }}>Só os que falharam ({failedCount})</SecondaryButton>}
        </div>
        <div role="group" aria-label="Mostrar na lista" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {[["all", "Todos", recipients.length], ["selected", "Selecionados", chosen.length], ["unselected", "Não selecionados", recipients.length - chosen.length], ...(failedCount ? [["failed", "Falharam", failedCount]] : [])].map(([k, label, n]) => (
            <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)} className={`chip ${view === k ? "accent" : ""}`} style={{ height: 26, cursor: "pointer" }}>{label} · {n}</button>
          ))}
        </div>
        <div className="tbl-x" style={{ maxHeight: 360, overflow: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead><tr>{["", "Lead", "Empresa", "Etapa", "Na etapa", "Situação"].map((h, i) => <th key={i} className="kicker" style={{ padding: "6px 8px", textAlign: "left", position: "sticky", top: 0, background: "var(--bg-1)" }}>
            {i === 0 ? <HeaderCheck checked={allVisibleOn} mixed={someVisibleOn && !allVisibleOn} disabled={audienceLocked || !visible.length} onChange={toggleVisible} label={allVisibleOn ? "Desmarcar os leads da lista" : "Marcar os leads da lista"} /> : h}
          </th>)}</tr></thead>
          <tbody>{visible.map((l) => {
            const [out, text] = situation(l);
            return <tr key={l.id}>
              <td style={{ padding: "5px 8px", borderTop: "1px solid var(--line-1)" }}><input type="checkbox" aria-label={`Incluir ${l.name || l.id}`} disabled={audienceLocked} checked={selected.has(l.id)} onChange={() => setSelected((s) => { const n = new Set(s); n.has(l.id) ? n.delete(l.id) : n.add(l.id); return n; })} /></td>
              <td style={{ padding: "5px 8px", borderTop: "1px solid var(--line-1)" }}><button type="button" onClick={() => onOpenLead?.(l)} style={{ fontWeight: 600, textAlign: "left" }}>{l.name || "sem nome"}</button></td>
              <td style={{ padding: "5px 8px", borderTop: "1px solid var(--line-1)" }}>{l.company || "—"}</td>
              <td style={{ padding: "5px 8px", borderTop: "1px solid var(--line-1)" }}>{l.stage}</td>
              <td style={{ padding: "5px 8px", borderTop: "1px solid var(--line-1)" }}>{daysSince(l.stageSince || l.updatedAt || l.createdAt)}</td>
              <td style={{ padding: "5px 8px", borderTop: "1px solid var(--line-1)", color: out === "fail" ? "var(--neg)" : out ? "var(--fg-3)" : "var(--pos)" }}>{text}</td>
            </tr>;
          })}</tbody>
        </table></div>
        {!visible.length && <div className="dim" style={{ fontSize: 12.5, padding: 8 }}>{recipients.length ? "Nenhum lead com esse filtro." : "Nenhum lead nas etapas escolhidas."}</div>}
      </section>

      <section className="marketing-card" style={{ padding: 16 }}>
        {step(3, "Mensagem", ch === "both" ? "uma mensagem por canal: modelo aprovado no WhatsApp e texto livre no e-mail" : hasWa ? "fora da janela de 24h a Meta só aceita modelo aprovado; as variáveis viram dados do lead" : "use um modelo livre ou escreva; {{nome}} e as outras variáveis viram dados do lead")}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {hasWa && <>
            {subhead("WhatsApp")}
            <WaTemplateFields tpl={tpl} approved={approved} listError={!!tplRes.error} disabled={locked} onChange={(t) => setCamp((c) => ({ ...c, wa: { ...c.wa, template: t } }))} />
            <div className="dim" style={{ fontSize: 12 }}>Não achou? <button type="button" onClick={() => goTab("modelos")} style={{ textDecoration: "underline" }}>crie ou acompanhe modelos em Modelos</button> (a Meta aprova em minutos ou horas).</div>
          </>}
          {hasEmail && <>
            {subhead("E-mail")}
            {freeEmail.length > 0 && <div className="disparos-label" style={{ maxWidth: 360 }}>Usar modelo livre
              <SelectPopover label="Usar modelo livre" disabled={locked} value="" placeholder="escolha para preencher assunto e corpo…"
                onChange={(id) => { const t = freeEmail.find((x) => x.id === id); if (t) setCamp((c) => ({ ...c, email: { subject: t.subject || "", body: t.body || "" } })); }}
                options={freeEmail.map((t) => ({ value: t.id, label: t.name || "sem nome" }))} /></div>}
            <label className="disparos-label">Assunto do e-mail<input aria-label="Assunto do e-mail" disabled={locked} value={camp.email.subject} onChange={(e) => setCamp((c) => ({ ...c, email: { ...c.email, subject: e.target.value } }))} placeholder="{{nome}}, uma ideia para a sua operação" /></label>
            <label className="disparos-label">Mensagem<textarea aria-label="Mensagem" disabled={locked} rows={8} value={camp.email.body} onChange={(e) => setCamp((c) => ({ ...c, email: { ...c.email, body: e.target.value } }))} placeholder="Oi {{nome}}, …" style={{ resize: "vertical", fontFamily: "inherit" }} /></label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span className="kicker">inserir</span>
              {CAMPAIGN_TOKENS.map(([k, l]) => <button key={k} type="button" disabled={locked} aria-label={`Inserir ${l}`} onClick={() => insertToken("body", k)} className="chip" style={{ height: 24, cursor: "pointer" }}>{`{{${k}}}`}</button>)}
              {window.SEED?.CONFIG?.ai?.configured && !locked && <SecondaryButton onClick={genCopy} disabled={!!busy}>{busy === "ai" ? "gerando…" : "Gerar com IA"}</SecondaryButton>}
            </div>
          </>}
        </div>
      </section>

      <section className="marketing-card" style={{ padding: 16 }}>
        {step(4, "Conferir e enviar", sample ? `prévia com os dados de ${sample.name || "um lead"}` : "escolha o público para ver a prévia")}
        {boxPreview("WhatsApp", previewWa)}
        {boxPreview("E-mail", previewEmail)}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))", gap: 10, marginBottom: 12 }}>
          {ch === "both"
            ? <><Kpi label="por WhatsApp" value={eligibleWa.length} sub={`de ${chosen.length} selecionados`} /><Kpi label="por e-mail" value={eligibleEmail.length} sub={`de ${chosen.length} selecionados`} /></>
            : <Kpi label="vão receber" value={eligible.length} sub={skipped ? `${skipped} ficam fora` : "todos os selecionados"} />}
          {hasWa && <Kpi label="custo estimado" value={avgCost != null ? `R$ ${(avgCost * eligibleWa.length).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"} sub="WhatsApp, pelo custo médio por mensagem dos últimos 30 dias" />}
          {hasWa && <Kpi label="limite do número por dia" value={tierN == null ? "—" : tierN === Infinity ? "sem limite" : tierN.toLocaleString("pt-BR")} sub={dailyCap == null ? "faixa do número não informada" : dailyCap === Infinity ? "o disparo usa até 80%" : `o disparo usa até ${dailyCap.toLocaleString("pt-BR")} (80%)`} />}
        </div>
        {skipSummary.length > 0 && <div className="dim" style={{ fontSize: 12, marginBottom: 10 }}>{ch === "both" ? "Sem um dos canais" : "Ficam fora"}: {skipSummary.map(([r, n]) => `${n} ${r}`).join(" · ")}</div>}
        {hasWa && dailyCap != null && dailyCap !== Infinity && eligibleWa.length > dailyCap && <InfoNota style={{ marginBottom: 10 }}>{`O público do WhatsApp passa do limite do dia: o servidor manda ${dailyCap.toLocaleString("pt-BR")} hoje e continua amanhã.`}</InfoNota>}
        {progress && <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, marginBottom: 12 }} aria-label="Progresso do envio">
          {hasWa && <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>{ch === "both" && <span className="kicker">WhatsApp</span>}
            {[["na fila", progress.queued], ["enviadas", progress.sent], ["entregues", progress.delivered], ["lidas", progress.read], ["falharam", progress.failed], ["puladas", progress.skipped]].map(([l, v]) => <span key={l}><b className="tnum">{v || 0}</b> {l}</span>)}</div>}
          {hasEmail && progress.email && <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>{ch === "both" && <span className="kicker">E-mail</span>}
            {[["na fila", progress.email.queued], ["enviados", progress.email.sent], ["falharam", progress.email.failed], ["pulados", progress.email.skipped]].map(([l, v]) => <span key={l}><b className="tnum">{v || 0}</b> {l}</span>)}</div>}
        </div>}
        {camp.pauseReason && <div role="alert" style={{ fontSize: 12.5, color: "var(--neg)", marginBottom: 10 }}>Pausado: {camp.pauseReason}</div>}
        <div className="marketing-toolbar" style={{ gap: 8, flexWrap: "wrap" }}>
          {!legacy && (camp.status === "draft" || camp.status === "done") && <PrimaryButton disabled={!eligible.length || !messageReady || !!busy || !channelsOn} onClick={send}>{busy === "send" ? "enviando…" : camp.status === "done" ? sendLabel.replace(/^Enviar/, "Reenviar") : sendLabel}</PrimaryButton>}
          {["sending", "paused"].includes(camp.status) && <PrimaryButton onClick={pauseResume} disabled={!!busy}>{camp.status === "sending" ? "Pausar envio" : "Retomar envio"}</PrimaryButton>}
          {!legacy && camp.status === "draft" && <SecondaryButton onClick={save} disabled={!!busy}>{busy === "save" ? "salvando…" : "Salvar rascunho"}</SecondaryButton>}
        </div>
        <InfoNota style={{ marginTop: 12 }}>{[
          hasEmail ? `Os e-mails saem ${emailVia}, em lotes pelo servidor, com link de descadastro; muita falha seguida pausa o envio.` : "",
          hasWa ? "O WhatsApp sai em lotes pelo servidor, respeita o limite do número e pausa sozinho se a Meta sinalizar o número ou muitas mensagens falharem." : "",
          "Quem já recebeu, pediu para sair ou tem contato inválido fica fora daquele canal.",
        ].filter(Boolean).join(" ")}</InfoNota>
      </section>
    </fieldset>
  </div>;
}
// Caixa do cabeçalho da tabela: marca/desmarca os leads da lista (com o traço
// quando só parte deles está marcada).
function HeaderCheck({ checked, mixed, disabled, onChange, label }) {
  const ref = useR(null);
  useE(() => { if (ref.current) ref.current.indeterminate = !!mixed; }, [mixed]);
  return <input ref={ref} type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={onChange} />;
}
const Kpi = ({ label, value, sub }) => <div style={{ background: "var(--bg-inset)", borderRadius: 16, padding: "10px 14px" }}>
  <div style={{ fontSize: 12, color: "var(--fg-3)" }}>{label}</div><div className="tnum" style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>{sub && <div className="dim" style={{ fontSize: 11.5 }}>{sub}</div>}</div>;

// Inscrever leads à mão numa sequência (além do gatilho por etapa). Quem já
// está inscrito é ignorado pelo servidor.
function EnrollModal({ seq, leads, onClose }) {
  const [q, setQ] = useS("");
  const [stage, setStage] = useS("");
  const [sel, setSel] = useS(() => new Set());
  const [busy, setBusy] = useS(false);
  const [err, setErr] = useS("");
  const stages = [...new Set((leads || []).map((l) => l.stage).filter(Boolean))];
  const k = q.trim().toLowerCase();
  const list = (leads || []).filter((l) => (!stage || l.stage === stage) && (!k || `${l.name || ""} ${l.company || ""}`.toLowerCase().includes(k))).slice(0, 300);
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  async function go() {
    setBusy(true); setErr("");
    try { const r = await api.sequenceEnroll(seq.id, [...sel]); onClose(r.enrolled ?? sel.size); }
    catch (e) { setErr(e.message || "Não foi possível inscrever."); setBusy(false); }
  }
  return <Modal onClose={() => onClose(null)} label={`Inscrever leads em ${seq.name || "sequência"}`} largura={640} padding={16} painelStyle={{ padding: 22 }} fechavel={!busy}>
    <div style={{ fontSize: 15.5, fontWeight: 800, marginBottom: 4 }}>Inscrever leads em “{seq.name || "sequência"}”</div>
    <div className="dim" style={{ fontSize: 12, marginBottom: 12 }}>além de quem entra pelo gatilho; quem já está na sequência é ignorado</div>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
      <input aria-label="Buscar lead para inscrever" value={q} onChange={(e) => setQ(e.target.value)} placeholder="buscar por nome ou empresa" className="inp" style={{ flex: "1 1 220px" }} />
      <div style={{ width: 200 }}><SelectPopover label="Etapa" value={stage} onChange={setStage} options={[{ value: "", label: "todas as etapas" }, ...stages.map((s) => ({ value: s, label: s }))]} /></div>
    </div>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
      <SecondaryButton size="sm" disabled={!list.length || list.every((l) => sel.has(l.id))} onClick={() => setSel((s) => new Set([...s, ...list.map((l) => l.id)]))}>{k || stage ? `Selecionar os ${list.length} da lista` : `Selecionar todos (${list.length})`}</SecondaryButton>
      <SecondaryButton size="sm" disabled={!sel.size} onClick={() => setSel(new Set())}>Limpar seleção</SecondaryButton>
      <span className="dim" style={{ fontSize: 12 }}>{sel.size} selecionado{sel.size === 1 ? "" : "s"}</span>
    </div>
    <div style={{ maxHeight: 340, overflow: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
      {list.map((l) => <label key={l.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 8px", borderRadius: 12, fontSize: 13, cursor: "pointer", background: sel.has(l.id) ? "var(--accent-soft)" : "transparent" }}>
        <input type="checkbox" checked={sel.has(l.id)} onChange={() => toggle(l.id)} style={{ accentColor: "var(--accent)" }} />
        <span style={{ fontWeight: 600 }}>{l.name || "sem nome"}</span><span className="dim" style={{ fontSize: 12 }}>{l.company || ""} · {l.stage}</span>
      </label>)}
      {!list.length && <div className="dim" style={{ fontSize: 12.5, padding: 8 }}>Nenhum lead com esse filtro.</div>}
    </div>
    {err && <div role="alert" style={{ color: "var(--neg)", fontSize: 12.5, marginTop: 8 }}>{err}</div>}
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
      <SecondaryButton onClick={() => onClose(null)} disabled={busy}>cancelar</SecondaryButton>
      <PrimaryButton onClick={go} disabled={busy || !sel.size}>{busy ? "inscrevendo…" : `Inscrever ${sel.size}`}</PrimaryButton>
    </div>
  </Modal>;
}

// ─────────────────────────────────────────────── Fila do WhatsApp ───────────
// Passos de WhatsApp das sequências que o time manda à mão (texto livre, dentro
// da conversa): abre o WhatsApp com a mensagem e marca o envio.
function QueueTab({ product, leads, onBusy }) {
  const { version } = useData();
  const [enrollments, setEnrollments] = useS([]);
  const [sequences, setSequences] = useS([]);
  const [busy, setBusy] = useS(false);
  const [note, setNote] = useS(null);
  const [readError, setReadError] = useS("");
  const [loading, setLoading] = useS(true);
  const writing = useR(false);
  const readVersion = useR(0);
  useE(() => { onBusy(busy); return () => onBusy(false); }, [busy, onBusy]);
  async function reload() {
    const v = ++readVersion.current; setLoading(true); setReadError("");
    const r = await Promise.allSettled([api.list("sequence_enrollments", { saas: product.id, status: "waiting" }), api.list("sequences", { saas: product.id })]);
    if (v !== readVersion.current) return;
    if (r[0].status === "fulfilled") setEnrollments(Array.isArray(r[0].value) ? r[0].value : []);
    if (r[1].status === "fulfilled") setSequences(Array.isArray(r[1].value) ? r[1].value : []);
    if (r.some((x) => x.status === "rejected")) setReadError("Não foi possível atualizar a fila.");
    setLoading(false);
  }
  useE(() => { reload(); return () => { readVersion.current++; }; }, [product.id, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const leadById = Object.fromEntries((leads || []).map((l) => [l.id, l]));
  return <div className="marketing-body disparos-tab" style={{ flex: 1, overflow: "auto" }}>
    {readError && <div role="alert" className="disparos-error">{readError} <button onClick={reload}>Tentar novamente</button></div>}
    {note && <div role="alert" style={{ fontSize: 12.5, color: "var(--neg)" }}>{note}</div>}
    <section className="marketing-card" style={{ padding: 16 }}>
      <div className="card-title">Fila do WhatsApp · {enrollments.length} para mandar</div>
      <div className="card-sub" style={{ marginBottom: 12 }}>passos de WhatsApp das sequências, mandados pelo time · os broadcasts de WhatsApp saem sozinhos pela API e não passam por aqui</div>
      {loading && !enrollments.length && <div role="status" className="dim">Carregando a fila…</div>}
      {!loading && !enrollments.length && <div className="dim" style={{ fontSize: 12.5 }}>Nada pendente: a sequência coloca o lead aqui quando chega a vez de um passo de WhatsApp.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {enrollments.map((en) => {
          const s = sequences.find((x) => x.id === en.sequence);
          const stepDef = s?.steps?.[en.stepIndex];
          const lead = leadById[en.lead];
          const wa = lead && waLink(lead.phone);
          const txt = stepDef?.text && lead ? interpolate(stepDef.text, campaignTokens(lead, product)) : "";
          const waUrl = wa && txt ? `${wa}?text=${encodeURIComponent(txt)}` : null;
          const mark = async () => { if (writing.current) return; writing.current = true; setBusy(true); setNote(null); try { await api.sequenceWaSent(en.id); reload(); } catch (e) { setNote(e.message); } finally { writing.current = false; setBusy(false); } };
          return <div key={en.id} className="disparos-queue-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 16, background: "var(--bg-inset)" }}>
            <span style={{ minWidth: 0, flex: 1 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{lead?.name || en.lead}</span>
              <span className="dim" style={{ fontSize: 11.5, marginLeft: 8 }}>{s?.name || "sequência"} · passo {en.stepIndex + 1}</span>
              {txt && <div className="dim" style={{ fontSize: 12, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={txt}>{txt}</div>}
            </span>
            {waUrl
              ? <a href={waUrl} target="_blank" rel="noopener noreferrer" aria-disabled={busy} onClick={(event) => { if (writing.current) event.preventDefault(); else mark(); }} style={{ display: "inline-flex", alignItems: "center", height: 28, padding: "0 12px", borderRadius: 999, border: "1px solid var(--wa-brand)", color: "var(--wa-brand-deep)", fontSize: 12, fontWeight: 600, textDecoration: "none" }}>abrir WhatsApp ↗</a>
              : <button type="button" onClick={mark} disabled={busy} className="chip" style={{ height: 28, cursor: "pointer" }}>{wa ? "marcar enviado" : "sem telefone · marcar"}</button>}
          </div>;
        })}
      </div>
    </section>
  </div>;
}

// ─────────────────────────────────────────────── Modelos ────────────────────
// Livres (texto do Cockpit: e-mail e WhatsApp dentro da conversa, para
// broadcasts de e-mail e passos de sequência) e oficiais da Meta (aprovados,
// para o broadcast de WhatsApp e para reabrir conversa fora das 24h).
function ModelsTab(props) {
  return <div className="marketing-body disparos-tab" style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
    <section className="marketing-card" style={{ padding: 16 }}>
      <div className="card-title">Modelos oficiais do WhatsApp (Meta)</div>
      <div className="card-sub" style={{ marginBottom: 12 }}>os broadcasts de WhatsApp usam um destes, depois de aprovado pela Meta</div>
      {window.SEED?.CONFIG?.whatsapp?.configured ? <WaTemplateManager /> : <div className="dim" style={{ fontSize: 12.5 }}>Configure o WhatsApp em Configurações → Integrações para criar modelos oficiais.</div>}
    </section>
    <FreeTemplates {...props} />
  </div>;
}

// ─────────────────────────────────────────────── Sequências (drip) ──────────
// Aba de sequências automáticas: cria/edita a sequência (gatilho por etapa +
// passos por canal com delay) e vê a conversão por sequência. Os passos de
// WhatsApp param na aba Fila do WhatsApp até o time mandar.
// Saídas da sequência. `on` é o valor de fábrica: as três primeiras nascem
// ligadas (espelho do exitReasonFor da API), "saiu da etapa" é opt-in porque
// só faz sentido quando a sequência tem gatilho e não some com quem foi
// inscrito na mão.
const EXITS = [
  { key: "won", label: "fechou", on: true },
  { key: "booked", label: "marcou call", on: true },
  { key: "optOut", label: "descadastrou", on: true },
  { key: "stageLeft", label: "saiu da etapa", on: false },
];
const exitOnOf = (ex) => Object.fromEntries(EXITS.map((e) => [e.key, e.on ? ex?.[e.key] !== false : ex?.[e.key] === true]));
function blankSeq(saas, me) {
  return { id: null, saas, name: "", status: "draft", trigger: { stages: [] }, exitOn: exitOnOf({}),
    steps: [{ channel: "email", delayDays: 0, subject: "", body: "" }], createdBy: me };
}

function SequencesTab({ product, leads, stageOptions, leaveRef, onBusy }) {
  const { version } = useData();
  const me = currentUser()?.id || "";
  const [list, setList] = useS([]);
  const [seq, setSeq] = useS(() => blankSeq(product?.id, me));
  const [metrics, setMetrics] = useS([]);
  const [templates, setTemplates] = useS([]);
  const [busy, setBusy] = useS(false);
  const [note, setNote] = useS(null);
  const writing = useR(false);
  const guard = useDraftGuard(sequenceDraft(seq), leaveRef, busy);
  useE(() => { onBusy(busy); return () => onBusy(false); }, [busy, onBusy]);
  const [readError, setReadError] = useS("");
  const [loading, setLoading] = useS(true);
  const readVersion = useR(0);

  async function reload() {
    if (!product?.id) return;
    const version = ++readVersion.current; setLoading(true); setReadError("");
    const results = await Promise.allSettled([api.list("sequences", { saas: product.id }), api.sequenceMetrics(product.id), api.list("drip_templates", { saas: product.id })]);
    if (version !== readVersion.current) return;
    results.forEach((r, i) => { if (r.status === "fulfilled") [setList, setMetrics, setTemplates][i](i === 1 ? r.value?.sequences || [] : Array.isArray(r.value) ? r.value : []); });
    if (results.some((r) => r.status === "rejected")) setReadError("Não foi possível atualizar todos os dados das sequências.");
    setLoading(false);
  }
  useE(() => { reload(); return () => { readVersion.current++; }; }, [product?.id, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const payload = () => ({
    name: seq.name?.trim() || "Sequência sem nome", saas: product.id, status: seq.status || "draft",
    // O gatilho guarda mais que as etapas (ex.: motivos de perda das trilhas de
    // reativação); o PATCH é raso, então o objeto vai inteiro.
    trigger: { ...(seq.trigger || {}), stages: seq.trigger?.stages || [] }, exitOn: seq.exitOn || {}, steps: seq.steps || [],
    createdBy: seq.createdBy || me, createdAt: seq.createdAt || new Date().toISOString(),
  });
  async function save() {
    if (!product?.id || writing.current) return;
    const semModelo = (seq.steps || []).findIndex((st) => st.channel === "whatsapp" && (st.mode === "template" || st.template) && !templateReady(st.template));
    if (semModelo >= 0) { setNote({ ok: false, text: `Passo ${semModelo + 1}: escolha o modelo aprovado e preencha as variáveis (ou volte para texto livre).` }); return; }
    writing.current = true;
    setBusy(true); setNote(null);
    try {
      if (seq.id) await api.update("sequences", seq.id, payload());
      else { const c = await api.create("sequences", payload()); setSeq((s) => ({ ...s, id: c.id })); }
      guard.clean(); reload(); setNote({ ok: true, text: "sequência salva" });
    } catch (e) { setNote({ ok: false, text: e.message }); }
    writing.current = false; setBusy(false);
  }
  async function removeSeq() {
    if (writing.current || !seq.id || !window.confirm(`Apagar a sequência “${seq.name || "sem nome"}”? As inscrições param.`)) return;
    writing.current = true; setBusy(true);
    try { await api.remove("sequences", seq.id); const next = blankSeq(product?.id, me); guard.clean(sequenceDraft(next)); setSeq(next); reload(); setNote({ ok: true, text: "sequência apagada" }); } catch (e) { setNote({ ok: false, text: e.message }); }
    finally { writing.current = false; setBusy(false); }
  }
  function loadSeq(s) {
    if (!guard.confirm()) return;
    const next = s ? { id: s.id, saas: s.saas, name: s.name || "", status: s.status || "draft",
      trigger: { ...(s.trigger || {}), stages: s.trigger?.stages || [] }, exitOn: exitOnOf(s.exitOn),
      steps: (s.steps || []).map((st) => ({ ...st })), createdAt: s.createdAt, createdBy: s.createdBy } : blankSeq(product?.id, me);
    guard.clean(sequenceDraft(next)); setSeq(next); setNote(null);
  }
  const setStep = (i, patch) => setSeq((s) => ({ ...s, steps: s.steps.map((st, j) => (j === i ? { ...st, ...patch } : st)) }));
  const addStep = (channel) => setSeq((s) => ({ ...s, steps: [...s.steps, channel === "whatsapp" ? { channel: "whatsapp", delayDays: 3, text: "" } : { channel: "email", delayDays: 3, subject: "", body: "" }] }));
  const removeStep = (i) => setSeq((s) => ({ ...s, steps: s.steps.filter((_, j) => j !== i) }));
  const toggleTrigger = (st) => setSeq((s) => { const set = new Set(s.trigger?.stages || []); set.has(st) ? set.delete(st) : set.add(st); return { ...s, trigger: { ...(s.trigger || {}), stages: [...set] } }; });

  const myMetrics = metrics.find((m) => m.id === seq.id);
  const waOn = !!window.SEED?.CONFIG?.whatsapp?.configured;
  const hasWa = (seq.steps || []).some((st) => st.channel === "whatsapp");
  const tplRes = useSwr(waOn && hasWa ? "wa/templates" : null, () => api.waMetaTemplates(), { ttl: 60_000 });
  const approved = tplRes.data?.templates || [];
  const [enrollOpen, setEnrollOpen] = useS(false);

  const box = { border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: 14 };
  const field = { width: "100%", padding: "7px 9px", background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 12.5 };
  const chip = (on) => ({ height: 26, padding: "0 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 600, cursor: "pointer", border: "1px solid " + (on ? "var(--accent-line)" : "var(--line-2)"), background: on ? "var(--accent-soft)" : "var(--bg-1)", color: on ? "var(--accent)" : "var(--fg-2)" });

  if (!product) return null;

  return (
    <fieldset disabled={busy} className="disparos-tab disparos-sequences">
      {readError && <div role="alert" className="disparos-error">{readError} <button onClick={reload}>Tentar novamente</button></div>}
      {loading && <div role="status" className="dim">Atualizando sequências…</div>}
      {note && <div role={note.ok ? "status" : "alert"} className="mono" style={{ fontSize: 12, color: note.ok ? "var(--pos)" : "var(--neg)" }}>{note.text}</div>}

      {/* Sequências salvas */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span className="kicker">sequências</span>
        {list.map((s) => (
          <button key={s.id} onClick={() => loadSeq(s)} style={{ ...chip(seq.id === s.id), display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: s.status === "active" ? "var(--pos)" : s.status === "paused" ? "var(--warn)" : "var(--fg-4)" }} />
            {s.name || "sem nome"}
          </button>
        ))}
        <button onClick={() => loadSeq(null)} className="mono dim" style={{ height: 26, padding: "0 10px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-2)", fontSize: 12 }}>+ nova</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: 14 }}>
        {/* Editor da sequência */}
        <div className="disparos-sequence-editor" style={{ ...box, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label className="disparos-label" style={{flex:1}}>Nome da sequência<input aria-label="Nome da sequência" value={seq.name} onChange={(e) => setSeq((s) => ({ ...s, name: e.target.value }))} placeholder="nome da sequência" style={{ ...field, flex: 1 }} /></label>
            <div className="disparos-label" style={{ width: 140 }}>Estado
              <SelectPopover label="Estado da sequência" value={seq.status} onChange={(v) => setSeq((s) => ({ ...s, status: v }))}
                options={[{ value: "draft", label: "rascunho", tone: "var(--fg-4)" }, { value: "active", label: "ativa", tone: "var(--pos)" }, { value: "paused", label: "pausada", tone: "var(--warn)" }]} /></div>
          </div>

          <div>
            <div className="kicker">Gatilho · entra quem está nestas etapas</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              {(stageOptions || []).map((st) => <button key={st} onClick={() => toggleTrigger(st)} style={chip((seq.trigger?.stages || []).includes(st))}>{st}</button>)}
            </div>
            {(!seq.trigger?.stages || !seq.trigger.stages.length) && <div className="mono dim" style={{ fontSize: 10.5, marginTop: 4 }}>sem gatilho a sequência não inscreve ninguém (você ainda pode inscrever na mão)</div>}
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="kicker">Passos</div>
              <span style={{ display: "inline-flex", gap: 6 }}>
                <button onClick={() => addStep("email")} className="mono" style={{ ...chip(false), height: 24, fontSize: 11 }}>+ e-mail</button>
                <button onClick={() => addStep("whatsapp")} className="mono" style={{ ...chip(false), height: 24, fontSize: 11 }}>+ WhatsApp</button>
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
              {seq.steps.map((st, i) => (
                <div key={i} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", padding: 10, background: "var(--bg-inset)" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                    <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)" }}>{i + 1}. {CH_LABEL[st.channel]}</span>
                    <span className="mono dim" style={{ fontSize: 10.5, marginLeft: "auto" }}>esperar</span>
                    <input aria-label={`Espera do passo ${i + 1} em dias`} type="number" min="0" value={st.delayDays ?? 0} onChange={(e) => setStep(i, { delayDays: Number(e.target.value) })} style={{ ...field, width: 58, padding: "4px 6px" }} />
                    <span className="mono dim" style={{ fontSize: 10.5 }}>dias</span>
                    <button aria-label={`Remover passo ${i + 1}`} onClick={() => removeStep(i)} className="mono dim" title="remover passo" style={{ fontSize: 13, color: "var(--neg)" }}>✕</button>
                  </div>
                  {templates.filter((t) => t.channel === st.channel).length > 0 && (
                    <div style={{ marginBottom: 6, maxWidth: 320 }}>
                      <SelectPopover label={`Modelo do passo ${i + 1}`} value="" placeholder="usar modelo livre…" size="sm"
                        onChange={(id) => { const t = templates.find((x) => x.id === id); if (t) setStep(i, st.channel === "email" ? { subject: t.subject || "", body: t.body || "" } : { text: t.text || "" }); }}
                        options={templates.filter((t) => t.channel === st.channel).map((t) => ({ value: t.id, label: t.name || "sem nome" }))} /></div>
                  )}
                  {st.channel === "email" ? (
                    <>
                      <input aria-label={`Assunto do passo ${i + 1}`} value={st.subject || ""} onChange={(e) => setStep(i, { subject: e.target.value })} placeholder="assunto · {{nome}}" style={{ ...field, marginBottom: 6 }} />
                      <textarea aria-label={`Mensagem do passo ${i + 1}`} value={st.body || ""} onChange={(e) => setStep(i, { body: e.target.value })} rows={3} placeholder="corpo do e-mail · {{nome}} {{empresa}}" style={{ ...field, resize: "vertical", fontFamily: "inherit" }} />
                    </>
                  ) : (
                    <>
                      <div style={{ marginBottom: 6, maxWidth: 360 }}>
                        <SelectPopover label={`Como sai o passo ${i + 1}`} size="sm" value={st.template ? "template" : "text"}
                          onChange={(v) => setStep(i, v === "template" ? { template: st.template || null, mode: "template" } : { template: undefined, mode: "text" })}
                          options={[{ value: "text", label: "texto livre · o time manda pela Fila do WhatsApp" }, { value: "template", label: "modelo oficial · sai sozinho pela API", hint: waOn ? "" : "WhatsApp não configurado" }]} /></div>
                      {st.mode === "template" || st.template
                        ? <WaTemplateFields prefix={`Passo ${i + 1} · `} tpl={st.template || null} approved={approved} listError={!!tplRes.error} disabled={!waOn} onChange={(t) => setStep(i, { template: t, mode: "template" })} />
                        : <textarea aria-label={`Mensagem do passo ${i + 1}`} value={st.text || ""} onChange={(e) => setStep(i, { text: e.target.value })} rows={3} placeholder="mensagem de WhatsApp · {{nome}} (o time manda pela Fila do WhatsApp)" style={{ ...field, resize: "vertical", fontFamily: "inherit" }} />}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span className="kicker">sai quando</span>
            {EXITS.map(({ key, label }) => (
              <label key={key} style={{ display: "inline-flex", gap: 5, alignItems: "center", fontSize: 12 }}>
                <input type="checkbox" checked={!!seq.exitOn?.[key]} onChange={(e) => setSeq((s) => ({ ...s, exitOn: { ...s.exitOn, [key]: e.target.checked } }))} />
                {label}
              </label>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={save} disabled={busy} style={{ height: 30, padding: "0 14px", borderRadius: 999, background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))", fontSize: 12.5, fontWeight: 600 }}>{busy ? "salvando…" : "salvar sequência"}</button>
            {seq.id && <button type="button" onClick={() => setEnrollOpen(true)} style={{ height: 30, padding: "0 12px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 12, fontWeight: 600 }}>inscrever leads…</button>}
            {seq.id && <button onClick={removeSeq} className="mono dim" style={{ height: 30, padding: "0 10px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-2)", fontSize: 12, color: "var(--neg)" }}>apagar</button>}
            {seq.status !== "active" && seq.id && <span className="mono dim" style={{ fontSize: 10.5, alignSelf: "center" }}>ative a sequência pra ela começar a inscrever e disparar</span>}
          </div>
        </div>

        {/* Métricas + fila de WhatsApp */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={box}>
            <div className="kicker" style={{ marginBottom: 8 }}>Resultados · conversão no funil</div>
            {myMetrics ? (
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                {[["inscritos", myMetrics.enrolled], ["avançou", myMetrics.advanced], ["marcou call", myMetrics.booked], ["fechou", myMetrics.won]].map(([lbl, v]) => (
                  <div key={lbl}><div className="tnum" style={{ fontSize: 20, fontWeight: 700, color: lbl === "fechou" && v ? "var(--pos)" : "var(--fg-1)" }}>{v}</div><div className="kicker">{lbl}</div></div>
                ))}
                <div style={{ marginLeft: "auto", alignSelf: "center", fontSize: 11, color: "var(--fg-3)" }} className="mono">
                  {myMetrics.statusCounts?.active || 0} ativos · {myMetrics.statusCounts?.waiting || 0} no whats · {myMetrics.statusCounts?.done || 0} concluídos · {myMetrics.statusCounts?.exited || 0} saíram
                </div>
              </div>
            ) : <div className="mono dim" style={{ fontSize: 12 }}>salve e ative a sequência pra ver a conversão</div>}
          </div>

          <div className="dim" style={{ fontSize: 12 }}>Passo de WhatsApp com modelo oficial sai sozinho pela API; com texto livre, aparece na aba <b>Fila do WhatsApp</b> quando chega a vez.</div>
          {enrollOpen && <EnrollModal seq={seq} leads={leads} onClose={(n) => { setEnrollOpen(false); if (n != null) { setNote({ ok: true, text: `${n} lead${n === 1 ? "" : "s"} inscrito${n === 1 ? "" : "s"}${seq.status === "active" ? "" : " (a sequência só envia depois de ativa)"}` }); reload(); } }} />}
        </div>
      </div>
    </fieldset>
  );
}

// ─────────────────────────────────────────────── Templates ──────────────────
// Modelos livres: texto do Cockpit reutilizado nos broadcasts de e-mail e nos
// passos das sequências (o de WhatsApp vale dentro da conversa, pela fila).
function FreeTemplates({ product, leaveRef, onBusy }) {
  const { version } = useData();
  const [list, setList] = useS([]);
  const [t, setT] = useS(emptyTemplate);
  const [note, setNote] = useS(null);
  const [busy, setBusy] = useS(false);
  const writing = useR(false);
  const guard = useDraftGuard(t, leaveRef, busy);
  useE(() => { onBusy(busy); return () => onBusy(false); }, [busy, onBusy]);
  const [readError, setReadError] = useS("");
  const [loading, setLoading] = useS(true);
  const readVersion = useR(0);
  function edit(next) { if (!guard.confirm()) return; guard.clean(next); setT(next); setNote(null); }

  async function reload() {
    const revision = ++readVersion.current; setLoading(true); setReadError("");
    try { const rows = await api.list("drip_templates", { saas: product.id }); if (revision === readVersion.current) setList(Array.isArray(rows) ? rows : []); }
    catch { if (revision === readVersion.current) setReadError("Não foi possível atualizar a biblioteca."); }
    finally { if (revision === readVersion.current) setLoading(false); }
  }
  useE(() => { reload(); return () => { readVersion.current++; }; }, [product?.id, version]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (writing.current) return;
    writing.current = true; setBusy(true);
    setNote(null);
    const doc = { name: t.name?.trim() || "Template", saas: product.id, channel: t.channel, subject: t.subject || "", body: t.body || "", text: t.text || "" };
    try {
      if (t.id) await api.update("drip_templates", t.id, doc);
      else await api.create("drip_templates", doc);
      guard.clean(emptyTemplate()); setT(emptyTemplate());
      reload(); setNote({ ok: true, text: "template salvo" });
    } catch (e) { setNote({ ok: false, text: e.message }); }
    finally { writing.current = false; setBusy(false); }
  }
  async function del(row) {
    if (writing.current || !window.confirm(`Apagar o template “${row.name || "sem nome"}” da biblioteca?`)) return;
    writing.current = true; setBusy(true);
    try { await api.remove("drip_templates", row.id); if (t.id === row.id) { guard.clean(emptyTemplate()); setT(emptyTemplate()); } reload(); setNote({ ok: true, text: "template apagado" }); }
    catch (e) { setNote({ ok: false, text: e.message }); }
    finally { writing.current = false; setBusy(false); }
  }

  const box = { border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: 14 };
  const field = { width: "100%", padding: "7px 9px", background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 12.5 };
  if (!product) return null;

  return (
    <fieldset disabled={busy} className="marketing-card disparos-templates" style={{ padding: 16, margin: 0 }}>
      <div className="card-title">Modelos livres</div>
      <div className="card-sub" style={{ marginBottom: 12 }}>texto do Cockpit para broadcasts de e-mail e passos de sequência</div>
      {readError && <div role="alert" className="disparos-error">{readError} <button onClick={reload}>Tentar novamente</button></div>}
      {loading && <div role="status" className="dim">Atualizando biblioteca…</div>}
      {note && <div role={note.ok ? "status" : "alert"} className="mono" style={{ fontSize: 12, color: note.ok ? "var(--pos)" : "var(--neg)" }}>{note.text}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 14 }}>
        <div style={{ ...box, display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="kicker">{t.id ? "editar modelo livre" : "novo modelo livre"}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <label className="disparos-label" style={{flex:1}}>Nome<input aria-label="Nome do template" value={t.name} onChange={(e) => setT((x) => ({ ...x, name: e.target.value }))} placeholder="nome" style={{ ...field, flex: 1 }} /></label>
            <div className="disparos-label" style={{ width: 140 }}>Canal
              <SelectPopover label="Canal do template" value={t.channel} onChange={(v) => setT((x) => ({ ...x, channel: v }))}
                options={[{ value: "email", label: "E-mail" }, { value: "whatsapp", label: "WhatsApp" }]} /></div>
          </div>
          {t.channel === "email" ? (
            <>
              <label className="disparos-label">Assunto<input aria-label="Assunto do template" value={t.subject} onChange={(e) => setT((x) => ({ ...x, subject: e.target.value }))} placeholder="assunto · {{nome}}" style={field} /></label>
              <label className="disparos-label">Mensagem<textarea aria-label="Mensagem do template" value={t.body} onChange={(e) => setT((x) => ({ ...x, body: e.target.value }))} rows={5} placeholder="corpo · {{nome}} {{empresa}}" style={{ ...field, resize: "vertical", fontFamily: "inherit" }} /></label>
            </>
          ) : (
            <label className="disparos-label">Mensagem<textarea aria-label="Mensagem do template" value={t.text} onChange={(e) => setT((x) => ({ ...x, text: e.target.value }))} rows={4} placeholder="mensagem · {{nome}}" style={{ ...field, resize: "vertical", fontFamily: "inherit" }} /></label>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={save} style={{ height: 30, padding: "0 14px", borderRadius: 999, background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))", fontSize: 12.5, fontWeight: 600 }}>{busy ? "salvando…" : t.id ? "salvar" : "criar modelo"}</button>
            {t.id && <button onClick={() => edit(emptyTemplate())} className="mono dim" style={{ fontSize: 12 }}>cancelar</button>}
          </div>
        </div>

        <div style={{ ...box }}>
          <div className="kicker" style={{ marginBottom: 8 }}>Biblioteca · {list.length}</div>
          {list.length === 0 ? <div className="mono dim" style={{ fontSize: 12 }}>nenhum template ainda</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {list.map((x) => (
                <div key={x.id} className="disparos-library-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)" }}>
                  <span className="mono" style={{ fontSize: 10, color: "var(--accent)", width: 58 }}>{CH_LABEL[x.channel] || x.channel}</span>
                  <span title={x.name} style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.name || "sem nome"}</span>
                  <button onClick={() => edit({ id: x.id, channel: x.channel || "email", name: x.name || "", subject: x.subject || "", body: x.body || "", text: x.text || "" })} className="mono dim" style={{ fontSize: 11 }}>editar</button>
                  <button onClick={() => del(x)} className="mono dim" style={{ fontSize: 11, color: "var(--neg)" }}>apagar</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </fieldset>
  );
}

export { DisparosScreen };
