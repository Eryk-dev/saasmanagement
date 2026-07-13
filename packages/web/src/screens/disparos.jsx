import React from "react";
import { PageHead, Pill } from "../components/viz.jsx";
import { EmptyState } from "../atoms.jsx";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { useActiveSaas } from "../lib/workspace.js";
import { waLink } from "../lib/ui.js";
import { currentUser } from "../lib/users.js";
import { stageKind, workableStages } from "../lib/funnel.js";
import { scriptTokens } from "../lib/scripts.js";

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
  const [note, setNote] = useS(null);   // { ok, text }
  const [err, setErr] = useS(null);

  // Carrega as campanhas salvas do produto + arma o público padrão na 1ª vez.
  useE(() => {
    if (!product?.id) return;
    setStagesSel(new Set(defaultStages));
    let alive = true;
    api.list("campaigns", { saas: product.id })
      .then((cs) => alive && setCampaigns(Array.isArray(cs) ? cs : []))
      .catch(() => alive && setCampaigns([]));
    return () => { alive = false; };
  }, [product?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const withWa = chosen.filter((l) => waLink(l.phone)).length;
  const withEmail = chosen.filter((l) => l.email).length;
  const sentWa = chosen.filter((l) => camp.sent?.[l.id]?.whatsapp).length;
  const sentEmail = chosen.filter((l) => camp.sent?.[l.id]?.email).length;

  const sampleLead = chosen[0] || recipients[0] || null;
  const sampleTokens = sampleLead ? scriptTokens(sampleLead, product) : null;
  const insertToken = (tok) => {
    const t = `{{${tok}}}`;
    if (activeField === "subject") setCamp((c) => ({ ...c, email: { ...c.email, subject: (c.email.subject || "") + t } }));
    else if (activeField === "body") setCamp((c) => ({ ...c, email: { ...c.email, body: (c.email.body || "") + t } }));
    else setCamp((c) => ({ ...c, wa: { text: (c.wa.text || "") + t } }));
  };

  const box = { border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: 14 };
  const kicker = { fontSize: 10, fontFamily: "var(--mono)", color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase" };
  const field = { width: "100%", padding: "8px 10px", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 13 };
  const chipBtn = (on) => ({ display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 11px", borderRadius: "var(--r-2)", fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid " + (on ? "var(--accent-line)" : "var(--line-2)"), background: on ? "var(--accent-soft)" : "var(--bg-1)", color: on ? "var(--accent)" : "var(--fg-2)" });
  const sendChip = { display: "inline-flex", alignItems: "center", gap: 5, height: 26, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", fontSize: 11.5, fontWeight: 600, textDecoration: "none", cursor: "pointer" };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <PageHead title="Disparos" sub={`${recipients.length} no público · ${selected.size} selecionados`}>
        <input value={camp.name} onChange={(e) => setCamp((c) => ({ ...c, name: e.target.value }))} placeholder="nome da campanha"
          style={{ ...field, width: 200, height: 26, padding: "0 10px", fontSize: 12.5 }} />
        <Pill tone={camp.status === "sending" ? "warn" : camp.id ? "pos" : "mut"}>{camp.status === "sending" ? "disparando" : camp.id ? "salva" : "rascunho"}</Pill>
        <button onClick={save} disabled={saving}
          style={{ height: 26, padding: "0 12px", borderRadius: "var(--r-2)", background: "var(--accent)", color: "var(--accent-fg)", fontSize: 12, fontWeight: 600 }}>
          {saving ? "salvando…" : "salvar"}
        </button>
        <button onClick={newCampaign} className="mono dim" style={{ height: 26, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-2)", fontSize: 12 }}>+ nova</button>
      </PageHead>

      <div style={{ flex: 1, overflow: "auto", padding: "14px var(--pad-x)", display: "flex", flexDirection: "column", gap: 14 }}>
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
            {camp.channels.email && <span className="mono dim" style={{ fontSize: 10.5 }}>e-mail abre rascunho no Gmail (envio em massa pela conta Google entra na fase 2)</span>}
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
                      waUrl ? (
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
      </div>
    </div>
  );
}

export { DisparosScreen };
