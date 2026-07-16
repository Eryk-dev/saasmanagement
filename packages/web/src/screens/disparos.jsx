import React from "react";
import { PageHead, Pill, Segmented } from "../components/viz.jsx";
import { EmptyState } from "../atoms.jsx";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { useActiveSaas } from "../lib/workspace.js";
import { waLink } from "../lib/ui.js";
import { currentUser } from "../lib/users.js";
import { stageKind, workableStages } from "../lib/funnel.js";
import { scriptTokens } from "../lib/scripts.js";
import { WaHealthBanner } from "./whatsapp.jsx";

// Disparos — campanhas de e-mail + WhatsApp pros leads QUALIFICADOS (nutrição /
// reativação em massa). O operador: (1) escolhe o PÚBLICO por etapa do funil,
// (2) compõe a mensagem (com tokens {{nome}} e ajuda de IA) e (3) DISPARA numa
// FILA ASSISTIDA: por lead, abre o WhatsApp/Gmail já preenchido e marca o envio
// (que vira toque na timeline). O progresso fica salvo na campanha.
// Fase 1: WhatsApp por wa.me + e-mail via rascunho no Gmail (sem escopo novo).
// Fase 2 troca o rascunho por envio nativo em massa pela conta Google conectada.

const { useState: useS, useEffect: useE, useMemo: useM } = React;

// Kinds que contam como "qualificado + Nutrição" (o default do público, escolha
// do Leo): venda ativa (qualificação, call, proposta, follow-up) + "em contato"
// (Nutrição/reativação). Fora ficam novo, integração/pós-venda e terminais.
const QUALIFIED_KINDS = new Set(["qualificacao", "call", "proposta", "followup", "contato"]);

const TOKENS = [
  ["nome", "primeiro nome"], ["empresa", "empresa"], ["nicho", "nicho"],
  ["contas", "contas"], ["anuncios", "anúncios"],
];

// Troca {{token}} pelos dados do lead; token desconhecido fica visível (pra o
// operador notar o erro de digitação no preview).
function interpolate(text, tokens) {
  return String(text || "").replace(/\{\{(\w+)\}\}/g, (_, k) => (tokens && tokens[k] != null ? tokens[k] : `{{${k}}}`));
}

const gmailCompose = (to, su, body) =>
  `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(su)}&body=${encodeURIComponent(body)}`;

function blankCamp(me) {
  return { id: null, name: "", status: "draft", channels: { email: false, whatsapp: true }, email: { subject: "", body: "" }, wa: { text: "" }, sent: {}, createdAt: "", createdBy: me };
}

