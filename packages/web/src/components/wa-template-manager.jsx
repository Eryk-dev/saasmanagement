import React from "react";
import { api } from "../lib/api.js";
import { Modal } from "./overlay.jsx";
import { SelectPopover } from "./select-popover.jsx";
// Modelos OFICIAIS do WhatsApp (Meta): lista com status de aprovação, motivo
// de rejeição e qualidade; criar (cabeçalho de texto, corpo com variáveis
// numeradas e um exemplo por variável, rodapé, até 3 botões); apagar.
// Mora em Disparos → Modelos e no Inbox → Automações (docs/PLANO-DISPAROS.md).
// Modelo aprovado é o que sai fora da janela de 24h e no disparo pela API.

const { useState, useEffect } = React;
const STATUS = {
  APPROVED: ["pos", "aprovado"], PENDING: ["warn", "em análise"], IN_APPEAL: ["warn", "em recurso"],
  REJECTED: ["neg", "rejeitado"], PAUSED: ["neg", "pausado"], DISABLED: ["neg", "desativado"], FLAGGED: ["warn", "sinalizado"],
};
const QUALITY = { GREEN: ["pos", "qualidade alta"], YELLOW: ["warn", "qualidade média"], RED: ["neg", "qualidade baixa"] };
const CATEGORY = { UTILITY: "utilidade", MARKETING: "marketing", AUTHENTICATION: "autenticação" };
const pill = { display: "inline-flex", alignItems: "center", gap: 5, height: 28, padding: "0 11px", borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-2)", flexShrink: 0 };
const varCount = (body) => Math.max(0, ...(String(body || "").match(/\{\{\s*(\d+)\s*\}\}/g) || []).map((s) => Number(s.replace(/\D/g, ""))));

// Presets da LeverAds (no-show e reengajamento). {{1}} = primeiro nome do lead.
const PRESETS = [
  { key: "no_show", button: "No show da call", name: "call_no_show", category: "UTILITY",
    body: "Oi {{1}}, é a Manuela da LeverAds. Passei na nossa call no horário e não te encontrei, acontece! Quer que eu remarque? Me diz um horário que fica bom que eu já reservo.", examples: ["João"] },
  { key: "interesse", button: "Ainda tem interesse?", name: "segue_interesse", category: "MARKETING",
    body: "Oi {{1}}, é a Manuela da LeverAds. Passando pra saber se você ainda tem interesse em escalar sua operação nos marketplaces com a gente. Se fizer sentido, me responde por aqui que eu te mostro como funciona, sem compromisso.", examples: ["João"] },
];

