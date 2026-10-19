import React from "react";
import { createPortal } from "react-dom";
import "./releases.css";
import { api, assetUrl } from "../lib/api.js";
import { EmptyState, MoreMenu, PrimaryButton, SecondaryButton, toast } from "../atoms.jsx";
import { Card, PageHead } from "../components/viz.jsx";
import { Modal } from "../components/overlay.jsx";
import { SelectPopover } from "../components/select-popover.jsx";

// Versões e novidades (só admin): a versão NO AR de cada app da Lever, lida de
// cada um na hora (api/src/releases/app-versions.js), e as novidades de produto
// que cada app mostra aos clientes. No LeverAds elas abrem pelo indicador de
// versão da sidebar (página /updates), lidas de /public/updates/leverads.
//
// Dois formatos (regras em api/src/releases/product-updates.js):
//   · feature (Novo, Melhoria): resumo + passo a passo + prints; só publica
//     completa;
//   · correção: nota curta, sem print — só bug que atingia todo mundo.
// Nunca dado de cliente (nome, e-mail, telefone, CNPJ, id de anúncio): a API
// recusa o que dá pra detectar; nome é com a revisão.

const { useState, useEffect, useRef, useCallback } = React;

const PRODUCTS = [{ value: "leverads", label: "LeverAds" }, { value: "leverprice", label: "LeverPrice" }];
const CATEGORIES = [
  { value: "novo", label: "Novo", hint: "feature" },
  { value: "melhoria", label: "Melhoria", hint: "feature" },
  { value: "correcao", label: "Correção", hint: "nota curta" },
];
const isFeature = (c) => c === "novo" || c === "melhoria";
const catLabel = (v) => CATEGORIES.find((c) => c.value === v)?.label || v;
const when = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const MAX_IMAGES = 4;

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

// Prévia no formato da página do cliente (frontend/src/pages/UpdatesPage.tsx
// do LeverAds): o que se vê aqui é o que ele vai ver.
function UpdatePreview({ form }) {
  const steps = String(form.steps || "").split("\n").map((s) => s.trim()).filter(Boolean);
  if (!isFeature(form.category)) {
    return (
      <div className="rel-preview rel-preview-fix">
        <span className="rel-chip" data-category="correcao">Correção</span>
        <strong>{form.title || "Título da correção"}</strong>
        {form.body && <span className="dim"> — {form.body}</span>}
      </div>
    );
  }
  const [cover, ...rest] = form.images;
  return (
    <article className="rel-preview">
      <div className="rel-preview-meta"><span className="rel-chip" data-category={form.category}>{catLabel(form.category)}</span>{form.version && <span className="mono dim">v{form.version.replace(/^v/i, "")}</span>}</div>
      <h3>{form.title || "Título da novidade"}</h3>
      {form.body && <p>{form.body}</p>}
      {cover ? <figure><img src={assetUrl(cover.url)} alt={cover.caption || ""} />{cover.caption && <figcaption>{cover.caption}</figcaption>}</figure>
        : <div className="rel-preview-noimg">sem print — a feature só publica com ao menos um</div>}
      {rest.length > 0 && <div className="rel-preview-thumbs">{rest.map((im) => <img key={im.url} src={assetUrl(im.url)} alt={im.caption || ""} />)}</div>}
      {steps.length > 0 && <><div className="kicker">Como usar</div><ol>{steps.map((s, i) => <li key={i}>{s.replace(/^\s*(\d+[.)]|[-•])\s*/, "")}</li>)}</ol></>}
      {form.linkPath && <span className="rel-preview-cta">{form.linkLabel || "Ver agora"} →</span>}
    </article>
  );
}

