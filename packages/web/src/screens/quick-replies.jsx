import React from "react";
import "./tickets/tickets.css";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { EmptyState, MoreMenu, PrimaryButton, SecondaryButton, toast } from "../atoms.jsx";
import { Card, PageHead, Segmented } from "../components/viz.jsx";
import { Modal } from "../components/overlay.jsx";
import { Popover } from "../components/popover.jsx";
import { useActiveSaas } from "../lib/workspace.js";
import { supportScope, noScopeHint, fold } from "../lib/tickets.js";

// Suporte · Respostas rápidas: textos prontos pro chat do ticket, da EQUIPE
// (por produto; edita quem tem Configurações de SLA) ou PESSOAIS (só de quem
// criou). Variáveis `{{cliente.primeiro_nome}}` são automáticas; as do produto
// (`{{horario_atendimento}}`) ficam em ticket_settings.variables e são editadas
// aqui. Quem resolve o texto é o servidor — a prévia usa a mesma função do chat.

const { useState, useEffect, useMemo, useRef, useCallback } = React;

const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
const slug = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const excerpt = (s, n = 140) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };

// Texto com as variáveis destacadas (lista e prévia sem resolver).
export function TokenText({ text }) {
  const parts = String(text || "").split(/(\{\{\s*[a-z][a-z0-9_.]*\s*\}\})/gi);
  return parts.map((p, i) => (/^\{\{/.test(p)
    ? <span key={i} className="mono" style={{ fontSize: "0.92em", color: "var(--accent)", background: "var(--accent-soft)", borderRadius: 4, padding: "0 3px" }}>{p}</span>
    : <React.Fragment key={i}>{p}</React.Fragment>));
}

// Lista de variáveis pra inserir no texto (do produto primeiro).
export function VariablePicker({ anchor, variables, onPick, onClose }) {
  const [q, setQ] = useState("");
  const all = useMemo(() => [
    ...(variables?.custom || []).map((v) => ({ key: v.key, label: v.label || "do produto", group: "Do produto" })),
    ...(variables?.builtin || []).map((v) => ({ ...v, group: "Automáticas" })),
  ], [variables]);
  const k = fold(q.trim());
  const list = all.filter((v) => !k || fold(v.key).includes(k) || fold(v.label).includes(k));
  return (
    <Popover anchor={anchor} onClose={onClose} width={320} title="Inserir variável" maxHeight={380}>
      <input className="inp" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar variável…" aria-label="Buscar variável"
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && list[0]) { onPick(list[0].key); onClose(); } }}
        style={{ width: "100%", boxSizing: "border-box", height: 30, fontSize: 12.5, marginBottom: 6 }} />
      {list.map((v, i) => (
        <React.Fragment key={v.key}>
          {(i === 0 || list[i - 1].group !== v.group) && <div className="kicker" style={{ padding: "6px 6px 2px" }}>{v.group}</div>}
          <button type="button" className="tk-menu-item" onClick={() => { onPick(v.key); onClose(); }}
            style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", width: "100%", padding: "6px 8px", borderRadius: 6, textAlign: "left" }}>
            <span className="mono" style={{ fontSize: 12, color: "var(--accent)" }}>{`{{${v.key}}}`}</span>
            <span style={{ fontSize: 11.5, color: "var(--fg-3)" }}>{v.label}</span>
          </button>
        </React.Fragment>
      ))}
      {list.length === 0 && <div className="mono dim" style={{ fontSize: 12, padding: 8 }}>nenhuma variável</div>}
    </Popover>
  );
}