export function WaTemplateManager({ compact = false }) {
  const [data, setData] = useState(null); // { templates } | { error }
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  const load = () => api.waTemplatesAll().then(setData).catch((e) => setData({ error: e.message || "não deu pra listar os modelos" }));
  useEffect(() => { load(); }, []);

  async function remove(t) {
    if (!window.confirm(`Apagar o modelo "${t.name}" na Meta? Disparos e mensagens que usam esse modelo deixam de funcionar, e a Meta não deixa reusar o nome por 30 dias.`)) return;
    setBusy(t.name); setMsg(null);
    try { await api.waDeleteTemplate(t.name); setMsg({ ok: true, text: `Modelo "${t.name}" apagado.` }); await load(); }
    catch (e) { setMsg({ ok: false, text: e.message || "não deu pra apagar" }); }
    finally { setBusy(""); }
  }

  const list = data?.templates || [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" onClick={() => setCreating(true)} style={pill}>+ novo modelo oficial</button>
        <button type="button" onClick={load} className="mono dim" style={{ fontSize: 11 }}>↻ atualizar</button>
        {!compact && <span className="dim" style={{ fontSize: 12 }}>a Meta revisa cada modelo antes de liberar (minutos a horas)</span>}
      </div>
      {data === null && <span className="dim" style={{ fontSize: 12 }}>carregando…</span>}
      {data?.error && <span role="alert" style={{ fontSize: 12, color: "var(--neg)" }}>{data.error} <button type="button" onClick={load} style={{ textDecoration: "underline" }}>tentar de novo</button></span>}
      {msg && <span role={msg.ok ? "status" : "alert"} style={{ fontSize: 12, color: msg.ok ? "var(--pos)" : "var(--neg)" }}>{msg.text}</span>}
      {list.map((t) => {
        const st = STATUS[t.status] || ["", String(t.status || "?").toLowerCase()];
        const q = QUALITY[t.quality];
        return (
          <div key={`${t.name}:${t.language}`} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8, padding: "10px 14px", background: "var(--bg-inset)", borderRadius: 16 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{t.name}</span>
                <span className={`chip ${st[0]}`} style={{ height: 20 }}>{st[1]}</span>
                {q && <span className={`chip ${q[0]}`} style={{ height: 20 }}>{q[1]}</span>}
                <span className="dim" style={{ fontSize: 11.5 }}>{CATEGORY[t.category] || t.category} · {t.language}{t.params ? ` · ${t.params} variáve${t.params > 1 ? "is" : "l"}` : ""}</span>
              </div>
              {t.header?.format === "TEXT" && t.header.text && <div style={{ fontSize: 12, fontWeight: 600, marginTop: 6 }}>{t.header.text}</div>}
              {t.header?.format === "IMAGE" && <div className="dim" style={{ fontSize: 11.5, marginTop: 6 }}>[imagem no cabeçalho]</div>}
              <div style={{ fontSize: 12.5, color: "var(--fg-2)", marginTop: 4, whiteSpace: "pre-wrap" }}>{t.body}</div>
              {t.footer && <div className="dim" style={{ fontSize: 11.5, marginTop: 4 }}>{t.footer}</div>}
              {t.buttons?.length > 0 && <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>{t.buttons.map((b, i) => <span key={i} className="chip" style={{ height: 20 }} title={b.url || undefined}>{b.type === "URL" ? "↗ " : ""}{b.text}</span>)}</div>}
              {t.rejectedReason && <div style={{ fontSize: 12, color: "var(--neg)", marginTop: 6 }}>Motivo da Meta: {t.rejectedReason}</div>}
            </div>
            <button type="button" onClick={() => remove(t)} disabled={!!busy} aria-label={`Apagar modelo ${t.name}`} style={{ ...pill, height: 26, color: "var(--neg)", alignSelf: "start" }}>{busy === t.name ? "apagando…" : "apagar"}</button>
          </div>
        );
      })}
      {data && !data.error && list.length === 0 && <span className="dim" style={{ fontSize: 12 }}>Nenhum modelo oficial ainda: crie o primeiro.</span>}
      {creating && <WaTemplateCreator onClose={(created) => { setCreating(false); if (created) load(); }} />}
    </div>
  );
}