function ImagesField({ images, onChange, disabled }) {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const add = async (files) => {
    const list = [...(files || [])].filter((f) => /^image\//.test(f.type)).slice(0, MAX_IMAGES - images.length);
    if (!list.length) return;
    setBusy(true);
    try {
      const up = [];
      for (const f of list) up.push({ url: (await api.productUpdateAsset(f)).url, caption: "" });
      onChange([...images, ...up]);
    } catch (err) { toast(`Não deu pra subir o print · ${err.message}`, "neg"); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ""; }
  };
  const set = (i, patch) => onChange(images.map((im, j) => (j === i ? { ...im, ...patch } : im)));
  const move = (i, d) => { const next = [...images]; [next[i], next[i + d]] = [next[i + d], next[i]]; onChange(next); };
  return (
    <div className="rel-images" onPaste={(e) => { if (!disabled) add(e.clipboardData?.files); }}
      onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (!disabled) add(e.dataTransfer?.files); }}>
      {images.map((im, i) => (
        <div key={im.url} className="rel-image">
          <img src={assetUrl(im.url)} alt="" />
          <input className="inp" value={im.caption} maxLength={140} disabled={disabled} placeholder={i === 0 ? "Legenda (o 1º print é a capa)" : "Legenda"}
            onChange={(e) => set(i, { caption: e.target.value })} aria-label={`Legenda do print ${i + 1}`} />
          <div className="rel-image-actions">
            <button type="button" disabled={disabled || i === 0} onClick={() => move(i, -1)} aria-label="Subir">↑</button>
            <button type="button" disabled={disabled || i === images.length - 1} onClick={() => move(i, 1)} aria-label="Descer">↓</button>
            <button type="button" disabled={disabled} onClick={() => onChange(images.filter((_, j) => j !== i))} aria-label="Tirar print" className="rel-neg">✕</button>
          </div>
        </div>
      ))}
      {images.length < MAX_IMAGES && (
        <button type="button" className="rel-drop" disabled={disabled || busy} onClick={() => inputRef.current?.click()}>
          {busy ? "subindo…" : "Adicionar print — clique, arraste ou cole (Ctrl+V)"}
        </button>
      )}
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={(e) => add(e.target.files)} />
      <div className="dim rel-hint">Confira antes: nenhum nome, e-mail, loja ou anúncio de cliente aparece no print.</div>
    </div>
  );
}

