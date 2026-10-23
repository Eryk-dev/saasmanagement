import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { chromeBtnStyleSmall } from "../lib/ui.js";
import { currentUser, isAdminUser } from "../lib/users.js";
// Configurações → Integrações → E-mail (docs/PLANO-DISPAROS.md, fase 1).
// Resend envia disparos, sequências, NPS, relatório mensal e resposta de
// ticket; sem ele, o envio cai na conta Google do sistema. A chave é só
// escrita: a tela nunca a recebe de volta (só os 4 últimos caracteres).
// Gravar, remover e testar exigem a etiqueta admin (o servidor confere).

const { useState, useEffect } = React;
const inputStyle = { width: "100%", height: 32, padding: "0 10px", background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: 999, color: "var(--fg-1)", fontSize: 12, fontFamily: "var(--sans)" };
const DOMAIN = {
  verified: ["pos", "domínio verificado"],
  pending: ["warn", "domínio aguardando verificação no Resend"],
  not_started: ["warn", "domínio ainda não verificado no Resend"],
  failed: ["neg", "verificação do domínio falhou no Resend"],
  not_found: ["neg", "domínio não cadastrado no Resend"],
  restricted: ["warn", "chave só de envio: o estado do domínio não aparece aqui"],
  error: ["neg", "não foi possível consultar o Resend"],
};
// O que fazer em cada estado do domínio (verificado não precisa de nada).
const domainHint = (d) => d.status === "restricted" ? "Envie um e-mail de teste para confirmar. Para ver o estado aqui, use uma chave Full access do Resend."
  : d.status === "error" ? d.error || ""
  : "Verifique o domínio no painel do Resend (registros DNS) para os e-mails saírem.";
const PROVIDER = { resend: "enviando pelo Resend", gmail: "enviando pela conta Google (Gmail)", "": "sem envio de e-mail" };