export function WaTemplateCreator({ onClose }) {
  const blank = { name: "", category: "UTILITY", language: "pt_BR", headerText: "", body: "", examples: [], footer: "", buttons: [] };
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [created, setCreated] = useState(false);
  const set = (p) => setForm((f) => ({ ...f, ...p }));
  const n = varCount(form.body);
  const examples = Array.from({ length: n }, (_, i) => form.examples[i] || "");
  const missing = examples.some((x) => !x.trim());
  const badBtn = form.buttons.some((b) => b.text.trim() && b.type === "URL" && !/^https:\/\/\S+$/.test(b.url.trim()));
  const canSend = !busy && form.name.trim() && form.body.trim() && !missing && !badBtn;

  async function submit() {
    setBusy(true); setMsg(null);
    try {
      const r = await api.waCreateTemplate({ ...form, example: examples, buttons: form.buttons.filter((b) => b.text.trim()) });
      setCreated(true);
      setMsg({ ok: true, text: `Enviado para a Meta (${r.status === "APPROVED" ? "aprovado" : "em análise"}). Aprovado, ele fica disponível nos disparos e no Inbox.` });
    } catch (e) { setMsg({ ok: false, text: e?.message || "não deu pra criar o modelo" }); }
    setBusy(false);
  }

  const lab = { display: "block", fontSize: 11.5, fontWeight: 600, color: "var(--fg-3)", marginBottom: 4 };
  const inp = { width: "100%", height: 36, padding: "0 10px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 13, boxSizing: "border-box" };
  const setBtn = (i, p) => set({ buttons: form.buttons.map((b, j) => (j === i ? { ...b, ...p } : b)) });
  return (
    <Modal onClose={() => onClose(created)} label="criar modelo oficial do WhatsApp" largura={600} padding={16} painelStyle={{ padding: 22 }} fechavel={!busy}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
        <div style={{ fontSize: 15.5, fontWeight: 800, flex: 1 }}>Novo modelo oficial do WhatsApp</div>
        <button type="button" onClick={() => onClose(created)} disabled={busy} aria-label="Fechar" style={{ ...pill, height: 26, padding: "0 9px" }}>✕</button>
      </div>
      <div className="dim" style={{ fontSize: 12, marginBottom: 14 }}>
        Modelo aprovado pela Meta é o único que sai fora das 24h e nos disparos. Use <b>{"{{1}}"}</b>, <b>{"{{2}}"}</b>… para as partes que mudam por lead.
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <span className="kicker">Começar de</span>
        {PRESETS.map((p) => <button type="button" key={p.key} onClick={() => { setForm({ ...blank, name: p.name, category: p.category, body: p.body, examples: p.examples }); setMsg(null); }} style={{ ...pill, height: 26 }}>{p.button}</button>)}
      </div>
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 130px 100px", gap: 10 }}>
          <label><span style={lab}>Nome (a-z, 0-9, _)</span><input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="call_no_show" className="mono" style={inp} /></label>
          <div><span style={lab}>Categoria</span>
            <SelectPopover label="Categoria" value={form.category} onChange={(v) => set({ category: v })} style={{ height: 36, borderRadius: 999 }}
              options={[{ value: "UTILITY", label: "Utilidade" }, { value: "MARKETING", label: "Marketing" }]} /></div>
          <label><span style={lab}>Idioma</span><input value={form.language} onChange={(e) => set({ language: e.target.value })} className="mono" style={inp} /></label>
        </div>
        <label><span style={lab}>Cabeçalho (opcional, até 60, sem variável)</span><input value={form.headerText} maxLength={60} onChange={(e) => set({ headerText: e.target.value })} style={inp} /></label>
        <label><span style={lab}>Corpo da mensagem</span>
          <textarea value={form.body} maxLength={1024} onChange={(e) => set({ body: e.target.value })} rows={5} placeholder="Oi {{1}}, é a Manuela da LeverAds…" style={{ ...inp, height: "auto", padding: "9px 10px", borderRadius: 16, resize: "vertical", lineHeight: 1.45 }} /></label>
        {n > 0 && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
          {examples.map((x, i) => (
            <label key={i}><span style={lab}>Exemplo para {`{{${i + 1}}}`} (a Meta exige)</span>
              <input value={x} onChange={(e) => { const ex = [...examples]; ex[i] = e.target.value; set({ examples: ex }); }} placeholder={i === 0 ? "João" : "exemplo"} style={inp} /></label>
          ))}
        </div>}
        <label><span style={lab}>Rodapé (opcional, até 60)</span><input value={form.footer} maxLength={60} onChange={(e) => set({ footer: e.target.value })} placeholder="Responda SAIR para não receber mais" style={inp} /></label>
        <div>
          <span style={lab}>Botões (opcional, até 3)</span>
          <div style={{ display: "grid", gap: 8 }}>
            {form.buttons.map((b, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "140px minmax(0,1fr) minmax(0,1.3fr) auto", gap: 8, alignItems: "center" }}>
                <SelectPopover label={`Tipo do botão ${i + 1}`} value={b.type} onChange={(v) => setBtn(i, { type: v })} style={{ height: 36, borderRadius: 999 }}
                  options={[{ value: "QUICK_REPLY", label: "resposta rápida" }, { value: "URL", label: "link" }]} />
                <input aria-label={`Texto do botão ${i + 1}`} value={b.text} maxLength={25} onChange={(e) => setBtn(i, { text: e.target.value })} placeholder="Quero saber mais" style={inp} />
                {b.type === "URL" ? <input aria-label={`Link do botão ${i + 1}`} value={b.url} onChange={(e) => setBtn(i, { url: e.target.value })} placeholder="https://…" style={inp} /> : <span />}
                <button type="button" aria-label={`Remover botão ${i + 1}`} onClick={() => set({ buttons: form.buttons.filter((_, j) => j !== i) })} style={{ ...pill, height: 26, padding: "0 9px" }}>✕</button>
              </div>
            ))}
            {form.buttons.length < 3 && <button type="button" onClick={() => set({ buttons: [...form.buttons, { type: "QUICK_REPLY", text: "", url: "" }] })} style={{ ...pill, height: 26, justifySelf: "start" }}>+ botão</button>}
            {badBtn && <span style={{ fontSize: 12, color: "var(--neg)" }}>Botão de link precisa de um endereço https.</span>}
          </div>
        </div>
      </div>
      {msg && <div role={msg.ok ? "status" : "alert"} style={{ fontSize: 12, marginTop: 12, color: msg.ok ? "var(--pos)" : "var(--neg)" }}>{msg.text}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <button type="button" onClick={() => onClose(created)} disabled={busy} style={pill}>fechar</button>
        <button type="button" onClick={submit} disabled={!canSend} style={{ ...pill, background: "var(--btn-bg)", color: "var(--btn-fg)", border: "none", opacity: canSend ? 1 : 0.55 }}>{busy ? "enviando…" : "Enviar para aprovação"}</button>
      </div>
    </Modal>
  );
}