function Editor({ initial, saas, onClose, onSaved }) {
  const editing = !!initial?.id;
  const [form, setForm] = useState(() => ({
    title: initial?.title || "", body: initial?.body || "", version: initial?.version || "",
    category: initial?.category || "novo", saas: initial?.saas || saas,
    steps: (initial?.steps || []).join("\n"), images: initial?.images || [],
    linkPath: initial?.linkPath || "", linkLabel: initial?.linkLabel || "",
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const dirty = JSON.stringify(form) !== JSON.stringify({
    title: initial?.title || "", body: initial?.body || "", version: initial?.version || "",
    category: initial?.category || "novo", saas: initial?.saas || saas,
    steps: (initial?.steps || []).join("\n"), images: initial?.images || [],
    linkPath: initial?.linkPath || "", linkLabel: initial?.linkLabel || "",
  });
  const feature = isFeature(form.category);

  const save = async (status) => {
    if (pending.current || !form.title.trim()) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const payload = {
        ...form, status: status || initial?.status || "draft",
        steps: feature ? form.steps : "", images: feature ? form.images : [],
        linkPath: feature ? form.linkPath : "", linkLabel: feature ? form.linkLabel : "",
      };
      const saved = editing ? await api.productUpdateUpdate(initial.id, payload) : await api.productUpdateCreate(payload);
      toast(payload.status === "published" ? "Novidade publicada" : "Rascunho salvo", "pos");
      onSaved(saved);
    } catch (err) { setError(err.message || "Não deu pra salvar."); }
    finally { pending.current = false; setBusy(false); }
  };
  const close = () => { if (pending.current) return; if (dirty && !window.confirm("Descartar as alterações desta novidade?")) return; onClose(); };
  const published = initial?.status === "published";
  const label = (text, child, hint) => (
    <label className="rel-field"><span className="kicker">{text}</span>{child}{hint && <span className="dim rel-hint">{hint}</span>}</label>
  );
  const panel = (
    <Modal onClose={close} fechavel={!busy} label="Novidade" largura={980}>
      <div className="rel-editor">
        <div className="rel-editor-form">
          <h2 className="card-title" style={{ margin: 0 }}>{editing ? "Editar novidade" : "Nova novidade"}</h2>
          <div className="card-sub">Em linguagem de cliente: o benefício primeiro, sem termo técnico e sem dado de cliente.</div>
          <div className="rel-editor-grid">
            {label("Produto", <SelectPopover value={form.saas} options={PRODUCTS} onChange={(v) => set({ saas: v })} disabled={busy || editing} label="Produto" />)}
            {label("Tipo", <SelectPopover value={form.category} options={CATEGORIES} onChange={(v) => set({ category: v })} disabled={busy} label="Tipo" />)}
            {label("Versão", <input className="inp mono" value={form.version} maxLength={32} disabled={busy} onChange={(e) => set({ version: e.target.value })} placeholder="2.59.0" />)}
          </div>
          {label("Título", <input className="inp" autoFocus={!editing} value={form.title} maxLength={120} disabled={busy}
            onChange={(e) => set({ title: e.target.value })} placeholder={feature ? "Ex.: Copie seus anúncios para a Amazon" : "Ex.: Fotos da aba Editar voltaram a carregar"} />)}
          {label(feature ? "Resumo" : "Nota", <textarea className="inp" rows={feature ? 3 : 2} value={form.body} maxLength={feature ? 1200 : 280} disabled={busy}
            onChange={(e) => set({ body: e.target.value })} onKeyDown={(e) => e.stopPropagation()}
            placeholder={feature ? "O que mudou e por que é bom pra quem usa, em 1 ou 2 frases." : "Uma frase: o que estava errado e que agora funciona."}
            style={{ height: "auto", padding: "10px 12px", resize: "vertical", font: "inherit", fontSize: 13, lineHeight: 1.55 }} />,
            feature ? null : `${form.body.length}/280 · correção só quando o bug atingia todo mundo`)}
          {feature && <>
            {label("Como usar", <textarea className="inp" rows={4} value={form.steps} disabled={busy}
              onChange={(e) => set({ steps: e.target.value })} onKeyDown={(e) => e.stopPropagation()}
              placeholder={"Um passo por linha, com o nome que aparece na tela:\nAbra Copiar\nEscolha a conta da Amazon como destino"}
              style={{ height: "auto", padding: "10px 12px", resize: "vertical", font: "inherit", fontSize: 13, lineHeight: 1.55 }} />)}
            {label("Prints", <ImagesField images={form.images} onChange={(images) => set({ images })} disabled={busy} />)}
            <div className="rel-editor-grid rel-editor-grid-2">
              {label("Atalho (tela do app)", <input className="inp mono" value={form.linkPath} maxLength={80} disabled={busy}
                onChange={(e) => set({ linkPath: e.target.value.trim() })} placeholder="/copy" />, "caminho do LeverAds, ex.: /rules")}
              {label("Texto do botão", <input className="inp" value={form.linkLabel} maxLength={40} disabled={busy}
                onChange={(e) => set({ linkLabel: e.target.value })} placeholder="Abrir Copiar" />)}
            </div>
          </>}
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
        <aside className="rel-editor-preview">
          <span className="kicker">Como o cliente vê</span>
          <UpdatePreview form={form} />
        </aside>
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
          <EmptyState title="Nenhuma novidade ainda" hint="Feature vai com resumo, passo a passo e print; correção é uma nota curta. A skill `novidades` do repo LeverAds monta os rascunhos a partir do changelog."
            action={<PrimaryButton onClick={() => setEditing({})}>+ Escrever a primeira</PrimaryButton>} />
        )}
        {items?.map((u) => (
          <div key={u.id} role="button" tabIndex={0} className="rel-update" onClick={() => setEditing(u)}
            onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setEditing(u); } }}>
            {isFeature(u.category) && (u.images?.[0] ? <img className="rel-update-thumb" src={assetUrl(u.images[0].url)} alt="" /> : <span className="rel-update-thumb" aria-hidden="true" />)}
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
