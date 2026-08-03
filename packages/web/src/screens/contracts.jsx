import React from "react";
import { PageHead } from "../components/viz.jsx";
import { EmptyState, PrimaryButton } from "../atoms.jsx";
import { api } from "../lib/api.js";
import { useActiveSaas } from "../lib/workspace.js";

// Contratos — biblioteca de MODELOS por produto. O fluxo é "resgatar": abrir o
// modelo, PREENCHER os dados do cliente no formulário do drawer (os campos vêm
// dos tokens {{chave}} do corpo) e imprimir/salvar em PDF já preenchido, ou
// baixar o .html. Campo vazio imprime como linha em branco (preenche à mão).
// O corpo é o MIOLO em HTML; a impressão veste o CSS jurídico padrão (A4,
// serifa), o mesmo do contrato original de assinatura da LeverAds.

const { useState: useS, useEffect: useE, useRef: useR } = React;

// CSS de impressão dos contratos (portado de contrato-leverads.html). Vale pra
// todos os modelos: o corpo só traz h1/h2/p/ul/table.quadro/blocos de assinatura.
const CONTRACT_CSS = `
  @page { size: A4; margin: 2.2cm 2cm; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, "Times New Roman", serif; font-size: 10.5pt; line-height: 1.55; color: #111; max-width: 17cm; margin: 0 auto; padding: 24px 16px; background: #fff; }
  h1 { font-size: 13pt; text-align: center; text-transform: uppercase; letter-spacing: .04em; margin: 0 0 4px; }
  .subtitle { text-align: center; font-size: 9.5pt; color: #444; margin: 0 0 22px; }
  h2 { font-size: 10.5pt; text-transform: uppercase; letter-spacing: .03em; margin: 20px 0 6px; }
  p { margin: 6px 0; text-align: justify; }
  ul { margin: 6px 0 6px 22px; padding: 0; }
  li { margin: 3px 0; text-align: justify; }
  table.quadro { width: 100%; border-collapse: collapse; margin: 10px 0 4px; }
  table.quadro th, table.quadro td { border: 1px solid #333; padding: 6px 8px; vertical-align: top; font-size: 10pt; text-align: left; }
  table.quadro th { background: #efefef; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .05em; width: 4.2cm; }
  .nota { font-size: 9pt; color: #444; }
  .assin { margin-top: 40px; }
  .assin-bloco { margin-top: 38px; }
  .assin-linha { border-top: 1px solid #111; width: 11cm; padding-top: 4px; font-size: 9.5pt; }
  .duas-col { width: 100%; border-collapse: collapse; margin-top: 30px; }
  .duas-col td { width: 50%; padding: 26px 12px 0 0; vertical-align: bottom; }
  .duas-col .assin-linha { width: 100%; }
  .local-data { margin-top: 34px; }
`;

const escHtml = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

// Campos de preenchimento do modelo: a lista `fields` do documento (com rótulo/
// placeholder bons) ou, na falta dela, os tokens {{chave}} achados no corpo —
// assim modelo criado na mão pelo time também ganha formulário.
function fieldsOf(c) {
  if (Array.isArray(c?.fields) && c.fields.length) return c.fields;
  const seen = new Set();
  const out = [];
  for (const m of String(c?.body || "").matchAll(/\{\{([a-z0-9_]+)\}\}/gi)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ key: m[1], label: m[1].replace(/_/g, " ") });
  }
  return out;
}

// Token preenchido entra escapado (quebra de linha vira <br>); vazio vira a
// linha em branco de sempre, pro contrato continuar imprimível pra preencher à mão.
const BLANK = "______________________";
function applyFields(body, fields, values) {
  let out = String(body || "");
  for (const f of fields) {
    const v = String(values?.[f.key] ?? "").trim();
    out = out.split(`{{${f.key}}}`).join(v ? escHtml(v).replace(/\n/g, "<br>") : BLANK);
  }
  return out;
}

function fullHtml(c, values) {
  const title = String(c.name || "Contrato").replace(/</g, "&lt;");
  const body = applyFields(c.body, fieldsOf(c), values || {});
  return `<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n<title>${title}</title>\n<style>${CONTRACT_CSS}</style>\n</head>\n<body>\n${body}\n</body>\n</html>`;
}