function ScopeToggle({ value, onChange, canEditShared, disabled }) {
  const opt = (v, label, off, title) => {
    const on = value === v;
    return (
      <button type="button" disabled={disabled || off} title={title} aria-pressed={on} onClick={() => onChange(v)}
        style={{ height: 30, padding: "0 14px", borderRadius: 7, fontSize: 12.5, fontWeight: on ? 600 : 500, background: on ? "var(--bg-1)" : "transparent", boxShadow: on ? "var(--shadow-segment)" : "none", color: on ? "var(--fg-1)" : "var(--fg-3)", opacity: off ? 0.5 : 1, cursor: off || disabled ? "default" : "pointer" }}>{label}</button>
    );
  };
  return (
    <div style={{ display: "inline-flex", gap: 2, padding: 3, borderRadius: 9, background: "var(--bg-2)" }}>
      {opt("shared", "Da equipe", !canEditShared, canEditShared ? "todo atendente do produto vê e usa" : "só quem gerencia o suporte cria respostas da equipe")}
      {opt("personal", "Só minha", false, "só você vê e usa")}
    </div>
  );
}

function Editor({ saasId, initial, canEditShared, variables, onClose, onSaved, onDeleted }) {
  const editing = !!initial?.id;
  const readOnly = editing && !initial.editable;
  const [form, setForm] = useState(() => ({
    title: initial?.title || "", shortcut: initial?.shortcut || "", body: initial?.body || "",
    scope: initial?.scope || (canEditShared ? "shared" : "personal"),
  }));
  const [shortcutTouched, setShortcutTouched] = useState(!!initial?.shortcut);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);
  const [picker, setPicker] = useState(false);
  const bodyRef = useRef(null), pickRef = useRef(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const dirty = !readOnly && (form.title !== (initial?.title || "") || form.body !== (initial?.body || "") || form.shortcut !== (initial?.shortcut || "") || form.scope !== (initial?.scope || form.scope));

  useEffect(() => {
    if (!form.body.trim()) { setPreview(null); return undefined; }
    const t = setTimeout(() => { api.quickReplyPreview(saasId, form.body).then(setPreview).catch(() => setPreview(null)); }, 350);
    return () => clearTimeout(t);
  }, [form.body, saasId]);

  const insertVar = (key) => {
    const el = bodyRef.current;
    const token = `{{${key}}}`;
    const start = el ? el.selectionStart : form.body.length, end = el ? el.selectionEnd : form.body.length;
    const body = form.body.slice(0, start) + token + form.body.slice(end);
    set({ body });
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(start + token.length, start + token.length); } });
  };
  const save = async () => {
    setBusy(true); setError("");
    try {
      const payload = { title: form.title, shortcut: form.shortcut || slug(form.title), body: form.body };
      const saved = editing
        ? await api.quickReplyUpdate(initial.id, payload)
        : await api.quickReplyCreate({ ...payload, scope: form.scope, saas: saasId });
      toast(editing ? "Resposta rápida salva" : "Resposta rápida criada", "pos");
      onSaved(saved);
    } catch (err) { setError(err.message || "Não deu pra salvar."); }
    finally { setBusy(false); }
  };
  const close = () => { if (dirty && !window.confirm("Descartar as alterações desta resposta rápida?")) return; onClose(); };
  const remove = async () => {
    if (!window.confirm(`Apagar a resposta rápida "${initial.title}"?${initial.scope === "shared" ? " Ela some pra toda a equipe." : ""}`)) return;
    try { await api.quickReplyDelete(initial.id); toast("Resposta rápida apagada", "pos"); onDeleted(initial.id); }
    catch (err) { toast(`Não deu pra apagar · ${err.message}`, "neg"); }
  };

  const label = (text, child, extra) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}><span className="kicker">{text}</span>{extra}</span>
      {child}
    </div>
  );
  return (
    <Modal onClose={close} fechavel={!busy && !dirty} label="Resposta rápida" largura={940}>
      <div style={{ padding: "18px var(--inset-x) 0", display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="card-title" style={{ margin: 0 }}>{readOnly ? initial.title : editing ? "Editar resposta rápida" : "Nova resposta rápida"}</h2>
          <div className="card-sub" style={{ marginTop: 3 }}>
            {readOnly ? "resposta da equipe · só quem gerencia o suporte edita; você pode duplicar como sua" : "no chat do ticket, digite / e o atalho, ou use o botão Respostas rápidas"}
          </div>
        </div>
        <button type="button" onClick={close} aria-label="Fechar" style={{ width: 32, height: 32, borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-3)" }}>✕</button>
      </div>
      <div className="qr-editor">
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          {label("Título", <input className="inp" value={form.title} maxLength={120} disabled={readOnly} autoFocus={!editing}
            onChange={(e) => set({ title: e.target.value, ...(shortcutTouched ? {} : { shortcut: slug(e.target.value) }) })} placeholder="Ex.: Boas-vindas" />)}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12, alignItems: "end" }}>
            {label("Atalho", (
              <div className="inp" style={{ display: "flex", alignItems: "center", gap: 2, padding: "0 12px", opacity: readOnly ? 0.6 : 1 }}>
                <span className="mono dim">/</span>
                <input value={form.shortcut} disabled={readOnly} aria-label="Atalho" placeholder="boas-vindas"
                  onChange={(e) => { setShortcutTouched(true); set({ shortcut: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") }); }}
                  style={{ flex: 1, minWidth: 0, border: 0, outline: "none", background: "transparent", font: "inherit", fontFamily: "var(--mono)", fontSize: 12.5, color: "var(--fg-1)", height: "100%" }} />
              </div>
            ))}
            {label("Quem vê", <ScopeToggle value={form.scope} onChange={(v) => set({ scope: v })} canEditShared={canEditShared} disabled={editing} />)}
          </div>
          {label("Texto", (
            <textarea ref={bodyRef} className="inp" rows={10} value={form.body} disabled={readOnly} maxLength={5000}
              onChange={(e) => set({ body: e.target.value })} onKeyDown={(e) => e.stopPropagation()}
              placeholder={"{{saudacao}}, {{cliente.primeiro_nome}}!\n\nRecebemos o seu chamado #{{ticket.numero}} e já estamos olhando."}
              style={{ height: "auto", padding: "10px 12px", resize: "vertical", font: "inherit", fontSize: 13, lineHeight: 1.55 }} />
          ), !readOnly && (
            <span style={{ marginLeft: "auto" }}>
              <button ref={pickRef} type="button" onClick={() => setPicker(true)} style={{ fontSize: 12, color: "var(--accent)", fontWeight: 600 }}>+ Inserir variável</button>
              {picker && <VariablePicker anchor={pickRef} variables={variables} onPick={insertVar} onClose={() => setPicker(false)} />}
            </span>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          <span className="kicker">Prévia</span>
          <div className="support-msg" data-kind="reply" style={{ margin: 0, minHeight: 120 }}>
            {preview ? preview.text : <span className="dim">o texto aparece aqui, com as variáveis preenchidas</span>}
          </div>
          <div className="mono dim" style={{ fontSize: 11 }}>com dados de exemplo · no ticket entram o cliente, o número e o prazo reais</div>
          {preview?.missing?.length > 0 && (
            <div role="alert" style={{ fontSize: 12.5, color: "var(--neg)" }}>Variável que não existe: {preview.missing.map((k) => `{{${k}}}`).join(", ")} — o texto vai com a marcação.</div>
          )}
          {preview?.empty?.length > 0 && (
            <div style={{ fontSize: 12.5, color: "var(--warn)" }}>Sem valor configurado: {preview.empty.map((k) => `{{${k}}}`).join(", ")}</div>
          )}
        </div>
      </div>
      {error && <div role="alert" style={{ padding: "0 var(--inset-x)", fontSize: 12.5, color: "var(--neg)" }}>{error}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px var(--inset-x) 18px" }}>
        {editing && initial.editable && <button type="button" onClick={remove} style={{ fontSize: 12.5, color: "var(--neg)", fontWeight: 600 }}>Apagar</button>}
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8 }}>
          <SecondaryButton type="button" onClick={close} disabled={busy}>{readOnly ? "Fechar" : "Cancelar"}</SecondaryButton>
          {!readOnly && <PrimaryButton type="button" onClick={save} disabled={busy || !form.title.trim() || !form.body.trim()}>{busy ? "Salvando…" : "Salvar"}</PrimaryButton>}
        </span>
      </div>
    </Modal>
  );
}

function VariablesCard({ saasId, variables, canEditShared, onSaved }) {
  const [rows, setRows] = useState(() => variables?.custom || []);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setRows(variables?.custom || []); }, [variables]);
  const original = JSON.stringify(variables?.custom || []);
  const dirty = JSON.stringify(rows) !== original;
  const reserved = new Set((variables?.builtin || []).map((v) => v.key));
  const invalid = (r) => !KEY_RE.test(r.key) || reserved.has(r.key) || rows.filter((x) => x.key === r.key).length > 1;
  const setRow = (i, patch) => setRows((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const save = async () => {
    setBusy(true);
    try { await api.supportSettingsSave(saasId, { variables: rows }); toast("Variáveis salvas", "pos"); onSaved(); }
    catch (err) { toast(`Não deu pra salvar as variáveis · ${err.message}`, "neg"); }
    finally { setBusy(false); }
  };
  const copy = async (key) => { try { await navigator.clipboard.writeText(`{{${key}}}`); toast(`{{${key}}} copiada`, "pos"); } catch { toast(`{{${key}}}`, "neutral"); } };
  return (
    <Card title="Variáveis" hint="escreva {{nome}} no texto; o chat troca pelo valor na hora de inserir">
      <div style={{ padding: "12px var(--inset-x) 16px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span className="kicker">Do produto</span>
            {canEditShared && <button type="button" onClick={() => setRows((l) => [...l, { key: "", value: "", label: "" }])} style={{ marginLeft: "auto", fontSize: 12, color: "var(--accent)", fontWeight: 600 }}>+ Variável</button>}
          </div>
          {rows.length === 0 && <div className="mono dim" style={{ fontSize: 11.5 }}>{canEditShared ? "ex.: horario_atendimento, link_ajuda, telefone_suporte" : "nenhuma variável do produto"}</div>}
          {rows.map((r, i) => (
            <div key={i} className="qr-var-row">
              <div className="inp" style={{ display: "flex", alignItems: "center", padding: "0 8px", gap: 1, borderColor: r.key && invalid(r) ? "var(--neg)" : undefined }} title={r.key && invalid(r) ? "use letras minúsculas, números e _ (sem repetir nem usar nome automático)" : ""}>
                <span className="mono dim" style={{ fontSize: 11 }}>{"{{"}</span>
                <input value={r.key} disabled={!canEditShared} aria-label="Nome da variável" placeholder="nome"
                  onChange={(e) => setRow(i, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })}
                  style={{ flex: 1, minWidth: 0, border: 0, outline: "none", background: "transparent", fontFamily: "var(--mono)", fontSize: 12, color: "var(--fg-1)", height: "100%" }} />
                <span className="mono dim" style={{ fontSize: 11 }}>{"}}"}</span>
              </div>
              <input className="inp" value={r.value} disabled={!canEditShared} aria-label={`Valor de ${r.key || "variável"}`} placeholder="valor" maxLength={500}
                onChange={(e) => setRow(i, { value: e.target.value })} style={{ fontSize: 12.5 }} />
              {canEditShared && <button type="button" aria-label={`Remover ${r.key || "variável"}`} onClick={() => setRows((l) => l.filter((_, j) => j !== i))} style={{ color: "var(--fg-4)", fontSize: 13 }}>✕</button>}
            </div>
          ))}
          {canEditShared && dirty && (
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
              <SecondaryButton size="sm" type="button" onClick={() => setRows(variables?.custom || [])} disabled={busy}>Descartar</SecondaryButton>
              <SecondaryButton size="sm" type="button" onClick={save} disabled={busy || rows.some(invalid)} style={{ borderColor: "var(--accent-line)", color: "var(--accent)" }}>{busy ? "Salvando…" : "Salvar variáveis"}</SecondaryButton>
            </div>
          )}
          {!canEditShared && rows.length > 0 && <div className="dim" style={{ fontSize: 11.5, marginTop: 6 }}>quem gerencia o suporte edita estes valores</div>}
        </div>
        <div>
          <div className="kicker" style={{ marginBottom: 4 }}>Automáticas</div>
          {(variables?.builtin || []).map((v) => (
            <button key={v.key} type="button" onClick={() => copy(v.key)} className="tk-menu-item" title="Copiar"
              style={{ display: "flex", alignItems: "baseline", gap: 8, width: "100%", padding: "4px 6px", borderRadius: 6, textAlign: "left" }}>
              <span className="mono" style={{ fontSize: 11.5, color: "var(--accent)", flexShrink: 0 }}>{`{{${v.key}}}`}</span>
              <span className="support-ellipsis" style={{ fontSize: 11.5, color: "var(--fg-3)" }}>{v.label}</span>
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}

export function QuickRepliesScreen() {
  const { version } = useData();
  const [product] = useActiveSaas();
  const saasId = product?.id || "";
  const scope = supportScope();
  const handles = scope === null || scope.includes(saasId);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null); // {} = nova; resposta = editar

  const load = useCallback(async () => {
    if (!handles || !saasId) return;
    try { setData(await api.quickReplies(saasId)); setError(""); }
    catch (err) { setError(err.message || "erro"); }
  }, [handles, saasId]);
  useEffect(() => { setData(null); load(); }, [load, version]);
  useEffect(() => {
    let t = 0;
    const on = (e) => { const c = e.detail?.collection; if (c !== "quick_replies" && c !== "ticket_settings") return; clearTimeout(t); t = setTimeout(load, 500); };
    window.addEventListener("cockpit-change", on);
    return () => { clearTimeout(t); window.removeEventListener("cockpit-change", on); };
  }, [load]);

  const items = data?.items || [];
  const shared = items.filter((x) => x.scope === "shared");
  const mine = items.filter((x) => x.scope === "personal");
  const k = fold(q.trim()).replace(/^\//, "");
  const visible = (tab === "shared" ? shared : tab === "personal" ? mine : items)
    .filter((x) => !k || fold(x.title).includes(k) || fold(x.shortcut).includes(k) || fold(x.body).includes(k));

  const duplicate = async (qr) => {
    const base = { scope: "personal", saas: saasId, title: `${qr.title}`, body: qr.body };
    for (const shortcut of [qr.shortcut, `${qr.shortcut}-2`, `${qr.shortcut}-${Date.now().toString(36).slice(-3)}`]) {
      try { const saved = await api.quickReplyCreate({ ...base, shortcut }); toast("Duplicada como sua", "pos"); await load(); setEditing(saved); return; }
      catch (err) { if (err.body?.code !== "shortcut_taken") { toast(`Não deu pra duplicar · ${err.message}`, "neg"); return; } }
    }
  };
  const remove = async (qr) => {
    if (!window.confirm(`Apagar a resposta rápida "${qr.title}"?${qr.scope === "shared" ? " Ela some pra toda a equipe." : ""}`)) return;
    try { await api.quickReplyDelete(qr.id); toast("Resposta rápida apagada", "pos"); load(); }
    catch (err) { toast(`Não deu pra apagar · ${err.message}`, "neg"); }
  };

  return (
    <div className="support-page" style={{ overflowY: "auto" }}>
      <PageHead title="Respostas rápidas" sub={handles && data ? `suporte · ${product?.name}: ${shared.length} da equipe · ${mine.length} ${mine.length === 1 ? "sua" : "suas"} · no chat do ticket, digite /` : "suporte"}>
        {handles && data && <PrimaryButton onClick={() => setEditing({})}>+ Resposta rápida</PrimaryButton>}
      </PageHead>

      {!handles ? (
        <EmptyState title={`Você não atende ${product?.name || "este produto"}`} hint={noScopeHint(product?.name)} />
      ) : error ? (
        <div style={{ margin: "16px var(--pad-x)", padding: "12px 14px", borderRadius: "var(--r-3)", background: "var(--warn-soft)", color: "var(--warn)", fontSize: 12.5 }}>
          Não deu pra carregar as respostas rápidas ({error}). <button type="button" onClick={load} style={{ fontWeight: 700, color: "inherit", textDecoration: "underline" }}>recarregar</button>
        </div>
      ) : !data ? (
        <div className="mono dim" style={{ fontSize: 12, padding: "24px var(--pad-x)" }}>carregando…</div>
      ) : (
        <div className="qr-layout">
          <Card>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", flexWrap: "wrap", borderBottom: "1px solid var(--line-1)" }}>
              <Segmented value={tab} onChange={setTab} options={[
                { value: "all", label: `Todas ${items.length}` },
                { value: "shared", label: `Da equipe ${shared.length}` },
                { value: "personal", label: `Minhas ${mine.length}` },
              ]} />
              <input className="inp" value={q} onChange={(e) => setQ(e.target.value)} placeholder="buscar título, atalho ou texto…" aria-label="Buscar respostas rápidas" style={{ marginLeft: "auto", width: "min(260px, 100%)", height: 30, fontSize: 12.5 }} />
            </div>
            {items.length === 0 ? (
              <EmptyState title="Nenhuma resposta rápida ainda"
                hint="Crie textos prontos com variáveis como {{cliente.primeiro_nome}} e {{ticket.numero}}. No chat do ticket, digite / e o atalho pra inserir."
                action={<PrimaryButton onClick={() => setEditing({})}>+ Criar a primeira</PrimaryButton>} />
            ) : visible.length === 0 ? (
              <div className="mono dim" style={{ fontSize: 12, padding: 16 }}>nenhuma resposta {q.trim() ? `com "${q.trim()}"` : "nesta aba"}</div>
            ) : visible.map((qr) => (
              <div key={qr.id} role="button" tabIndex={0} className="qr-row" onClick={() => setEditing(qr)} onKeyDown={(e) => { if (e.key === "Enter") setEditing(qr); }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span className="support-ellipsis" style={{ fontSize: 13.5, fontWeight: 600 }}>{qr.title}</span>
                    <span className="mono" style={{ fontSize: 11.5, color: "var(--fg-3)", flexShrink: 0 }}>/{qr.shortcut}</span>
                    <span className="support-status" style={{ "--dot": qr.scope === "shared" ? "var(--accent)" : "var(--fg-4)", fontSize: 11.5, color: "var(--fg-3)", flexShrink: 0 }}>{qr.scope === "shared" ? "equipe" : "sua"}</span>
                  </div>
                  <div className="qr-excerpt"><TokenText text={excerpt(qr.body, 180)} /></div>
                </div>
                <span className="mono dim hide-mobile" style={{ fontSize: 11, whiteSpace: "nowrap" }}>{qr.uses ? `usada ${qr.uses}×` : "nunca usada"}</span>
                <MoreMenu items={[
                  { label: qr.editable ? "Editar" : "Ver", onClick: () => setEditing(qr) },
                  qr.scope === "shared" && { label: "Duplicar como minha", onClick: () => duplicate(qr) },
                  qr.editable && { label: "Apagar", tone: "neg", onClick: () => remove(qr) },
                ]} />
              </div>
            ))}
          </Card>
          <VariablesCard saasId={saasId} variables={data.variables} canEditShared={data.canEditShared} onSaved={load} />
        </div>
      )}

      {editing && data && (
        <Editor key={editing.id || "nova"} saasId={saasId} initial={editing.id ? editing : null} canEditShared={data.canEditShared} variables={data.variables}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} onDeleted={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}