function DisparosScreen({ onOpenLead }) {
  const { version } = useData();
  const [product] = useActiveSaas();
  const me = currentUser()?.id || "";

  const leads = useM(() => (window.SEED?.LEADS || []).filter((l) => l.saas === product?.id), [product?.id, version]);
  // Etapas trabalháveis do funil (não terminais) viram os toggles do público.
  const stageOptions = useM(() => workableStages(product), [product?.id, version]);
  const defaultStages = useM(
    () => stageOptions.filter((st) => QUALIFIED_KINDS.has(stageKind(product, st))),
    [stageOptions, product?.id, version],
  );

  const [camp, setCamp] = useS(() => blankCamp(me));
  const [stagesSel, setStagesSel] = useS(() => new Set());
  const [selected, setSelected] = useS(() => new Set());
  const [search, setSearch] = useS("");
  const [campaigns, setCampaigns] = useS([]);
  const [activeField, setActiveField] = useS("wa"); // onde o chip de token insere
  const [saving, setSaving] = useS(false);
  const [aiBusy, setAiBusy] = useS(false);
  const [emailBusy, setEmailBusy] = useS(false);
  const [metrics, setMetrics] = useS([]); // [{ id, name, sent, advanced, booked, won }]
  const [note, setNote] = useS(null);   // { ok, text }
  const [err, setErr] = useS(null);
  const [tab, setTab] = useS("disparos"); // disparos | sequencias | templates
  const gmailOn = !!window.SEED?.CONFIG?.google?.gmail; // escopo de envio concedido?

  // Carrega as campanhas salvas do produto + as métricas + arma o público padrão.
  useE(() => {
    if (!product?.id) return;
    setStagesSel(new Set(defaultStages));
    let alive = true;
    api.list("campaigns", { saas: product.id })
      .then((cs) => alive && setCampaigns(Array.isArray(cs) ? cs : []))
      .catch(() => alive && setCampaigns([]));
    api.campaignMetrics(product.id)
      .then((r) => alive && setMetrics(Array.isArray(r?.campaigns) ? r.campaigns : []))
      .catch(() => alive && setMetrics([]));
    return () => { alive = false; };
  }, [product?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function refreshMetrics() {
    if (!product?.id) return;
    api.campaignMetrics(product.id).then((r) => setMetrics(Array.isArray(r?.campaigns) ? r.campaigns : [])).catch(() => {});
  }

  const stagesKey = [...stagesSel].sort().join("|");
  const recipients = useM(() => leads.filter((l) => stagesSel.has(l.stage)), [leads, stagesKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Público muda → seleciona todo mundo do novo segmento (o operador desmarca quem não quer).
  useE(() => { setSelected(new Set(recipients.map((l) => l.id))); }, [stagesKey, product?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function refreshCampaigns() {
    if (!product?.id) return;
    api.list("campaigns", { saas: product.id }).then((cs) => setCampaigns(Array.isArray(cs) ? cs : [])).catch(() => {});
  }

  const draftPayload = () => ({
    name: camp.name?.trim() || "Disparo sem nome",
    saas: product.id,
    status: camp.status || "draft",
    stages: [...stagesSel],
    channels: camp.channels,
    email: camp.email,
    wa: camp.wa,
    createdBy: camp.createdBy || me,
    createdAt: camp.createdAt || new Date().toISOString(),
  });

  // Cria a campanha na 1ª necessidade (o mark precisa de um id). Não re-salva a
  // cada envio — o botão "salvar" persiste as edições da composição.
  async function ensureSaved() {
    if (camp.id) return camp.id;
    const created = await api.create("campaigns", { ...draftPayload(), sent: {} });
    setCamp((c) => ({ ...c, id: created.id, createdAt: created.createdAt || c.createdAt }));
    refreshCampaigns();
    return created.id;
  }

  async function save() {
    if (!product?.id) return;
    setSaving(true); setErr(null); setNote(null);
    try {
      if (camp.id) await api.update("campaigns", camp.id, draftPayload());
      else { const c = await api.create("campaigns", { ...draftPayload(), sent: {} }); setCamp((x) => ({ ...x, id: c.id, createdAt: c.createdAt || x.createdAt })); }
      refreshCampaigns();
      setNote({ ok: true, text: "campanha salva" });
    } catch (e) { setNote({ ok: false, text: e.message }); }
    setSaving(false);
  }

  function loadCampaign(c) {
    setCamp({
      id: c.id, name: c.name || "", status: c.status || "draft",
      channels: { email: !!c.channels?.email, whatsapp: c.channels?.whatsapp !== false },
      email: { subject: c.email?.subject || "", body: c.email?.body || "" },
      wa: { text: c.wa?.text || "" }, sent: c.sent || {}, createdAt: c.createdAt || "", createdBy: c.createdBy || me,
    });
    setStagesSel(new Set(c.stages || []));
    setNote(null); setErr(null);
  }
  function newCampaign() {
    setCamp(blankCamp(me)); setStagesSel(new Set(defaultStages)); setNote(null); setErr(null);
  }

  // Marca um envio feito (o operador clicou pra abrir o Whats/Gmail do lead). O
  // href do link já abre a conversa; aqui só registramos o progresso + o toque.
  async function mark(lead, channel) {
    setErr(null);
    try {
      const id = await ensureSaved();
      const updated = await api.campaignMark(id, { leadId: lead.id, channel });
      setCamp((c) => ({ ...c, id, status: updated.status || c.status, sent: updated.sent || c.sent }));
      refreshCampaigns();
    } catch (e) { setErr(`não deu pra marcar o envio: ${e.message}`); }
  }

  // Envio NATIVO de e-mail em massa (Gmail): manda pra todo lead selecionado com
  // e-mail e ainda pendente. O servidor pula quem não tem e-mail / descadastrou.
  async function sendEmails() {
    const ids = chosen.filter((l) => l.email && !l.emailOptOut && !camp.sent?.[l.id]?.email).map((l) => l.id);
    if (!ids.length) { setNote({ ok: false, text: "nenhum lead com e-mail pendente na seleção" }); return; }
    if (!camp.email?.subject && !camp.email?.body) { setNote({ ok: false, text: "escreva o assunto/corpo do e-mail primeiro" }); return; }
    setEmailBusy(true); setErr(null); setNote(null);
    try {
      const id = await ensureSaved();
      const r = await api.campaignSendEmail(id, ids);
      setCamp((c) => ({ ...c, id, status: "sending", sent: r.sent || c.sent }));
      refreshCampaigns(); refreshMetrics();
      const fail = (r.results || []).filter((x) => !x.ok).length;
      setNote({ ok: r.ok > 0, text: `${r.ok} e-mail(s) enviado(s)${fail ? `, ${fail} pulado(s)` : ""}` });
    } catch (e) { setErr(`falha no envio: ${e.message}`); }
    setEmailBusy(false);
  }

  async function genCopy() {
    setAiBusy(true); setErr(null);
    try {
      const channel = camp.channels.email && camp.channels.whatsapp ? "ambos" : camp.channels.email ? "email" : "whatsapp";
      const publico = `${selected.size} leads em ${[...stagesSel].join(", ") || "etapas selecionadas"}`;
      const r = await api.campaignAiCopy({ channel, publico, productName: product?.name || "" });
      setCamp((c) => ({
        ...c,
        email: { subject: r.subject || c.email.subject, body: r.body || c.email.body },
        wa: { text: r.whatsapp || c.wa.text },
      }));
      setNote({ ok: true, text: "copy gerada pela IA · revise antes de disparar" });
    } catch (e) { setNote({ ok: false, text: e.message }); }
    setAiBusy(false);
  }

  if (!product) return <EmptyState title="Sem produto ativo" hint="Escolha um produto no seletor da barra lateral." />;

  const toggleStage = (st) => setStagesSel((prev) => { const n = new Set(prev); n.has(st) ? n.delete(st) : n.add(st); return n; });
  const toggleLead = (id) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSelected = recipients.length > 0 && recipients.every((l) => selected.has(l.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(recipients.map((l) => l.id)));

  const shown = search.trim()
    ? recipients.filter((l) => `${l.name || ""} ${l.company || ""}`.toLowerCase().includes(search.trim().toLowerCase()))
    : recipients;
  const chosen = recipients.filter((l) => selected.has(l.id));
  const withWa = chosen.filter((l) => waLink(l.phone) && !l.whatsappInvalid && !l.whatsappOptOut).length;
  const withEmail = chosen.filter((l) => l.email).length;
  const sentWa = chosen.filter((l) => camp.sent?.[l.id]?.whatsapp).length;
  const sentEmail = chosen.filter((l) => camp.sent?.[l.id]?.email).length;
  const pendingEmail = chosen.filter((l) => l.email && !l.emailOptOut && !camp.sent?.[l.id]?.email).length;

  const sampleLead = chosen[0] || recipients[0] || null;
  const sampleTokens = sampleLead ? scriptTokens(sampleLead, product) : null;
  const insertToken = (tok) => {
    const t = `{{${tok}}}`;
    if (activeField === "subject") setCamp((c) => ({ ...c, email: { ...c.email, subject: (c.email.subject || "") + t } }));
    else if (activeField === "body") setCamp((c) => ({ ...c, email: { ...c.email, body: (c.email.body || "") + t } }));
    else setCamp((c) => ({ ...c, wa: { text: (c.wa.text || "") + t } }));
  };

  const channel = camp.channels.email ? "email" : "wa";
  const setChannel = (value) => setCamp((current) => ({
    ...current,
    channels: { email: value === "email", whatsapp: value === "wa" },
    ...(value === "email" && !current.email.subject && current.name ? { email: { ...current.email, subject: current.name } } : {}),
  }));
  const relativeTouch = (lead) => {
    const at = lead.stageSince || lead.updatedAt || lead.createdAt;
    if (!at) return "—";
    const days = Math.max(0, Math.floor((Date.now() - new Date(at).getTime()) / 86400e3));
    if (days === 0) return "hoje";
    if (days === 1) return "ontem";
    return `há ${days} dias`;
  };
  const stageCount = (stage) => leads.filter((lead) => lead.stage === stage).length;
  const messageReady = channel === "email" ? !!camp.email.body : !!camp.wa.text;
  async function sendPrimary() {
    if (!chosen.length || !messageReady) return;
    if (channel === "email" && gmailOn) {
      await sendEmails();
      return;
    }
    const lead = channel === "wa"
      ? chosen.find((item) => waLink(item.phone) && !item.whatsappInvalid && !item.whatsappOptOut)
      : chosen.find((item) => item.email && !item.emailOptOut);
    if (!lead) { setNote({ ok: false, text: channel === "wa" ? "nenhum selecionado tem WhatsApp válido" : "nenhum selecionado tem e-mail válido" }); return; }
    const tokens = scriptTokens(lead, product);
    const url = channel === "wa"
      ? `${waLink(lead.phone)}?text=${encodeURIComponent(interpolate(camp.wa.text, tokens))}`
      : gmailCompose(lead.email, interpolate(camp.email.subject || camp.name, tokens), interpolate(camp.email.body, tokens));
    window.open(url, "_blank", "noopener,noreferrer");
    await mark(lead, channel === "wa" ? "whatsapp" : "email");
    setNote({ ok: true, text: `${lead.name || "Lead"} aberto para envio · continue pelos selecionados` });
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <PageHead title="Disparos" sub={tab === "disparos" ? `${recipients.length} no público · ${selected.size} selecionados · campanhas de e-mail e WhatsApp` : tab === "sequencias" ? "sequências automáticas de nutrição (drip)" : "biblioteca de conteúdo reutilizável"}>
        <Segmented value={tab} onChange={setTab} options={[{ value: "disparos", label: "Disparos" }, { value: "sequencias", label: "Sequências" }, { value: "templates", label: "Templates" }]} />
      </PageHead>

      {tab === "sequencias" && <SequencesTab product={product} leads={leads} stageOptions={stageOptions} defaultStages={defaultStages} />}
      {tab === "templates" && <TemplatesTab product={product} />}

      {tab === "disparos" && (
        <div style={{ flex: 1, overflow: "auto", padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16 }}>
          {note && <div className="mono" style={{ fontSize: 12, color: note.ok ? "var(--pos)" : "var(--neg)" }}>{note.text}</div>}
          {err && <div className="mono" style={{ fontSize: 12, color: "var(--neg)" }}>{err}</div>}

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "var(--fg-4)" }}>público por etapa:</span>
            {stageOptions.map((stage) => {
              const active = stagesSel.has(stage);
              return <button key={stage} onClick={() => toggleStage(stage)} style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 34, padding: "0 12px", borderRadius: 999, border: `1px solid ${active ? "var(--btn-bg)" : "var(--line-2)"}`, background: active ? "var(--btn-bg)" : "var(--bg-1)", color: active ? "var(--btn-fg)" : "var(--fg-2)", fontSize: 12.5, fontWeight: 600 }}>{stage}<span className="tnum" style={{ fontSize: 11.5, opacity: .65 }}>{stageCount(stage)}</span></button>;
            })}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 16, alignItems: "start" }}>
            <section style={{ background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", boxShadow: "var(--shadow-card)", overflow: "hidden", minWidth: 0 }}>
              <div style={{ overflowX: "auto" }}><div style={{ minWidth: 620 }}>
                <div style={{ display: "grid", gridTemplateColumns: "40px 1.3fr 1.1fr .9fr .9fr", gap: 12, padding: "12px 20px", fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--fg-4)", borderBottom: "1px solid var(--line-1)", background: "var(--bg-inset)", alignItems: "center" }}>
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ width: 18, height: 18, accentColor: "var(--accent)" }} /><span>Lead</span><span>Empresa</span><span>Etapa</span><span>Último toque</span>
                </div>
                {shown.slice(0, 5).map((lead) => (
                  <div key={lead.id} style={{ display: "grid", gridTemplateColumns: "40px 1.3fr 1.1fr .9fr .9fr", gap: 12, padding: "13px 20px", alignItems: "center", borderBottom: "1px solid var(--line-faint)" }}>
                    <input type="checkbox" checked={selected.has(lead.id)} onChange={() => toggleLead(lead.id)} style={{ width: 18, height: 18, accentColor: "var(--accent)" }} />
                    <button onClick={() => onOpenLead?.(lead)} style={{ textAlign: "left", fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lead.name || "sem nome"}</button>
                    <span style={{ fontSize: 13, color: "var(--fg-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lead.company || "—"}</span>
                    <span><Pill tone="mut">{lead.stage}</Pill></span>
                    <span className="tnum" style={{ fontSize: 12.5, color: "var(--fg-3)" }}>{relativeTouch(lead)}</span>
                  </div>
                ))}
                {!shown.length && <div style={{ padding: "18px 20px", color: "var(--fg-4)", fontSize: 13 }}>nenhum lead neste público</div>}
              </div></div>
              <div style={{ padding: "12px 20px", borderTop: "1px solid var(--line-1)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <button onClick={toggleAll} style={{ color: "var(--fg-1)", fontSize: 12.5, fontWeight: 600 }}>{allSelected ? "Limpar seleção" : `Selecionar todos (${recipients.length})`}</button>
                <span style={{ fontSize: 12.5, color: "var(--fg-4)" }}>mostrando {Math.min(5, shown.length)} de {shown.length}</span>
              </div>
            </section>

            <section style={{ background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", boxShadow: "var(--shadow-card)", padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--fg-4)" }}>Nova campanha</div>
              <Segmented value={channel} onChange={setChannel} options={[{ value: "wa", label: "WhatsApp" }, { value: "email", label: "E-mail" }]} />
              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontSize: 12, color: "var(--fg-3)" }}>Template</span>
                <input list="campaign-options" value={camp.name} onChange={(event) => setCamp((current) => ({ ...current, name: event.target.value, email: channel === "email" ? { ...current.email, subject: event.target.value } : current.email }))} placeholder="Retomada · diagnóstico pendente" style={{ width: "100%", height: 38, padding: "0 11px", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 13 }} />
                <datalist id="campaign-options">{campaigns.map((campaign) => <option key={campaign.id} value={campaign.name || "sem nome"} />)}</datalist>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontSize: 12, color: "var(--fg-3)" }}>Mensagem</span>
                <textarea rows={4} value={channel === "email" ? camp.email.body : camp.wa.text} onChange={(event) => setCamp((current) => channel === "email" ? { ...current, email: { ...current.email, body: event.target.value } } : { ...current, wa: { text: event.target.value } })} placeholder="Oi {{nome}}! Seu diagnóstico da {{empresa}} ficou pronto — posso te mandar o resumo aqui mesmo?" style={{ width: "100%", minHeight: 96, padding: "9px 11px", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 13, lineHeight: 1.5, resize: "vertical", fontFamily: "inherit" }} />
              </label>
              <div style={{ fontSize: 12, color: "var(--fg-4)", lineHeight: 1.5 }}>variáveis: nome, empresa, etapa · o envio respeita a janela de 24h do WhatsApp</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={sendPrimary} disabled={!chosen.length || !messageReady || emailBusy} style={{ height: 40, padding: "0 16px", borderRadius: "var(--r-2)", background: "var(--btn-bg)", color: "var(--btn-fg)", fontSize: 13, fontWeight: 600, opacity: !chosen.length || !messageReady || emailBusy ? .5 : 1 }}>{emailBusy ? "Enviando…" : `Enviar pra ${chosen.length} leads`}</button>
                <button onClick={() => setTab("sequencias")} style={{ height: 40, padding: "0 16px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 13, fontWeight: 600 }}>Agendar</button>
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );

  const box = { border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: 14 };
  const kicker = { fontSize: 10, fontFamily: "var(--mono)", color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase" };
  const field = { width: "100%", padding: "8px 10px", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 13 };
  const chipBtn = (on) => ({ display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 11px", borderRadius: "var(--r-2)", fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid " + (on ? "var(--accent-line)" : "var(--line-2)"), background: on ? "var(--accent-soft)" : "var(--bg-1)", color: on ? "var(--accent)" : "var(--fg-2)" });
  const sendChip = { display: "inline-flex", alignItems: "center", gap: 5, height: 26, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", fontSize: 11.5, fontWeight: 600, textDecoration: "none", cursor: "pointer" };
  const num = { fontSize: 12.5, textAlign: "right", fontVariantNumeric: "tabular-nums" };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <PageHead title="Disparos" sub={tab === "disparos" ? `${recipients.length} no público · ${selected.size} selecionados` : tab === "sequencias" ? "sequências automáticas de nutrição (drip)" : "biblioteca de conteúdo reutilizável"}>
        <span style={{ display: "inline-flex", gap: 4, marginRight: 4 }}>
          {[["disparos", "Disparos"], ["sequencias", "Sequências"], ["templates", "Templates"]].map(([id, lbl]) => (
            <button key={id} onClick={() => setTab(id)} style={{
              height: 26, padding: "0 11px", borderRadius: "var(--r-2)", fontSize: 12, fontWeight: 600, cursor: "pointer",
              border: "1px solid " + (tab === id ? "var(--accent-line)" : "var(--line-2)"),
              background: tab === id ? "var(--accent-soft)" : "var(--bg-1)", color: tab === id ? "var(--accent)" : "var(--fg-2)",
            }}>{lbl}</button>
          ))}
        </span>
        {tab === "disparos" && (
          <>
            <input value={camp.name} onChange={(e) => setCamp((c) => ({ ...c, name: e.target.value }))} placeholder="nome da campanha"
              style={{ ...field, width: 180, height: 26, padding: "0 10px", fontSize: 12.5 }} />
            <Pill tone={camp.status === "sending" ? "warn" : camp.id ? "pos" : "mut"}>{camp.status === "sending" ? "disparando" : camp.id ? "salva" : "rascunho"}</Pill>
            <button onClick={save} disabled={saving}
              style={{ height: 26, padding: "0 12px", borderRadius: "var(--r-2)", background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))", fontSize: 12, fontWeight: 600 }}>
              {saving ? "salvando…" : "salvar"}
            </button>
            <button onClick={newCampaign} className="mono dim" style={{ height: 26, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-2)", fontSize: 12 }}>+ nova</button>
          </>
        )}
      </PageHead>

      {tab === "sequencias" && <SequencesTab product={product} leads={leads} stageOptions={stageOptions} defaultStages={defaultStages} />}
      {tab === "templates" && <TemplatesTab product={product} />}

      {tab === "disparos" && (
      <div style={{ flex: 1, overflow: "auto", padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16 }}>
        <WaHealthBanner style={{ margin: 0 }} />
        {note && <div className="mono" style={{ fontSize: 12, color: note.ok ? "var(--pos)" : "var(--neg)" }}>{note.text}</div>}
        {err && <div className="mono" style={{ fontSize: 12, color: "var(--neg)" }}>{err}</div>}

        {campaigns.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={kicker}>campanhas</span>
            {campaigns.map((c) => {
              const total = Object.keys(c.sent || {}).length;
              return (
                <button key={c.id} onClick={() => loadCampaign(c)} title={`carregar "${c.name || "sem nome"}"`}
                  style={{ ...sendChip, borderColor: camp.id === c.id ? "var(--accent-line)" : "var(--line-2)", color: camp.id === c.id ? "var(--accent)" : "var(--fg-2)" }}>
                  {c.name || "sem nome"}{total ? ` · ${total} env.` : ""}
                </button>
              );
            })}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14 }}>
          {/* ── PÚBLICO ─────────────────────────────────────────────── */}
          <div style={{ ...box, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
            <div style={kicker}>Público · etapas do funil</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {stageOptions.map((st) => (
                <button key={st} onClick={() => toggleStage(st)} style={chipBtn(stagesSel.has(st))}>{st}</button>
              ))}
              {stageOptions.length === 0 && <span className="mono dim" style={{ fontSize: 12 }}>o funil deste produto não tem etapas trabalháveis</span>}
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="buscar por nome ou empresa" style={{ ...field, height: 30 }} />
              <button onClick={toggleAll} className="mono" style={{ ...sendChip, flexShrink: 0 }}>{allSelected ? "limpar" : "todos"}</button>
            </div>
            <div className="mono dim" style={{ fontSize: 11 }}>{selected.size} de {recipients.length} · {withWa} com WhatsApp · {withEmail} com e-mail</div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 380, overflow: "auto" }}>
              {shown.length === 0 && <div className="mono dim" style={{ fontSize: 12, padding: "8px 0" }}>nenhum lead nessas etapas</div>}
              {shown.map((l) => {
                const on = selected.has(l.id);
                const s = camp.sent?.[l.id] || {};
                return (
                  <label key={l.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", background: on ? "var(--bg-inset)" : "transparent", cursor: "pointer" }}>
                    <input type="checkbox" checked={on} onChange={() => toggleLead(l.id)} />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                        <span style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name || "sem nome"}</span>
                        {l.company && <span className="dim" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.company}</span>}
                      </span>
                      <span className="mono dim" style={{ fontSize: 10 }}>{l.stage}</span>
                    </span>
                    <span style={{ display: "inline-flex", gap: 4, flexShrink: 0 }}>
                      <span title={waLink(l.phone) ? "tem WhatsApp" : "sem telefone"} style={{ fontSize: 11, color: s.whatsapp ? "var(--pos)" : waLink(l.phone) ? "var(--fg-3)" : "var(--fg-4)" }}>{s.whatsapp ? "✓" : ""}wpp</span>
                      <span title={l.email ? "tem e-mail" : "sem e-mail"} style={{ fontSize: 11, color: s.email ? "var(--pos)" : l.email ? "var(--fg-3)" : "var(--fg-4)" }}>{s.email ? "✓" : ""}@</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* ── MENSAGEM ────────────────────────────────────────────── */}
          <div style={{ ...box, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={kicker}>Mensagem</div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setCamp((c) => ({ ...c, channels: { ...c.channels, whatsapp: !c.channels.whatsapp } }))} style={chipBtn(camp.channels.whatsapp)}>WhatsApp</button>
                <button onClick={() => setCamp((c) => ({ ...c, channels: { ...c.channels, email: !c.channels.email } }))} style={chipBtn(camp.channels.email)}>E-mail</button>
              </div>
            </div>

            {camp.channels.email && (
              <>
                <div>
                  <label style={kicker}>Assunto do e-mail</label>
                  <input value={camp.email.subject} onFocus={() => setActiveField("subject")}
                    onChange={(e) => setCamp((c) => ({ ...c, email: { ...c.email, subject: e.target.value } }))}
                    placeholder="Ex.: {{nome}}, uma ideia rápida pra sua operação" style={{ ...field, marginTop: 4 }} />
                </div>
                <div>
                  <label style={kicker}>Corpo do e-mail</label>
                  <textarea value={camp.email.body} onFocus={() => setActiveField("body")}
                    onChange={(e) => setCamp((c) => ({ ...c, email: { ...c.email, body: e.target.value } }))}
                    rows={5} placeholder="Oi {{nome}}, …" style={{ ...field, marginTop: 4, resize: "vertical", fontFamily: "inherit" }} />
                </div>
              </>
            )}
            {camp.channels.whatsapp && (
              <div>
                <label style={kicker}>Mensagem de WhatsApp</label>
                <textarea value={camp.wa.text} onFocus={() => setActiveField("wa")}
                  onChange={(e) => setCamp((c) => ({ ...c, wa: { text: e.target.value } }))}
                  rows={4} placeholder="Oi {{nome}}, …" style={{ ...field, marginTop: 4, resize: "vertical", fontFamily: "inherit" }} />
              </div>
            )}

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={kicker}>tokens</span>
              {TOKENS.map(([k, lbl]) => (
                <button key={k} onClick={() => insertToken(k)} title={`inserir ${lbl}`} className="mono"
                  style={{ ...sendChip, height: 24, padding: "0 8px", fontSize: 11 }}>{`{{${k}}}`}</button>
              ))}
              {window.SEED?.CONFIG?.ai?.configured && (
                <button onClick={genCopy} disabled={aiBusy}
                  style={{ ...sendChip, height: 24, padding: "0 10px", fontSize: 11, borderColor: "var(--accent-line)", color: "var(--accent)", marginLeft: "auto" }}>
                  {aiBusy ? "gerando…" : "✨ gerar com IA"}
                </button>
              )}
            </div>

            {sampleLead && (camp.wa.text || camp.email.subject || camp.email.body) && (
              <div style={{ border: "1px dashed var(--line-2)", borderRadius: "var(--r-2)", padding: 10, background: "var(--bg-inset)" }}>
                <div style={kicker}>Prévia · {sampleLead.name}</div>
                {camp.channels.email && (camp.email.subject || camp.email.body) && (
                  <div style={{ marginTop: 6, fontSize: 12.5 }}>
                    <div style={{ fontWeight: 600 }}>{interpolate(camp.email.subject, sampleTokens)}</div>
                    <div style={{ whiteSpace: "pre-wrap", color: "var(--fg-2)", marginTop: 2 }}>{interpolate(camp.email.body, sampleTokens)}</div>
                  </div>
                )}
                {camp.channels.whatsapp && camp.wa.text && (
                  <div style={{ marginTop: 6, whiteSpace: "pre-wrap", fontSize: 12.5, color: "var(--fg-2)" }}>{interpolate(camp.wa.text, sampleTokens)}</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── DISPARAR ──────────────────────────────────────────────── */}
        <div style={box}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
            <div style={kicker}>Disparar · {chosen.length} selecionados</div>
            {camp.channels.whatsapp && <Pill tone={sentWa >= withWa && withWa > 0 ? "pos" : "mut"}>WhatsApp {sentWa}/{withWa}</Pill>}
            {camp.channels.email && <Pill tone={sentEmail >= withEmail && withEmail > 0 ? "pos" : "mut"}>e-mail {sentEmail}/{withEmail}</Pill>}
            {camp.channels.email && (
              gmailOn ? (
                <button onClick={sendEmails} disabled={emailBusy || pendingEmail === 0}
                  title="Envia o e-mail pela conta Google conectada pra todos os selecionados com e-mail ainda pendente"
                  style={{ height: 28, padding: "0 12px", borderRadius: "var(--r-2)", fontSize: 12, fontWeight: 600,
                    background: emailBusy || pendingEmail === 0 ? "var(--bg-2)" : "var(--btn-bg, var(--accent))",
                    color: emailBusy || pendingEmail === 0 ? "var(--fg-4)" : "var(--btn-fg, var(--accent-fg))",
                    border: "1px solid " + (emailBusy || pendingEmail === 0 ? "var(--line-2)" : "var(--btn-bg, var(--accent))"),
                    cursor: emailBusy || pendingEmail === 0 ? "not-allowed" : "pointer" }}>
                  {emailBusy ? "enviando…" : `✉ enviar ${pendingEmail} e-mail${pendingEmail === 1 ? "" : "s"}`}
                </button>
              ) : (
                <span className="mono dim" style={{ fontSize: 10.5 }}>conecte o Google com permissão de e-mail (Ajustes → Integrações) pra enviar em massa · ou use "abrir Gmail" por lead</span>
              )
            )}
          </div>

          {chosen.length === 0 ? (
            <div className="mono dim" style={{ fontSize: 12 }}>selecione leads no público pra montar a fila de disparo</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 420, overflow: "auto" }}>
              {chosen.map((l) => {
                const s = camp.sent?.[l.id] || {};
                const toks = scriptTokens(l, product);
                const wa = waLink(l.phone);
                const waUrl = wa && camp.wa.text ? `${wa}?text=${encodeURIComponent(interpolate(camp.wa.text, toks))}` : null;
                const mailUrl = l.email && (camp.email.subject || camp.email.body)
                  ? gmailCompose(l.email, interpolate(camp.email.subject, toks), interpolate(camp.email.body, toks)) : null;
                return (
                  <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)" }}>
                    <span style={{ minWidth: 0, flex: 1, display: "flex", gap: 6, alignItems: "baseline" }}>
                      <span onClick={() => onOpenLead && onOpenLead(l)} title="abrir lead" style={{ fontSize: 13, fontWeight: 600, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name || "sem nome"}</span>
                      {l.company && <span className="dim" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.company}</span>}
                    </span>
                    {camp.channels.whatsapp && (
                      l.whatsappInvalid ? <span className="mono" style={{ fontSize: 10.5, color: "var(--neg)" }} title={l.whatsappInvalidReason || "o WhatsApp não entregou antes"}>número inválido</span>
                      : l.whatsappOptOut ? <span className="mono dim" style={{ fontSize: 10.5 }} title="pediu pra parar de receber no WhatsApp">descadastrou Whats</span>
                      : waUrl ? (
                        <a href={waUrl} target="_blank" rel="noopener noreferrer" onClick={() => mark(l, "whatsapp")}
                          style={{ ...sendChip, borderColor: s.whatsapp ? "var(--pos)" : "#25D366", color: s.whatsapp ? "var(--pos)" : "#128c4b" }}>
                          {s.whatsapp ? "✓ Whats" : "abrir Whats ↗"}
                        </a>
                      ) : <span className="mono dim" style={{ fontSize: 10.5 }}>{wa ? "sem texto" : "sem telefone"}</span>
                    )}
                    {camp.channels.email && (
                      mailUrl ? (
                        <a href={mailUrl} target="_blank" rel="noopener noreferrer" onClick={() => mark(l, "email")}
                          style={{ ...sendChip, borderColor: s.email ? "var(--pos)" : "var(--accent-line)", color: s.email ? "var(--pos)" : "var(--accent)" }}>
                          {s.email ? "✓ e-mail" : "abrir Gmail ↗"}
                        </a>
                      ) : <span className="mono dim" style={{ fontSize: 10.5 }}>{l.email ? "sem texto" : "sem e-mail"}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── RESULTADOS · conversão no funil ───────────────────────────
            O que deu certo: dos leads que receberam o disparo, quantos
            avançaram de etapa / marcaram call / fecharam nos 30 dias seguintes
            (atribuído pela timeline). Compara as campanhas pra achar o padrão. */}
        <div style={box}>
          <div style={{ ...kicker, marginBottom: 8 }}>Resultados · conversão no funil (30 dias após o disparo)</div>
          {metrics.length === 0 ? (
            <div className="mono dim" style={{ fontSize: 12 }}>nenhum disparo medido ainda · dispare e a conversão aparece aqui</div>
          ) : (
            <div className="tbl-x" style={{ overflowX: "auto" }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(140px, 1fr) repeat(5, 82px)", gap: "5px 6px", minWidth: 520 }}>
                {["campanha", "enviados", "avançou", "marcou call", "fechou", "conversão"].map((h, i) => (
                  <span key={h} style={{ ...kicker, textAlign: i === 0 ? "left" : "right" }}>{h}</span>
                ))}
                {[...metrics].sort((a, b) => (b.won - a.won) || (b.advanced - a.advanced) || (b.sent - a.sent)).map((m) => {
                  const rate = m.sent ? Math.round((m.won / m.sent) * 100) : 0;
                  const on = m.id === camp.id;
                  return (
                    <React.Fragment key={m.id}>
                      <span style={{ fontSize: 12.5, fontWeight: on ? 700 : 500, color: on ? "var(--accent)" : "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name || "sem nome"}</span>
                      <span style={num}>{m.sent}</span>
                      <span style={num}>{m.advanced}</span>
                      <span style={num}>{m.booked}</span>
                      <span style={{ ...num, fontWeight: 700, color: m.won ? "var(--pos)" : "var(--fg-3)" }}>{m.won}</span>
                      <span style={{ ...num, color: rate >= 20 ? "var(--pos)" : "var(--fg-2)" }}>{rate}%</span>
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────── Sequências (drip) ──────────
// Aba de sequências automáticas: cria/edita a sequência (gatilho por etapa +
// passos por canal com delay), vê a conversão por sequência e trabalha a FILA
// de WhatsApp assistido (os passos de WhatsApp param aqui até o operador mandar).
const CH_LABEL = { email: "E-mail", whatsapp: "WhatsApp" };
function blankSeq(saas, me) {
  return { id: null, saas, name: "", status: "draft", trigger: { stages: [] }, exitOn: { won: true, booked: true, optOut: true },
    steps: [{ channel: "email", delayDays: 0, subject: "", body: "" }], createdBy: me };
}
const interpolateSeq = (text, toks) => String(text || "").replace(/\{\{(\w+)\}\}/g, (_, k) => (toks && toks[k] != null ? toks[k] : `{{${k}}}`));

function SequencesTab({ product, leads, stageOptions, defaultStages }) {
  const { version } = useData();
  const me = currentUser()?.id || "";
  const [list, setList] = useS([]);
  const [seq, setSeq] = useS(() => blankSeq(product?.id, me));
  const [enrollments, setEnrollments] = useS([]);
  const [metrics, setMetrics] = useS([]);
  const [templates, setTemplates] = useS([]);
  const [busy, setBusy] = useS(false);
  const [note, setNote] = useS(null);

  function reload() {
    if (!product?.id) return;
    api.list("sequences", { saas: product.id }).then((r) => setList(Array.isArray(r) ? r : [])).catch(() => setList([]));
    api.list("sequence_enrollments", { saas: product.id, status: "waiting" }).then((r) => setEnrollments(Array.isArray(r) ? r : [])).catch(() => setEnrollments([]));
    api.sequenceMetrics(product.id).then((r) => setMetrics(r?.sequences || [])).catch(() => setMetrics([]));
    api.list("drip_templates", { saas: product.id }).then((r) => setTemplates(Array.isArray(r) ? r : [])).catch(() => setTemplates([]));
  }
  useE(() => { setSeq(blankSeq(product?.id, me)); reload(); }, [product?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useE(() => { reload(); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  const payload = () => ({
    name: seq.name?.trim() || "Sequência sem nome", saas: product.id, status: seq.status || "draft",
    trigger: { stages: seq.trigger?.stages || [] }, exitOn: seq.exitOn || {}, steps: seq.steps || [],
    createdBy: seq.createdBy || me, createdAt: seq.createdAt || new Date().toISOString(),
  });
  async function save() {
    if (!product?.id) return;
    setBusy(true); setNote(null);
    try {
      if (seq.id) await api.update("sequences", seq.id, payload());
      else { const c = await api.create("sequences", payload()); setSeq((s) => ({ ...s, id: c.id })); }
      reload(); setNote({ ok: true, text: "sequência salva" });
    } catch (e) { setNote({ ok: false, text: e.message }); }
    setBusy(false);
  }
  async function removeSeq() {
    if (!seq.id || !window.confirm("Apagar esta sequência? As inscrições param.")) return;
    try { await api.remove("sequences", seq.id); setSeq(blankSeq(product?.id, me)); reload(); } catch (e) { setNote({ ok: false, text: e.message }); }
  }
  function loadSeq(s) {
    setSeq({ id: s.id, saas: s.saas, name: s.name || "", status: s.status || "draft",
      trigger: { stages: s.trigger?.stages || [] }, exitOn: { won: s.exitOn?.won !== false, booked: s.exitOn?.booked !== false, optOut: s.exitOn?.optOut !== false },
      steps: (s.steps || []).map((st) => ({ ...st })), createdAt: s.createdAt, createdBy: s.createdBy });
    setNote(null);
  }
  const setStep = (i, patch) => setSeq((s) => ({ ...s, steps: s.steps.map((st, j) => (j === i ? { ...st, ...patch } : st)) }));
  const addStep = (channel) => setSeq((s) => ({ ...s, steps: [...s.steps, channel === "whatsapp" ? { channel: "whatsapp", delayDays: 3, text: "" } : { channel: "email", delayDays: 3, subject: "", body: "" }] }));
  const removeStep = (i) => setSeq((s) => ({ ...s, steps: s.steps.filter((_, j) => j !== i) }));
  const toggleTrigger = (st) => setSeq((s) => { const set = new Set(s.trigger?.stages || []); set.has(st) ? set.delete(st) : set.add(st); return { ...s, trigger: { stages: [...set] } }; });

  const myMetrics = metrics.find((m) => m.id === seq.id);
  const leadById = Object.fromEntries((leads || []).map((l) => [l.id, l]));

  const box = { border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: 14 };
  const kick = { fontSize: 10, fontFamily: "var(--mono)", color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase" };
  const field = { width: "100%", padding: "7px 9px", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 12.5 };
  const chip = (on) => ({ height: 26, padding: "0 10px", borderRadius: "var(--r-2)", fontSize: 11.5, fontWeight: 600, cursor: "pointer", border: "1px solid " + (on ? "var(--accent-line)" : "var(--line-2)"), background: on ? "var(--accent-soft)" : "var(--bg-1)", color: on ? "var(--accent)" : "var(--fg-2)" });

  if (!product) return null;

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16 }}>
      {note && <div className="mono" style={{ fontSize: 12, color: note.ok ? "var(--pos)" : "var(--neg)" }}>{note.text}</div>}

      {/* Sequências salvas */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span style={kick}>sequências</span>
        {list.map((s) => (
          <button key={s.id} onClick={() => loadSeq(s)} style={{ ...chip(seq.id === s.id), display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: s.status === "active" ? "var(--pos)" : s.status === "paused" ? "var(--warn)" : "var(--fg-4)" }} />
            {s.name || "sem nome"}
          </button>
        ))}
        <button onClick={() => setSeq(blankSeq(product?.id, me))} className="mono dim" style={{ height: 26, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-2)", fontSize: 12 }}>+ nova</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14 }}>
        {/* Editor da sequência */}
        <div style={{ ...box, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input value={seq.name} onChange={(e) => setSeq((s) => ({ ...s, name: e.target.value }))} placeholder="nome da sequência" style={{ ...field, flex: 1 }} />
            <select value={seq.status} onChange={(e) => setSeq((s) => ({ ...s, status: e.target.value }))} style={{ ...field, width: 120 }}>
              <option value="draft">rascunho</option>
              <option value="active">ativa</option>
              <option value="paused">pausada</option>
            </select>
          </div>

          <div>
            <div style={kick}>Gatilho · entra quem está nestas etapas</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              {(stageOptions || []).map((st) => <button key={st} onClick={() => toggleTrigger(st)} style={chip((seq.trigger?.stages || []).includes(st))}>{st}</button>)}
            </div>
            {(!seq.trigger?.stages || !seq.trigger.stages.length) && <div className="mono dim" style={{ fontSize: 10.5, marginTop: 4 }}>sem gatilho a sequência não inscreve ninguém (você ainda pode inscrever na mão)</div>}
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={kick}>Passos</div>
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
                    <input type="number" min="0" value={st.delayDays ?? 0} onChange={(e) => setStep(i, { delayDays: Number(e.target.value) })} style={{ ...field, width: 58, padding: "4px 6px" }} />
                    <span className="mono dim" style={{ fontSize: 10.5 }}>dias</span>
                    <button onClick={() => removeStep(i)} className="mono dim" title="remover passo" style={{ fontSize: 13, color: "var(--neg)" }}>✕</button>
                  </div>
                  {templates.filter((t) => t.channel === st.channel).length > 0 && (
                    <select defaultValue="" onChange={(e) => { const t = templates.find((x) => x.id === e.target.value); if (t) setStep(i, st.channel === "email" ? { subject: t.subject || "", body: t.body || "" } : { text: t.text || "" }); e.target.value = ""; }}
                      style={{ ...field, marginBottom: 6, fontSize: 11.5, color: "var(--fg-3)" }}>
                      <option value="">usar template…</option>
                      {templates.filter((t) => t.channel === st.channel).map((t) => <option key={t.id} value={t.id}>{t.name || "sem nome"}</option>)}
                    </select>
                  )}
                  {st.channel === "email" ? (
                    <>
                      <input value={st.subject || ""} onChange={(e) => setStep(i, { subject: e.target.value })} placeholder="assunto · {{nome}}" style={{ ...field, marginBottom: 6 }} />
                      <textarea value={st.body || ""} onChange={(e) => setStep(i, { body: e.target.value })} rows={3} placeholder="corpo do e-mail · {{nome}} {{empresa}}" style={{ ...field, resize: "vertical", fontFamily: "inherit" }} />
                    </>
                  ) : (
                    <textarea value={st.text || ""} onChange={(e) => setStep(i, { text: e.target.value })} rows={3} placeholder="mensagem de WhatsApp · {{nome}} (o operador manda pela fila)" style={{ ...field, resize: "vertical", fontFamily: "inherit" }} />
                  )}
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span style={kick}>sai quando</span>
            {[["won", "fechou"], ["booked", "marcou call"], ["optOut", "descadastrou"]].map(([k, lbl]) => (
              <label key={k} style={{ display: "inline-flex", gap: 5, alignItems: "center", fontSize: 12 }}>
                <input type="checkbox" checked={seq.exitOn?.[k] !== false} onChange={(e) => setSeq((s) => ({ ...s, exitOn: { ...s.exitOn, [k]: e.target.checked } }))} />
                {lbl}
              </label>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={save} disabled={busy} style={{ height: 30, padding: "0 14px", borderRadius: "var(--r-2)", background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))", fontSize: 12.5, fontWeight: 600 }}>{busy ? "salvando…" : "salvar sequência"}</button>
            {seq.id && <button onClick={removeSeq} className="mono dim" style={{ height: 30, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-2)", fontSize: 12, color: "var(--neg)" }}>apagar</button>}
            {seq.status !== "active" && seq.id && <span className="mono dim" style={{ fontSize: 10.5, alignSelf: "center" }}>ative a sequência pra ela começar a inscrever e disparar</span>}
          </div>
        </div>

        {/* Métricas + fila de WhatsApp */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={box}>
            <div style={{ ...kick, marginBottom: 8 }}>Resultados · conversão no funil</div>
            {myMetrics ? (
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                {[["inscritos", myMetrics.enrolled], ["avançou", myMetrics.advanced], ["marcou call", myMetrics.booked], ["fechou", myMetrics.won]].map(([lbl, v]) => (
                  <div key={lbl}><div className="tnum" style={{ fontSize: 20, fontWeight: 700, color: lbl === "fechou" && v ? "var(--pos)" : "var(--fg-1)" }}>{v}</div><div style={kick}>{lbl}</div></div>
                ))}
                <div style={{ marginLeft: "auto", alignSelf: "center", fontSize: 11, color: "var(--fg-3)" }} className="mono">
                  {myMetrics.statusCounts?.active || 0} ativos · {myMetrics.statusCounts?.waiting || 0} no whats · {myMetrics.statusCounts?.done || 0} concluídos · {myMetrics.statusCounts?.exited || 0} saíram
                </div>
              </div>
            ) : <div className="mono dim" style={{ fontSize: 12 }}>salve e ative a sequência pra ver a conversão</div>}
          </div>

          <div style={box}>
            <div style={{ ...kick, marginBottom: 8 }}>Fila de WhatsApp · {enrollments.length} pra mandar hoje</div>
            {enrollments.length === 0 ? (
              <div className="mono dim" style={{ fontSize: 12 }}>nenhum passo de WhatsApp pendente · o motor coloca aqui quando chega a vez</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 360, overflow: "auto" }}>
                {enrollments.map((en) => {
                  const s = list.find((x) => x.id === en.sequence);
                  const step = s?.steps?.[en.stepIndex];
                  const lead = leadById[en.lead];
                  const wa = lead && waLink(lead.phone);
                  const txt = step?.text && lead ? interpolateSeq(step.text, scriptTokens(lead, product)) : "";
                  const waUrl = wa && txt ? `${wa}?text=${encodeURIComponent(txt)}` : null;
                  const mark = async () => { try { await api.sequenceWaSent(en.id); reload(); } catch (e) { setNote({ ok: false, text: e.message }); } };
                  return (
                    <div key={en.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)" }}>
                      <span style={{ minWidth: 0, flex: 1, display: "flex", gap: 6, alignItems: "baseline" }}>
                        <span style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lead?.name || en.lead}</span>
                        <span className="mono dim" style={{ fontSize: 10 }}>{s?.name || ""} · passo {en.stepIndex + 1}</span>
                      </span>
                      {waUrl
                        ? <a href={waUrl} target="_blank" rel="noopener noreferrer" onClick={mark} style={{ display: "inline-flex", alignItems: "center", height: 26, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid #25D366", color: "#128c4b", fontSize: 11.5, fontWeight: 600, textDecoration: "none" }}>abrir Whats ↗</a>
                        : <button onClick={mark} className="mono" style={{ height: 26, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", fontSize: 11.5 }}>{wa ? "marcar enviado" : "sem telefone · marcar"}</button>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── Templates ──────────────────
// Biblioteca de conteúdo reutilizável pros passos das sequências (e disparos).
function TemplatesTab({ product }) {
  const { version } = useData();
  const [list, setList] = useS([]);
  const [t, setT] = useS(() => ({ id: null, channel: "email", name: "", subject: "", body: "", text: "" }));
  const [note, setNote] = useS(null);

  function reload() { if (product?.id) api.list("drip_templates", { saas: product.id }).then((r) => setList(Array.isArray(r) ? r : [])).catch(() => setList([])); }
  useE(() => { reload(); setT({ id: null, channel: "email", name: "", subject: "", body: "", text: "" }); }, [product?.id, version]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setNote(null);
    const doc = { name: t.name?.trim() || "Template", saas: product.id, channel: t.channel, subject: t.subject || "", body: t.body || "", text: t.text || "" };
    try {
      if (t.id) await api.update("drip_templates", t.id, doc);
      else await api.create("drip_templates", doc);
      setT({ id: null, channel: "email", name: "", subject: "", body: "", text: "" });
      reload(); setNote({ ok: true, text: "template salvo" });
    } catch (e) { setNote({ ok: false, text: e.message }); }
  }
  async function del(id) { if (window.confirm("Apagar template?")) { try { await api.remove("drip_templates", id); reload(); } catch (e) { setNote({ ok: false, text: e.message }); } } }

  const box = { border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: 14 };
  const kick = { fontSize: 10, fontFamily: "var(--mono)", color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase" };
  const field = { width: "100%", padding: "7px 9px", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 12.5 };
  if (!product) return null;

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16 }}>
      {note && <div className="mono" style={{ fontSize: 12, color: note.ok ? "var(--pos)" : "var(--neg)" }}>{note.text}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
        <div style={{ ...box, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={kick}>{t.id ? "editar template" : "novo template"}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={t.name} onChange={(e) => setT((x) => ({ ...x, name: e.target.value }))} placeholder="nome" style={{ ...field, flex: 1 }} />
            <select value={t.channel} onChange={(e) => setT((x) => ({ ...x, channel: e.target.value }))} style={{ ...field, width: 130 }}>
              <option value="email">E-mail</option>
              <option value="whatsapp">WhatsApp</option>
            </select>
          </div>
          {t.channel === "email" ? (
            <>
              <input value={t.subject} onChange={(e) => setT((x) => ({ ...x, subject: e.target.value }))} placeholder="assunto · {{nome}}" style={field} />
              <textarea value={t.body} onChange={(e) => setT((x) => ({ ...x, body: e.target.value }))} rows={5} placeholder="corpo · {{nome}} {{empresa}}" style={{ ...field, resize: "vertical", fontFamily: "inherit" }} />
            </>
          ) : (
            <textarea value={t.text} onChange={(e) => setT((x) => ({ ...x, text: e.target.value }))} rows={4} placeholder="mensagem · {{nome}}" style={{ ...field, resize: "vertical", fontFamily: "inherit" }} />
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={save} style={{ height: 30, padding: "0 14px", borderRadius: "var(--r-2)", background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))", fontSize: 12.5, fontWeight: 600 }}>{t.id ? "salvar" : "criar template"}</button>
            {t.id && <button onClick={() => setT({ id: null, channel: "email", name: "", subject: "", body: "", text: "" })} className="mono dim" style={{ fontSize: 12 }}>cancelar</button>}
          </div>
        </div>

        <div style={{ ...box }}>
          <div style={{ ...kick, marginBottom: 8 }}>Biblioteca · {list.length}</div>
          {list.length === 0 ? <div className="mono dim" style={{ fontSize: 12 }}>nenhum template ainda</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {list.map((x) => (
                <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)" }}>
                  <span className="mono" style={{ fontSize: 10, color: "var(--accent)", width: 58 }}>{CH_LABEL[x.channel] || x.channel}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.name || "sem nome"}</span>
                  <button onClick={() => setT({ id: x.id, channel: x.channel || "email", name: x.name || "", subject: x.subject || "", body: x.body || "", text: x.text || "" })} className="mono dim" style={{ fontSize: 11 }}>editar</button>
                  <button onClick={() => del(x.id)} className="mono dim" style={{ fontSize: 11, color: "var(--neg)" }}>apagar</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export { DisparosScreen };