// Esqueleto de um modelo novo: cabeçalho + quadro resumo mínimo, pro time não
// começar do zero.
const NEW_BODY = `<h1>Título do contrato</h1>
<p class="subtitle">Subtítulo · Lever Ads Software House LTDA</p>

<h2>Quadro Resumo</h2>
<table class="quadro">
  <tr><th>Contratada</th><td><strong>LEVER ADS SOFTWARE HOUSE LTDA</strong>, CNPJ <strong>67.931.740/0001-12</strong>, Avenida Itamarati, 2800, Parque Erasmo Assunção, CEP 09271-410, Santo André/SP.</td></tr>
  <tr><th>Contratante</th><td>Razão social / Nome: {{razao_social}}<br>CNPJ / CPF: {{cnpj_cpf}}</td></tr>
  <tr><th>Investimento</th><td>Valor total: R$ {{valor_total}} · Forma de pagamento: {{forma_pagamento}}</td></tr>
</table>

<h2>Cláusula 1ª · Objeto</h2>
<p><strong>1.1.</strong> Descreva aqui o objeto do contrato.</p>`;

function ContractsScreen() {
  const [product] = useActiveSaas();
  const [items, setItems] = useS(null);
  const [err, setErr] = useS(null);
  const [sel, setSel] = useS(null);      // modelo aberto (visualização)
  const [edit, setEdit] = useS(false);   // drawer em modo edição
  const [draft, setDraft] = useS(null);  // { name, tag, note, body }
  const [fill, setFill] = useS({});      // valores digitados dos campos {{token}} do modelo aberto
  const [busy, setBusy] = useS(false);
  const [copied, setCopied] = useS(false);
  const copyTimer = useR(null);

  async function load() {
    try {
      const all = await api.list("contracts");
      setItems((all || []).filter((c) => !c.saas || c.saas === product?.id));
    } catch (e) { setErr(e.message); }
  }
  useE(() => { setItems(null); setErr(null); setSel(null); setEdit(false); load(); }, [product?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function openView(c) { setSel(c); setEdit(false); setDraft(null); setFill({}); }
  function openEdit(c) { setSel(c); setEdit(true); setDraft({ name: c.name || "", tag: c.tag || "", note: c.note || "", body: c.body || "" }); }
  function openNew() { setSel(null); setEdit(true); setDraft({ name: "", tag: "", note: "", body: NEW_BODY }); }
  function close() { setSel(null); setEdit(false); setDraft(null); }

  async function saveDraft() {
    if (!draft?.name?.trim()) return;
    setBusy(true);
    try {
      const payload = { ...draft, name: draft.name.trim(), saas: product?.id || "", updatedAt: new Date().toISOString() };
      if (sel?.id) await api.update("contracts", sel.id, payload);
      else await api.create("contracts", payload);
      close();
      await load();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  async function duplicate(c) {
    setBusy(true);
    try {
      await api.create("contracts", { name: `${c.name} (cópia)`, tag: c.tag || "", note: c.note || "", body: c.body || "", saas: product?.id || "", updatedAt: new Date().toISOString() });
      await load();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  async function remove(c) {
    if (!window.confirm(`Excluir o modelo "${c.name}"? Essa ação não tem volta.`)) return;
    setBusy(true);
    try { await api.remove("contracts", c.id); close(); await load(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }

  // Resgatar: janela nova com o HTML completo JÁ PREENCHIDO com o formulário do
  // drawer + diálogo de impressão (salvar como PDF). Campo vazio sai em branco.
  function printContract(c, values) {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(fullHtml(c, values));
    w.document.close();
    w.focus();
    setTimeout(() => { try { w.print(); } catch { /* usuário imprime manualmente */ } }, 350);
  }

  function download(c, values) {
    const blob = new Blob([fullHtml(c, values)], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    const cliente = String(values?.razao_social || "").trim();
    a.href = URL.createObjectURL(blob);
    a.download = `${(c.name || "contrato")}${cliente ? " - " + cliente : ""}`.toLowerCase().replace(/[^a-z0-9]+/gi, "-") + ".html";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function copyHtml(c, values) {
    try { await navigator.clipboard.writeText(fullHtml(c, values)); } catch { /* clipboard bloqueado */ }
    setCopied(true);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1600);
  }

  const kicker = { fontSize: 11, fontWeight: 600, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase" };
  const btn = { height: 32, padding: "0 13px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 12.5, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", boxShadow: "var(--shadow-1)" };
  const inp = { width: "100%", height: 34, padding: "0 10px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 13 };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <PageHead title="Contratos" sub="modelos prontos · resgate, preencha o Quadro Resumo e mande assinar">
        <PrimaryButton onClick={openNew}>+ novo modelo</PrimaryButton>
      </PageHead>

      <div style={{ flex: 1, overflow: "auto", padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16 }}>
        {err && <div className="mono" style={{ fontSize: 12, color: "var(--neg)" }}>{err}</div>}
        {!items && !err && <div className="mono dim" style={{ fontSize: 12 }}>carregando modelos…</div>}

        {items && items.length === 0 && (
          <div style={{ minHeight: 240, background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", boxShadow: "var(--shadow-card)" }}>
            <EmptyState title="Nenhum modelo ainda" hint="Crie o primeiro modelo de contrato deste produto." action={<PrimaryButton onClick={openNew}>+ novo modelo</PrimaryButton>} />
          </div>
        )}

        {items && items.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 340px), 1fr))", gap: 14 }}>
            {items.map((c) => (
              <div key={c.id} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", background: "var(--bg-1)", boxShadow: "var(--shadow-card)", padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15.5, fontWeight: 600, letterSpacing: "-.01em", fontFamily: "var(--display)", cursor: "pointer" }} onClick={() => openView(c)}>{c.name}</div>
                    {c.tag && <span className="mono" style={{ display: "inline-block", marginTop: 6, fontSize: 10, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--accent)", border: "1px solid var(--accent-line)", background: "var(--accent-soft)", borderRadius: 999, padding: "2px 8px" }}>{c.tag}</span>}
                  </div>
                </div>
                {c.note && <div style={{ fontSize: 12.5, color: "var(--fg-3)", lineHeight: 1.5 }}>{c.note}</div>}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: "auto" }}>
                  <button onClick={() => openView(c)} style={{ ...btn, background: "var(--btn-bg)", color: "var(--btn-fg)", borderColor: "transparent" }}>Abrir</button>
                  <button onClick={() => printContract(c)} style={btn}>Imprimir / PDF</button>
                  <button onClick={() => openEdit(c)} style={btn}>Editar</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ fontSize: 12.5, color: "var(--fg-4)", lineHeight: 1.5 }}>
          os modelos ficam salvos no servidor pro time todo. “Imprimir / PDF” abre o contrato pronto pra salvar em PDF; os campos em branco do Quadro Resumo são preenchidos por cliente.
        </div>
      </div>

      {(sel || edit) && (
        <div style={{ position: "fixed", inset: 0, background: "oklch(0 0 0 / 0.4)", display: "flex", justifyContent: "flex-end", zIndex: 70 }} onClick={close}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: !edit && sel && fieldsOf(sel).length ? "min(1120px, 100vw)" : "min(860px, 100vw)", height: "100%", background: "var(--bg-1)", borderLeft: "1px solid var(--line-2)", display: "flex", flexDirection: "column", boxShadow: "var(--shadow-pop)" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div className="mono dim" style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>{edit ? (sel ? "Editar modelo" : "Novo modelo") : "Modelo de contrato"}</div>
                <div style={{ fontSize: 17, fontWeight: 500, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{edit ? (draft?.name || "…") : sel?.name}</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                {!edit && sel && (
                  <>
                    <button onClick={() => printContract(sel, fill)} style={{ ...btn, background: "var(--btn-bg)", color: "var(--btn-fg)", borderColor: "transparent" }}>Imprimir / PDF</button>
                    <button onClick={() => download(sel, fill)} style={btn}>Baixar .html</button>
                    <button onClick={() => copyHtml(sel, fill)} style={{ ...btn, ...(copied ? { background: "var(--pos-soft)", color: "var(--pos)" } : {}) }}>{copied ? "✓ copiado" : "Copiar HTML"}</button>
                    <button onClick={() => openEdit(sel)} style={btn}>Editar</button>
                    <button onClick={() => duplicate(sel)} disabled={busy} style={btn}>Duplicar</button>
                    <button onClick={() => remove(sel)} disabled={busy} className="dim" style={{ ...btn, color: "var(--neg)" }}>Excluir</button>
                  </>
                )}
                <button onClick={close} className="mono dim" style={{ fontSize: 16, padding: "0 4px" }}>✕</button>
              </div>
            </div>

            {!edit && sel && (() => {
              const fields = fieldsOf(sel);
              if (!fields.length) return <iframe title={sel.name} srcDoc={fullHtml(sel)} style={{ flex: 1, border: 0, background: "#fff" }} />;
              const done = fields.filter((f) => String(fill[f.key] || "").trim()).length;
              return (
                <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
                  <div style={{ width: 330, flexShrink: 0, borderRight: "1px solid var(--line-1)", overflow: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12, background: "var(--bg-inset)" }}>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                      <span style={kicker}>Dados do contrato</span>
                      <span className="mono dim tnum" style={{ fontSize: 10 }}>{done}/{fields.length}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--fg-4)", lineHeight: 1.5, marginTop: -6 }}>
                      preencha e o contrato ao lado se atualiza; campo vazio sai como linha em branco no PDF
                    </div>
                    {fields.map((f) => (
                      <label key={f.key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <span style={{ ...kicker, fontSize: 10 }}>{f.label}</span>
                        {f.multiline ? (
                          <textarea value={fill[f.key] || ""} rows={2} placeholder={f.placeholder || ""}
                            onChange={(e) => setFill((v) => ({ ...v, [f.key]: e.target.value }))}
                            style={{ ...inp, height: "auto", minHeight: 52, padding: "6px 10px", resize: "vertical", fontFamily: "var(--sans)" }} />
                        ) : (
                          <input value={fill[f.key] || ""} placeholder={f.placeholder || ""}
                            onChange={(e) => setFill((v) => ({ ...v, [f.key]: e.target.value }))} style={inp} />
                        )}
                        {f.hint && <span className="mono dim" style={{ fontSize: 10 }}>{f.hint}</span>}
                      </label>
                    ))}
                    {done > 0 && (
                      <button onClick={() => setFill({})} className="mono dim" style={{ alignSelf: "flex-start", fontSize: 11 }}>limpar campos</button>
                    )}
                  </div>
                  <iframe title={sel.name} srcDoc={fullHtml(sel, fill)} style={{ flex: 1, border: 0, background: "#fff" }} />
                </div>
              );
            })()}

            {edit && draft && (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
                <div style={{ padding: "14px 20px", display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={kicker}>Nome do modelo</span>
                    <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="ex.: Consultoria logística · 4 visitas" style={inp} />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={kicker}>Etiqueta</span>
                    <input value={draft.tag} onChange={(e) => setDraft((d) => ({ ...d, tag: e.target.value }))} placeholder="ex.: serviço" style={inp} />
                  </label>
                  <label style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={kicker}>Nota de uso (aparece no card)</span>
                    <input value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} placeholder="quando usar este modelo, valores de referência…" style={inp} />
                  </label>
                </div>
                <div style={{ flex: 1, minHeight: 0, padding: "0 20px 12px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <textarea value={draft.body} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} spellCheck={false}
                    className="mono" style={{ resize: "none", padding: 12, borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-2)", color: "var(--fg-1)", fontSize: 11.5, lineHeight: 1.55 }} />
                  <iframe title="preview" srcDoc={fullHtml({ ...draft })} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "#fff", width: "100%", height: "100%" }} />
                </div>
                <div style={{ padding: "12px 20px", borderTop: "1px solid var(--line-1)", background: "var(--bg-inset)", display: "flex", gap: 8 }}>
                  <button onClick={saveDraft} disabled={busy || !draft.name.trim()} style={{ flex: 1, padding: "9px 12px", background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))", borderRadius: "var(--r-2)", fontSize: 13, fontWeight: 500, opacity: busy || !draft.name.trim() ? 0.6 : 1 }}>
                    {busy ? "Salvando…" : "Salvar modelo"}
                  </button>
                  <button onClick={() => (sel ? openView(sel) : close())} style={{ padding: "9px 16px", background: "var(--bg-2)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", fontSize: 13 }}>Cancelar</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export { ContractsScreen };
