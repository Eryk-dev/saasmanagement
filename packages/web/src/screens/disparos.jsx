import React from "react";
import "./marketing.css";
import { PageHead, Pill, Segmented } from "../components/viz.jsx";
import { InfoNota } from "../components/story.jsx";
import { EmptyState, PrimaryButton, SecondaryButton } from "../atoms.jsx";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { useActiveSaas } from "../lib/workspace.js";
import { waLink } from "../lib/ui.js";
import { currentUser } from "../lib/users.js";
import { stageKind, workableStages } from "../lib/funnel.js";
import { scriptTokens } from "../lib/scripts.js";
import { WaHealthBanner } from "../components/wa-health-banner.jsx";
import { useSwr } from "../lib/swr.js";

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
  // As SEQUÊNCIAS podem disparar do funil INTEIRO, terminais incluídas: o
  // onboarding do cliente nasce no Ganho e a reativação nasce no Desqualificado.
  // O público de um disparo em massa continua só nas trabalháveis.
  const allStages = useM(() => (product?.funnel || []).map((f) => f?.stage).filter(Boolean), [product?.id, version]);
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
  const [assistBusy, setAssistBusy] = useS(false);
  const [metrics, setMetrics] = useS([]); // [{ id, name, sent, advanced, booked, won }]
  const [note, setNote] = useS(null);   // { ok, text }
  const [err, setErr] = useS(null);
  const [tab, setTabState] = useS(() => { try { return localStorage.getItem("cockpit_disparos_tab") || "disparos"; } catch { return "disparos"; } }); // disparos | sequencias | templates · persiste
  const setTab = (t) => { setTabState(t); try { localStorage.setItem("cockpit_disparos_tab", t); } catch { /* ignore */ } };
  const gmailOn = !!window.SEED?.CONFIG?.google?.gmail; // escopo de envio concedido?

  // Carrega as campanhas salvas do produto + as métricas + arma o público padrão.
  useE(() => {
    if (!product?.id) return;
    setStagesSel(new Set(defaultStages));
    setCamp(blankCamp(me)); setCampaigns([]); setMetrics([]); setSearch(""); setNote(null); setErr(null);
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
    if (camp.id) { await api.update("campaigns", camp.id, draftPayload()); return camp.id; }
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
      return true;
    } catch (e) { setErr(`não deu pra marcar o envio: ${e.message}`); return false; }
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


  const toggleStage = (st) => setStagesSel((prev) => { const n = new Set(prev); n.has(st) ? n.delete(st) : n.add(st); return n; });
  const toggleLead = (id) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSelected = recipients.length > 0 && recipients.every((l) => selected.has(l.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(recipients.map((l) => l.id)));

  const shown = search.trim()
    ? recipients.filter((l) => `${l.name || ""} ${l.company || ""}`.toLowerCase().includes(search.trim().toLowerCase()))
    : recipients;
  const chosen = recipients.filter((l) => selected.has(l.id));
  const sampleLead = chosen[0] || recipients[0] || null;
  const sampleTokens = sampleLead ? scriptTokens(sampleLead, product) : null;
  const insertToken = (tok) => {
    const t = `{{${tok}}}`;
    if (activeField === "subject") setCamp((c) => ({ ...c, email: { ...c.email, subject: (c.email.subject || "") + t } }));
    else if (activeField === "body") setCamp((c) => ({ ...c, email: { ...c.email, body: (c.email.body || "") + t } }));
    else setCamp((c) => ({ ...c, wa: { text: (c.wa.text || "") + t } }));
  };

  const channel = camp.channels.email ? "email" : "wa";
  const setChannel = (value) => {
    setActiveField(value === "email" ? "body" : "wa");
    setCamp((current) => ({
    ...current,
    channels: { email: value === "email", whatsapp: value === "wa" },
    ...(value === "email" && !current.email.subject && current.name ? { email: { ...current.email, subject: current.name } } : {}),
    }));
  };
  const relativeTouch = (lead) => {
    const at = lead.stageSince || lead.updatedAt || lead.createdAt;
    if (!at) return "—";
    const days = Math.max(0, Math.floor((Date.now() - new Date(at).getTime()) / 86400e3));
    if (days === 0) return "hoje";
    if (days === 1) return "ontem";
    return `há ${days} dias`;
  };
  const stageCount = (stage) => leads.filter((lead) => lead.stage === stage).length;
  // Passo 3 (13/09): o que o disparo custa e o que o número aguenta hoje, ANTES
  // do botão. O custo médio sai do que a Meta já cobrou no período (insights do
  // inbox), não de um preço inventado; o limite vem do número conectado.
  // Número conectado e insights do WhatsApp com cache no cliente: quem sai e
  // volta pra tela vê o valor guardado na hora (o servidor também guarda o
  // número por 10 min, então nem a revalidação bate na Meta). A chave leva o
  // produto: trocar de workspace não mostra o número do outro.
  const pid = product?.id || "";
  const numInfo = useSwr(pid && `wa/number/${pid}`, () => api.waNumber(pid), { ttl: 10 * 60_000 }).data ?? null;
  const waStats = useSwr(pid && "wa/insights", () => api.waInsights(), { ttl: 60_000 }).data ?? null;
  const limiteDia = Number(String(numInfo?.tier || "").replace(/\D/g, "")) || null;
  const custoMedio = waStats?.costs?.messages > 0 ? Number(waStats.costs.cost) / Number(waStats.costs.messages) : null;
  const messageReady = channel === "email" ? !!camp.email.body : !!camp.wa.text;
  const pending = chosen.filter((l) => channel === "wa"
    ? waLink(l.phone) && !l.whatsappInvalid && !l.whatsappOptOut && !camp.sent?.[l.id]?.whatsapp
    : l.email && !l.emailOptOut && !camp.sent?.[l.id]?.email);
  async function sendPrimary() {
    if (!pending.length || !messageReady || assistBusy || emailBusy) return;
    if (channel === "email" && gmailOn) { await sendEmails(); return; }
    const lead = pending[0];
    const tokens = scriptTokens(lead, product);
    const url = channel === "wa"
      ? `${waLink(lead.phone)}?text=${encodeURIComponent(interpolate(camp.wa.text, tokens))}`
      : gmailCompose(lead.email, interpolate(camp.email.subject || camp.name, tokens), interpolate(camp.email.body, tokens));
    window.open(url, "_blank", "noopener,noreferrer");
    setAssistBusy(true);
    try {
      if (await mark(lead, channel === "wa" ? "whatsapp" : "email")) setNote({ ok: true, text: `${lead.name || "Lead"} aberto para envio · continue pelos selecionados` });
    } finally { setAssistBusy(false); }
  }
  if (!product) return <EmptyState title="Sem produto ativo" hint="Escolha um produto no seletor da barra lateral." />;
  const step = (n, title, sub) => <div className="marketing-toolbar" style={{ marginBottom: 14 }}><span className="tnum" style={{ width: 26, height: 26, borderRadius: 99, background: "var(--btn-bg)", color: "var(--btn-fg)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600 }}>{n}</span><h3 className="card-title" style={{ margin: 0 }}>{title}</h3>{sub && <span style={{ fontSize: 12.5, color: "var(--fg-3)" }}>{sub}</span>}</div>;
  const changedBody = (value) => setCamp((c) => channel === "email" ? { ...c, email: { ...c.email, body: value } } : { ...c, wa: { text: value } });

  return <div className="marketing-page" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
    <PageHead className="marketing-head" title="Disparos" sub={tab === "disparos" ? `${recipients.length} no público · ${selected.size} selecionados · campanhas de e-mail e WhatsApp` : tab === "sequencias" ? "sequências automáticas de nutrição" : "biblioteca de conteúdo reutilizável"}>
      <Segmented value={tab} onChange={setTab} options={[{ value: "disparos", label: "Disparos" }, { value: "sequencias", label: "Sequências" }, { value: "templates", label: "Templates" }]} />
    </PageHead>
    {tab === "sequencias" && <SequencesTab key={product.id} product={product} leads={leads} stageOptions={allStages} defaultStages={defaultStages} />}
    {tab === "templates" && <TemplatesTab key={product.id} product={product} />}
    {tab === "disparos" && <div className="marketing-body" style={{ flex: 1, overflow: "auto" }}>
      <WaHealthBanner style={{ margin: 0 }} />
      {note && <div role="status" className="marketing-card marketing-toolbar" style={{ padding: "11px 16px" }}><span style={{ flex: 1, fontSize: 13, color: note.ok ? "var(--pos)" : "var(--neg)" }}>{note.text}</span><button aria-label="Fechar aviso" onClick={() => setNote(null)}>×</button></div>}
      {err && <div role="alert" style={{ fontSize: 12.5, color: "var(--neg)" }}>{err}</div>}
      <div className="marketing-two-col">
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <section className="marketing-card">
            {step(1, "Para quem", "etapas do funil")}
            <div className="marketing-toolbar">
              {stageOptions.map((stage) => <button key={stage} aria-pressed={stagesSel.has(stage)} onClick={() => toggleStage(stage)} style={{ height: 32, padding: "0 12px", borderRadius: 999, border: `1px solid ${stagesSel.has(stage) ? "var(--accent-line)" : "var(--line-2)"}`, background: stagesSel.has(stage) ? "var(--accent-soft)" : "var(--bg-1)", color: stagesSel.has(stage) ? "var(--accent)" : "var(--fg-2)", fontSize: 12.5, fontWeight: 600 }}>{stage} <span className="tnum" style={{ marginLeft: 5, opacity: .7 }}>{stageCount(stage)}</span></button>)}
            </div>
            <input className="inp" type="search" aria-label="Buscar público" placeholder="buscar por nome ou empresa" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: "100%", margin: "14px 0 10px" }} />
            <div className="tbl-x" style={{ maxHeight: 400, border: "1px solid var(--line-1)", borderRadius: "var(--r-3)" }}>
              <table className="marketing-table" style={{ minWidth: 470, tableLayout: "fixed" }}><colgroup><col style={{ width: 56 }} /><col style={{ width: "32%" }} /><col style={{ width: "24%" }} /><col style={{ width: "22%" }} /><col /></colgroup>
                <thead><tr><th><input type="checkbox" aria-label="Selecionar todo o público" checked={allSelected} onChange={toggleAll} /></th><th>Lead</th><th>Empresa</th><th>Etapa</th><th>Na etapa</th></tr></thead>
                <tbody>{shown.map((lead) => {
                  const sent = camp.sent?.[lead.id]?.[channel === "wa" ? "whatsapp" : "email"];
                  const invalid = channel === "wa" ? !waLink(lead.phone) || lead.whatsappInvalid || lead.whatsappOptOut : !lead.email || lead.emailOptOut;
                  return <tr key={lead.id}><td><input type="checkbox" aria-label={`Selecionar ${lead.name}`} checked={selected.has(lead.id)} onChange={() => toggleLead(lead.id)} /></td>
                    <td><button onClick={() => onOpenLead?.(lead)} style={{ fontSize: 13, fontWeight: 600, textAlign: "left" }}>{lead.name || "sem nome"}</button><div style={{ fontSize: 11, marginTop: 3, color: sent ? "var(--pos)" : "var(--fg-3)" }}>{sent ? "já aberto/enviado" : invalid ? "sem contato disponível" : "pendente"}</div></td>
                    <td style={{ fontSize: 12, color: "var(--fg-3)", overflowWrap: "anywhere" }}>{lead.company || "—"}</td><td style={{ fontSize: 11.5 }}>{lead.stage}</td><td style={{ fontSize: 11.5, color: "var(--fg-3)" }}>{relativeTouch(lead)}</td>
                  </tr>;
                })}</tbody>
              </table>
              {!shown.length && <div style={{ padding: 16, color: "var(--fg-3)", fontSize: 12.5 }}>nenhum lead neste público</div>}
            </div>
            <div className="marketing-toolbar" style={{ marginTop: 12, justifyContent: "space-between" }}><button onClick={toggleAll} style={{ fontSize: 12.5, fontWeight: 600 }}>{allSelected ? "Limpar seleção" : `Selecionar todos (${recipients.length})`}</button><span style={{ fontSize: 11.5, color: "var(--fg-3)" }}>{shown.length} na lista · {selected.size} selecionados</span></div>
          </section>
          <section className="marketing-card">
            <h3 className="card-title" style={{ margin: "0 0 12px" }}>Campanhas salvas</h3>
            <div className="marketing-toolbar"><select className="inp" aria-label="Carregar campanha" value={camp.id || ""} onChange={(e) => { const c = campaigns.find((x) => x.id === e.target.value); if (c) loadCampaign(c); else newCampaign(); }} style={{ flex: 1, minWidth: 160 }}><option value="">Nova campanha</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name || "sem nome"} · {Object.keys(c.sent || {}).length} env.</option>)}</select><SecondaryButton onClick={newCampaign}>+ nova</SecondaryButton></div>
          </section>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <section className="marketing-card">
            {step(2, "A mensagem")}
            <Segmented value={channel} onChange={setChannel} options={[{ value: "wa", label: "WhatsApp" }, { value: "email", label: "E-mail" }]} />
            <label className="canvas-field" style={{ marginTop: 14, fontSize: 12.5 }}>Nome da campanha<input className="inp" value={camp.name} onChange={(e) => setCamp((c) => ({ ...c, name: e.target.value }))} placeholder="Retomada · diagnóstico pendente" /></label>
            {channel === "email" && <label className="canvas-field" style={{ marginTop: 12, fontSize: 12.5 }}>Assunto do e-mail<input className="inp" value={camp.email.subject} onFocus={() => setActiveField("subject")} onChange={(e) => setCamp((c) => ({ ...c, email: { ...c.email, subject: e.target.value } }))} /></label>}
            <label className="canvas-field" style={{ marginTop: 12, fontSize: 12.5 }}>Mensagem<textarea className="inp" value={channel === "email" ? camp.email.body : camp.wa.text} onFocus={() => setActiveField(channel === "email" ? "body" : "wa")} onChange={(e) => changedBody(e.target.value)} placeholder="Oi {{nome}}! Seu diagnóstico da {{empresa}} ficou pronto." rows={5} style={{ minHeight: 112, padding: "9px 11px", resize: "vertical", lineHeight: 1.5 }} /></label>
            <div className="marketing-toolbar" style={{ marginTop: 10 }}>{TOKENS.map(([key, label]) => <button key={key} title={`Inserir ${label}`} onClick={() => insertToken(key)} style={{ fontSize: 11.5, color: "var(--fg-3)", border: "1px solid var(--line-1)", borderRadius: "var(--r-1)", padding: "4px 7px" }}>{`{{${key}}}`}</button>)}</div>
            <div className="marketing-toolbar" style={{ marginTop: 14 }}><SecondaryButton onClick={save} disabled={saving || assistBusy || emailBusy}>{saving ? "salvando…" : "Salvar campanha"}</SecondaryButton>{window.SEED?.CONFIG?.ai?.configured && <SecondaryButton onClick={genCopy} disabled={aiBusy}>{aiBusy ? "gerando…" : "Gerar com IA"}</SecondaryButton>}</div>
          </section>
          <section className="marketing-card">
            {step(3, "Conferir e disparar")}
            {sampleLead && messageReady && <div style={{ padding: "10px 12px", background: "var(--bg-inset)", border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", marginBottom: 14 }}><div className="marketing-kicker" style={{ marginBottom: 6 }}>prévia · {sampleLead.name}</div>{channel === "email" && <strong style={{ fontSize: 12.5 }}>{interpolate(camp.email.subject, sampleTokens)}</strong>}<div style={{ fontSize: 12.5, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{interpolate(channel === "email" ? camp.email.body : camp.wa.text, sampleTokens)}</div></div>}
            <div className="marketing-toolbar" style={{ gap: 20, marginBottom: 14 }}>
              <div><div className="marketing-kicker">pessoas no disparo</div><strong className="tnum">{chosen.length}</strong><div style={{ fontSize: 11.5, color: "var(--fg-3)" }}>{pending.length} pendentes com contato válido</div></div>
              {channel === "wa" && <><div><div className="marketing-kicker">custo estimado</div><strong className="tnum">{custoMedio != null ? (custoMedio * chosen.length).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"}</strong></div><div><div className="marketing-kicker">limite do número</div><strong className="tnum">{limiteDia?.toLocaleString("pt-BR") || "—"}</strong></div></>}
            </div>
            {channel === "wa" && limiteDia && chosen.length > limiteDia * .6 && <div role="status" style={{ padding: 12, borderRadius: "var(--r-2)", background: "var(--warn-soft)", color: "var(--warn)", fontSize: 12.5, marginBottom: 12 }}>{chosen.length > limiteDia ? `O público passa do limite de ${limiteDia} do número. Divida o disparo em dias.` : "O público passa de 60% do limite do número. Confira a saúde antes de continuar."}</div>}
            <div className="marketing-toolbar"><PrimaryButton disabled={!pending.length || !messageReady || saving || emailBusy || assistBusy} onClick={sendPrimary}>{emailBusy || assistBusy ? "processando…" : channel === "email" && gmailOn ? `Disparar ${pending.length} e-mails` : channel === "wa" ? "Abrir próximo WhatsApp ↗" : "Abrir próximo Gmail ↗"}</PrimaryButton><SecondaryButton onClick={() => setTab("sequencias")}>Criar sequência</SecondaryButton></div>
            <InfoNota style={{ marginTop: 12 }}>{channel === "email" && gmailOn ? "Os e-mails saem pela conta Google conectada. Quem já recebeu ou se descadastrou fica fora do envio." : "Envio assistido: a conversa abre com a mensagem preenchida. Confira e envie no aplicativo; depois continue para o próximo contato."}</InfoNota>
          </section>
        </div>
      </div>
      <section className="marketing-card">
        <h3 className="card-title" style={{ margin: "0 0 12px" }}>Resultados das campanhas</h3>
        {!metrics.length ? <InfoNota>A conversão aparece depois dos primeiros disparos.</InfoNota> : <div className="tbl-x"><table className="marketing-table" style={{ minWidth: 540 }}><thead><tr><th>Campanha</th><th>Enviados</th><th>Avançaram</th><th>Calls</th><th>Ganhos</th><th>Conversão</th></tr></thead><tbody>{[...metrics].sort((a, b) => b.won - a.won || b.advanced - a.advanced).map((m) => <tr key={m.id}><td>{m.name || "sem nome"}</td><td className="tnum">{m.sent}</td><td className="tnum">{m.advanced}</td><td className="tnum">{m.booked}</td><td className="tnum" style={{ color: m.won ? "var(--pos)" : "var(--fg-3)" }}>{m.won}</td><td className="tnum">{m.sent ? Math.round(m.won / m.sent * 100) : 0}%</td></tr>)}</tbody></table></div>}
        <InfoNota style={{ marginTop: 12 }}>Avanços no funil nos 30 dias após o disparo, atribuídos pela timeline.</InfoNota>
      </section>
    </div>}
  </div>;
}

// ─────────────────────────────────────────────── Sequências (drip) ──────────
// Aba de sequências automáticas: cria/edita a sequência (gatilho por etapa +
// passos por canal com delay), vê a conversão por sequência e trabalha a FILA
// de WhatsApp assistido (os passos de WhatsApp param aqui até o operador mandar).
const CH_LABEL = { email: "E-mail", whatsapp: "WhatsApp" };
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
      trigger: { stages: s.trigger?.stages || [] }, exitOn: exitOnOf(s.exitOn),
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
  const field = { width: "100%", padding: "7px 9px", background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 12.5 };
  const chip = (on) => ({ height: 26, padding: "0 10px", borderRadius: "var(--r-2)", fontSize: 11.5, fontWeight: 600, cursor: "pointer", border: "1px solid " + (on ? "var(--accent-line)" : "var(--line-2)"), background: on ? "var(--accent-soft)" : "var(--bg-1)", color: on ? "var(--accent)" : "var(--fg-2)" });

  if (!product) return null;

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16 }}>
      {note && <div className="mono" style={{ fontSize: 12, color: note.ok ? "var(--pos)" : "var(--neg)" }}>{note.text}</div>}

      {/* Sequências salvas */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span className="kicker">sequências</span>
        {list.map((s) => (
          <button key={s.id} onClick={() => loadSeq(s)} style={{ ...chip(seq.id === s.id), display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: s.status === "active" ? "var(--pos)" : s.status === "paused" ? "var(--warn)" : "var(--fg-4)" }} />
            {s.name || "sem nome"}
          </button>
        ))}
        <button onClick={() => setSeq(blankSeq(product?.id, me))} className="mono dim" style={{ height: 26, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", background: "var(--bg-2)", fontSize: 12 }}>+ nova</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: 14 }}>
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
            <span className="kicker">sai quando</span>
            {EXITS.map(({ key, label }) => (
              <label key={key} style={{ display: "inline-flex", gap: 5, alignItems: "center", fontSize: 12 }}>
                <input type="checkbox" checked={!!seq.exitOn?.[key]} onChange={(e) => setSeq((s) => ({ ...s, exitOn: { ...s.exitOn, [key]: e.target.checked } }))} />
                {label}
              </label>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={save} disabled={busy} style={{ height: 30, padding: "0 14px", borderRadius: "var(--r-2)", background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))", fontSize: 12.5, fontWeight: 600 }}>{busy ? "salvando…" : "salvar sequência"}</button>
            {seq.id && <button onClick={removeSeq} className="mono dim" style={{ height: 30, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", background: "var(--bg-2)", fontSize: 12, color: "var(--neg)" }}>apagar</button>}
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

          <div style={box}>
            <div className="kicker" style={{ marginBottom: 8 }}>Fila de WhatsApp · {enrollments.length} pra mandar hoje</div>
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
                        ? <a href={waUrl} target="_blank" rel="noopener noreferrer" onClick={mark} style={{ display: "inline-flex", alignItems: "center", height: 26, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--wa-brand)", color: "var(--wa-brand-deep)", fontSize: 11.5, fontWeight: 600, textDecoration: "none" }}>abrir Whats ↗</a>
                        : <button onClick={mark} className="mono" style={{ height: 26, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", background: "var(--bg-1)", fontSize: 11.5 }}>{wa ? "marcar enviado" : "sem telefone · marcar"}</button>}
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
  const field = { width: "100%", padding: "7px 9px", background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 12.5 };
  if (!product) return null;

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16 }}>
      {note && <div className="mono" style={{ fontSize: 12, color: note.ok ? "var(--pos)" : "var(--neg)" }}>{note.text}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 14 }}>
        <div style={{ ...box, display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="kicker">{t.id ? "editar template" : "novo template"}</div>
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
          <div className="kicker" style={{ marginBottom: 8 }}>Biblioteca · {list.length}</div>
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