export function EmailIntegrationCard() {
  const { refresh } = useData();
  const admin = isAdminUser();
  const [st, setSt] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [form, setForm] = useState({ apiKey: "", fromName: "", fromEmail: "", replyTo: "", webhookSecret: "" });
  // URL que vai no painel do Resend → Webhooks (eventos de entrega, devolução e spam).
  const webhookUrl = `${(import.meta.env.VITE_API_BASE || window.location.origin).replace(/\/+$/, "")}/api/webhooks/resend`;
  const [testTo, setTestTo] = useState(currentUser()?.email || "");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null); // { tone, text }

  async function load() {
    setLoadErr("");
    try {
      const s = await api.emailConfig();
      setSt(s);
      setForm({ apiKey: "", fromName: s.fromName || "", fromEmail: s.fromEmail || "", replyTo: s.replyTo || "", webhookSecret: "" });
    } catch (e) { setLoadErr(e.message || "Não foi possível ler a configuração de e-mail."); }
  }
  useEffect(() => { load(); }, []);

  async function run(kind, fn, ok) {
    setBusy(kind); setMsg(null);
    try { const out = await fn(); setMsg({ tone: "pos", text: ok(out) }); }
    catch (e) { setMsg({ tone: "neg", text: e.message || "Falhou." }); }
    finally { setBusy(""); }
  }
  const save = () => run("save", async () => {
    const s = await api.saveEmailConfig({ ...form, apiKey: form.apiKey.trim() || undefined, webhookSecret: form.webhookSecret.trim() || undefined });
    setSt(s); setForm({ apiKey: "", fromName: s.fromName || "", fromEmail: s.fromEmail || "", replyTo: s.replyTo || "", webhookSecret: "" }); await refresh(); return s;
  }, () => "Configuração salva.");
  const test = () => run("test", () => api.testEmail(testTo.trim()), (o) => `E-mail de teste enviado para ${o.to} pelo ${o.provider === "resend" ? "Resend" : "Gmail"}.`);
  const remove = () => {
    if (!window.confirm("Remover a integração com o Resend? Os e-mails voltam a sair pela conta Google do sistema (se conectada).")) return;
    run("remove", async () => { const s = await api.removeEmailConfig(); setSt(s); setForm({ apiKey: "", fromName: "", fromEmail: "", replyTo: "", webhookSecret: "" }); await refresh(); return s; }, () => "Integração removida.");
  };

  const on = !!st?.configured;
  const dom = st?.domainStatus ? DOMAIN[st.domainStatus.status] || ["warn", st.domainStatus.status] : null;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <div style={{ padding: "14px 16px", border: on ? "1px solid var(--line-1)" : "1px dashed var(--line-2)", borderRadius: "var(--r-3)", background: "var(--bg-1)", marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>E-mail (Resend)</div>
          <div className="mono dim" style={{ fontSize: 11, marginTop: 3 }}>disparos, sequências, NPS, relatório mensal e resposta de ticket · sem Resend, sai pela conta Google do sistema</div>
        </div>
        {st && <span className={"chip " + (st.active === "resend" ? "pos" : st.active ? "" : "neg")} style={{ height: 22 }}>{PROVIDER[st.active] ?? st.active}</span>}
      </div>
      {loadErr && <div className="settings-notice" style={{ marginTop: 10 }}>{loadErr}<button onClick={load}>tentar de novo</button></div>}
      {!st && !loadErr && <div className="dim" style={{ fontSize: 12, marginTop: 10 }}>carregando…</div>}
      {st && <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 10, marginTop: 12 }}>
          <label className="kicker" style={{ display: "flex", flexDirection: "column", gap: 6 }}>Chave de API
            <input type="password" autoComplete="off" disabled={!admin || !!busy} value={form.apiKey} onChange={set("apiKey")}
              placeholder={on ? `•••• ${st.last4} · vazio mantém` : "re_…"} style={{ ...inputStyle, fontFamily: "var(--mono)" }} /></label>
          <label className="kicker" style={{ display: "flex", flexDirection: "column", gap: 6 }}>Nome do remetente
            <input disabled={!admin || !!busy} value={form.fromName} onChange={set("fromName")} placeholder="LeverAds" style={inputStyle} /></label>
          <label className="kicker" style={{ display: "flex", flexDirection: "column", gap: 6 }}>E-mail do remetente
            <input type="email" disabled={!admin || !!busy} value={form.fromEmail} onChange={set("fromEmail")} placeholder="contato@seudominio.com.br" style={inputStyle} /></label>
          <label className="kicker" style={{ display: "flex", flexDirection: "column", gap: 6 }}>Responder para (opcional)
            <input type="email" disabled={!admin || !!busy} value={form.replyTo} onChange={set("replyTo")} placeholder="time@seudominio.com.br" style={inputStyle} /></label>
        </div>
        <div style={{ marginTop: 12, padding: "10px 12px", background: "var(--bg-inset)", borderRadius: 16, display: "grid", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
            <span className="kicker">Webhook (devolução e spam)</span>
            <span className={`chip ${st.webhookConfigured ? "pos" : ""}`} style={{ height: 20 }}>{st.webhookConfigured ? "ativo" : "não configurado"}</span>
            <span className="dim">e-mail devolvido marca o endereço como inválido; marcado como spam descadastra o lead</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <code className="mono" style={{ fontSize: 11, padding: "4px 8px", border: "1px solid var(--line-1)", borderRadius: 999, background: "var(--bg-1)", overflowWrap: "anywhere" }}>{webhookUrl}</code>
            <button type="button" onClick={() => { try { navigator.clipboard.writeText(webhookUrl); setMsg({ tone: "pos", text: "URL copiada: cole no Resend → Webhooks (eventos email.bounced e email.complained) e traga o segredo de assinatura." }); } catch { window.prompt("URL do webhook:", webhookUrl); } }} style={chromeBtnStyleSmall}>copiar URL</button>
          </div>
          <label className="kicker" style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 420 }}>Segredo de assinatura do webhook
            <input type="password" autoComplete="off" disabled={!admin || !!busy} value={form.webhookSecret} onChange={set("webhookSecret")}
              placeholder={st.webhookConfigured ? "•••• configurado · vazio mantém" : "whsec_…"} style={{ ...inputStyle, fontFamily: "var(--mono)" }} /></label>
        </div>
        {dom && <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap", fontSize: 12 }}>
          <span className={`chip ${dom[0]}`} style={{ height: 22 }}>{st.domainStatus.name} · {dom[1]}</span>
          {st.domainStatus.status !== "verified" && <span className="dim" style={{ overflowWrap: "anywhere" }}>{domainHint(st.domainStatus)}</span>}
        </div>}
        {!admin && <div className="dim" style={{ fontSize: 12, marginTop: 10 }}>Só leitura: configurar o e-mail exige a etiqueta Admin.</div>}
        {admin && <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
          <button type="button" onClick={save} disabled={!!busy} style={{ height: 30, padding: "0 14px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: "var(--btn-bg)", color: "var(--btn-fg)" }}>{busy === "save" ? "salvando…" : "salvar e-mail"}</button>
          {st.active && <>
            <input type="email" aria-label="E-mail que recebe o teste" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="quem recebe o teste" style={{ ...inputStyle, width: 220 }} />
            <button type="button" onClick={test} disabled={!!busy || !testTo.trim()} style={chromeBtnStyleSmall}>{busy === "test" ? "enviando…" : "enviar e-mail de teste"}</button>
          </>}
          {on && <button type="button" onClick={remove} disabled={!!busy} style={{ ...chromeBtnStyleSmall, color: "var(--neg)" }}>remover</button>}
        </div>}
        {msg && <div role={msg.tone === "neg" ? "alert" : "status"} style={{ fontSize: 12, marginTop: 8, color: msg.tone === "neg" ? "var(--neg)" : "var(--pos)" }}>{msg.text}</div>}
      </>}
    </div>
  );
}
