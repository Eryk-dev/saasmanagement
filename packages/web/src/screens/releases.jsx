import React from "react";
import { createPortal } from "react-dom";
import "./releases.css";
import { api } from "../lib/api.js";
import { EmptyState, MoreMenu, PrimaryButton, SecondaryButton, toast } from "../atoms.jsx";
import { Card, PageHead } from "../components/viz.jsx";
import { Modal } from "../components/overlay.jsx";
import { SelectPopover } from "../components/select-popover.jsx";

// Versões e novidades (só admin): a versão NO AR de cada app da Lever, lida de
// cada um na hora (api/src/releases/app-versions.js), e as novidades de produto
// que cada app mostra aos clientes. No LeverAds elas abrem pelo indicador de
// versão da sidebar (página /updates), lidas de /public/updates/leverads.

const { useState, useEffect, useRef, useCallback } = React;

const PRODUCTS = [{ value: "leverads", label: "LeverAds" }, { value: "leverprice", label: "LeverPrice" }];
const CATEGORIES = [{ value: "novo", label: "Novo" }, { value: "melhoria", label: "Melhoria" }, { value: "correcao", label: "Correção" }];
const catLabel = (v) => CATEGORIES.find((c) => c.value === v)?.label || v;
const when = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

function versionText(app) {
  if (!app.ok) return app.configured === false ? "não configurado" : "fora do ar";
  if (app.version) return app.version.startsWith("v") ? app.version : `v${app.version}`;
  if (app.build) return `build ${app.build}`;
  return "sem versão";
}

function AppRow({ app }) {
  const detail = app.ok
    ? [app.commit && `commit ${app.commit}`, app.detail, app.startedAt && `subiu ${when(app.startedAt)}`].filter(Boolean).join(" · ")
    : app.error;
  return (
    <div className="rel-app">
      <span className="rel-status" style={{ "--dot": app.ok ? "var(--pos)" : app.configured === false ? "var(--fg-4)" : "var(--neg)" }}>{app.name}</span>
      <span className="mono rel-version">{versionText(app)}</span>
      <span className="rel-detail dim">{detail}</span>
      {(app.workers || []).map((w) => (
        <div key={w.service} className="rel-worker">
          <span className="dim">{w.service}</span>
          <span className="mono">{w.version ? `v${w.version}` : "—"}</span>
          <span className="dim">{[w.commit && `commit ${w.commit}`, w.version && app.version && w.version !== app.version && "versão diferente da API"].filter(Boolean).join(" · ")}</span>
        </div>
      ))}
    </div>
  );
}

function VersionsCard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    setBusy(true); setError("");
    api.appVersions().then(setData).catch((e) => setError(e.message || "não deu pra ler as versões")).finally(() => setBusy(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <Card title="Versões no ar" hint="Lidas de cada app agora — é o que está rodando, não o que a main diz."
      action={<SecondaryButton type="button" onClick={load} disabled={busy}>{busy ? "lendo…" : "Atualizar"}</SecondaryButton>}>
      <div className="rel-apps">
        {error && <div role="alert" className="rel-error">{error}</div>}
        {!data && !error && <div className="mono dim" style={{ fontSize: 12 }}>carregando…</div>}
        {data?.apps?.map((a) => <AppRow key={a.id} app={a} />)}
      </div>
    </Card>
  );
}

function Editor({ initial, saas, onClose, onSaved }) {
  const editing = !!initial?.id;
  const [form, setForm] = useState(() => ({
    title: initial?.title || "", body: initial?.body || "", version: initial?.version || "",
    category: initial?.category || "novo", saas: initial?.saas || saas,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const dirty = ["title", "body", "version", "category"].some((k) => form[k] !== (initial?.[k] || (k === "category" ? "novo" : "")));

  const save = async (status) => {
    if (pending.current || !form.title.trim()) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const payload = { ...form, status: status || initial?.status || "draft" };
      const saved = editing ? await api.productUpdateUpdate(initial.id, payload) : await api.productUpdateCreate(payload);
      toast(payload.status === "published" ? "Novidade publicada" : "Rascunho salvo", "pos");
      onSaved(saved);
    } catch (err) { setError(err.message || "Não deu pra salvar."); }
    finally { pending.current = false; setBusy(false); }
  };
  const close = () => { if (pending.current) return; if (dirty && !window.confirm("Descartar as alterações desta novidade?")) return; onClose(); };
  const published = initial?.status === "published";
  const label = (text, child) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}><span className="kicker">{text}</span>{child}</label>
  );
  const panel = (
    <Modal onClose={close} fechavel={!busy} label="Novidade" largura={640}>
      <div className="rel-editor">
        <h2 className="card-title" style={{ margin: 0 }}>{editing ? "Editar novidade" : "Nova novidade"}</h2>
        <div className="card-sub">Em linguagem de cliente: o que mudou e o que dá pra fazer agora. Parágrafos separados por linha em branco.</div>
        {label("Título", <input className="inp" autoFocus={!editing} value={form.title} maxLength={160} disabled={busy}
          onChange={(e) => set({ title: e.target.value })} placeholder="Ex.: Cópia para a Amazon" />)}
        <div className="rel-editor-grid">
          {label("Produto", <SelectPopover value={form.saas} options={PRODUCTS} onChange={(v) => set({ saas: v })} disabled={busy || editing} label="Produto" />)}
          {label("Categoria", <SelectPopover value={form.category} options={CATEGORIES} onChange={(v) => set({ category: v })} disabled={busy} label="Categoria" />)}
          {label("Versão", <input className="inp mono" value={form.version} maxLength={32} disabled={busy} onChange={(e) => set({ version: e.target.value })} placeholder="2.59.0" />)}
        </div>
        {label("Texto", <textarea className="inp" rows={7} value={form.body} maxLength={8000} disabled={busy}
          onChange={(e) => set({ body: e.target.value })} onKeyDown={(e) => e.stopPropagation()}
          style={{ height: "auto", padding: "10px 12px", resize: "vertical", font: "inherit", fontSize: 13, lineHeight: 1.55 }} />)}
        {error && <div role="alert" className="rel-error">{error}</div>}
        <div className="rel-editor-footer">
          {published && <button type="button" disabled={busy} onClick={() => save("draft")} className="rel-link">Voltar a rascunho</button>}
          <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8 }}>
            <SecondaryButton type="button" onClick={close} disabled={busy}>Cancelar</SecondaryButton>
            {!published && <SecondaryButton type="button" onClick={() => save("draft")} disabled={busy || !form.title.trim()}>Salvar rascunho</SecondaryButton>}
            <PrimaryButton type="button" onClick={() => save("published")} disabled={busy || !form.title.trim()}>{busy ? "Salvando…" : published ? "Salvar" : "Publicar"}</PrimaryButton>
          </span>
        </div>
      </div>
    </Modal>
  );
  return typeof document !== "undefined" && document.body?.nodeType === 1 ? createPortal(panel, document.body) : panel;
}

function UpdatesCard() {
  const [saas, setSaas] = useState("leverads");
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const load = useCallback(() => {
    setError("");
    api.productUpdates(saas).then(setItems).catch((e) => setError(e.message || "não deu pra carregar"));
  }, [saas]);
  useEffect(() => { setItems(null); load(); }, [load]);
  const remove = async (u) => {
    if (!window.confirm(`Apagar a novidade "${u.title}"?${u.status === "published" ? " Ela some da página dos clientes." : ""}`)) return;
    try { await api.productUpdateDelete(u.id); toast("Novidade apagada", "pos"); load(); }
    catch (err) { toast(`Não deu pra apagar · ${err.message}`, "neg"); }
  };
  return (
    <Card title="Novidades" hint="O que os clientes veem na página de novidades do produto. Rascunho não sai."
      action={<span style={{ display: "inline-flex", gap: 8 }}>
        <SelectPopover value={saas} options={PRODUCTS} onChange={setSaas} label="Produto" size="sm" width={150} />
        <PrimaryButton type="button" onClick={() => setEditing({})}>Nova novidade</PrimaryButton>
      </span>}>
      <div className="rel-updates">
        {error && <div role="alert" className="rel-error">{error} <button type="button" onClick={load}>Tentar novamente</button></div>}
        {!items && !error && <div className="mono dim" style={{ fontSize: 12 }}>carregando…</div>}
        {items?.length === 0 && (
          <EmptyState title="Nenhuma novidade ainda" hint="Escreva o que mudou em linguagem de cliente e publique: aparece na página de novidades do produto."
            action={<PrimaryButton onClick={() => setEditing({})}>+ Escrever a primeira</PrimaryButton>} />
        )}
        {items?.map((u) => (
          <div key={u.id} role="button" tabIndex={0} className="rel-update" onClick={() => setEditing(u)}
            onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setEditing(u); } }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="rel-update-head">
                <strong>{u.title}</strong>
                {u.version && <span className="mono dim">v{u.version}</span>}
                <span className="dim">{catLabel(u.category)}</span>
              </div>
              <div className="dim rel-update-body">{String(u.body || "").replace(/\s+/g, " ").slice(0, 180)}</div>
            </div>
            <span className="rel-status" style={{ "--dot": u.status === "published" ? "var(--pos)" : "var(--fg-4)" }}>
              {u.status === "published" ? `publicada ${when(u.publishedAt)}` : "rascunho"}
            </span>
            <MoreMenu items={[{ label: "Editar", onClick: () => setEditing(u) }, { label: "Apagar", tone: "neg", onClick: () => remove(u) }]} />
          </div>
        ))}
      </div>
      {editing && (
        <Editor key={editing.id || "nova"} initial={editing.id ? editing : null} saas={saas}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </Card>
  );
}

export function ReleasesScreen() {
  return (
    <div className="releases-page">
      <PageHead title="Versões e novidades" sub="O que está no ar em cada app e o que os clientes leem sobre o que mudou." />
      <div className="releases-grid">
        <VersionsCard />
        <UpdatesCard />
      </div>
    </div>
  );
}
