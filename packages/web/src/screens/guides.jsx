// Guias (CS e suporte, 03/11/2026): a base de conhecimento interna. Cada guia é
// um passo a passo com texto, dica e os prints das telas, para o operador de
// integração, o CS e o suporte seguirem sem depender de quem já sabe.
//
// · Guias: a lista do produto (rascunhos só para quem edita), o leitor
//   (components/guide-viewer.jsx) e o editor (colar print com Ctrl+V).
// · Modelos de checklist: os itens do checklist da integração por tipo, cada
//   um apontando para o passo do guia que ensina a fazer. A integração nova
//   leva o vínculo e o card dela mostra "como fazer →".
//
// Ler: quem tem a tela. Editar: etiqueta admin ou Editor de guias (o servidor
// confere de novo, guides/guides.js).

import React from "react";
import "./guides.css";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { useActiveSaas } from "../lib/workspace.js";
import { displayName } from "../lib/users.js";
import { toast } from "../atoms.jsx";
import { Modal } from "../components/overlay.jsx";
import { Segmented } from "../components/viz.jsx";
import { BarraFiltros } from "../components/story.jsx";
import { SelectPopover } from "../components/select-popover.jsx";
import { AUDIENCE_LABEL, GuideImage, GuideViewer, PRODUCT_LABEL } from "../components/guide-viewer.jsx";

const { useState, useEffect, useMemo, useRef } = React;
const DAY = 86_400_000;

const AUDIENCE_OPTS = Object.entries(AUDIENCE_LABEL).map(([value, label]) => ({ value, label }));
// Trilhas de leitura: os comuns primeiro, depois cada sistema. Dentro da trilha,
// a posição gravada no guia (`order`; o pacote da Lever numera na ordem da call).
const TRACKS = [
  { product: "", title: "Para todos os sistemas", sub: "comece pela call de integração e pelo cadastro" },
  { product: "leverads", title: "LeverAds", sub: "na ordem da call, depois o resto do menu" },
  { product: "leverprice", title: "LeverPrice", sub: "na ordem da call, depois o resto do menu" },
];
const TRACK_OPTS = [{ value: "", label: "Todos os sistemas" }, ...TRACKS.filter((t) => t.product).map((t) => ({ value: t.product, label: t.title }))];
const byOrder = (a, b) => ((Number(a.order) || 1000) - (Number(b.order) || 1000)) || String(a.title).localeCompare(String(b.title), "pt-BR");
// O título sem o "LeverAds · " da frente: dentro da trilha o sistema já está no cabeçalho.
const shortTitle = (g) => {
  const pre = `${PRODUCT_LABEL[g.product] || ""} · `;
  return g.product && g.title.startsWith(pre) ? g.title.slice(pre.length) : g.title;
};
const PRODUCT_OPTS = [{ value: "", label: "Qualquer produto" }, ...Object.entries(PRODUCT_LABEL).map(([value, label]) => ({ value, label }))];
const ago = (iso) => {
  const d = Math.floor((Date.now() - Date.parse(iso || "")) / DAY);
  return !Number.isFinite(d) ? "" : d <= 0 ? "hoje" : d === 1 ? "ontem" : `há ${d} dias`;
};
const newStep = () => ({ id: "", title: "", body: "", tip: "", images: [] });

// ── Editor ──────────────────────────────────────────────────────────────────
function StepEditor({ step, index, total, saas, onChange, onMove, onRemove }) {
  const [uploading, setUploading] = useState(0);
  const fileRef = useRef(null);
  const set = (patch) => onChange({ ...step, ...patch });
  async function addFiles(files) {
    const imgs = [...files].filter((f) => /^image\//.test(f.type));
    if (!imgs.length) return;
    if ((step.images || []).length + imgs.length > 6) { toast("No máximo 6 prints por passo", "neg"); return; }
    setUploading((n) => n + imgs.length);
    const added = [];
    for (const f of imgs) {
      try { added.push({ id: (await api.guideAsset(saas, f)).id, caption: "" }); }
      catch (e) { toast(`${e.message || "O print não subiu"} · tente de novo`, "neg"); }
      finally { setUploading((n) => n - 1); }
    }
    if (added.length) onChange((cur) => ({ ...cur, images: [...(cur.images || []), ...added] }));
  }
  // Ctrl+V com um print no passo em foco sobe a imagem direto.
  const onPaste = (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.some((f) => /^image\//.test(f.type))) { e.preventDefault(); addFiles(files); }
  };
  return <section className="guide-edit-step" onPaste={onPaste} aria-label={`Passo ${index + 1}`}>
    <div className="guide-edit-step-head">
      <span className="guide-edit-num tnum">{index + 1}</span>
      <input className="inp" value={step.title} onChange={(e) => set({ title: e.target.value })} placeholder="título do passo (ex.: Conectar a conta do Mercado Livre)" aria-label={`Título do passo ${index + 1}`} />
      <button type="button" className="guide-icon-btn" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Subir passo" title="subir">↑</button>
      <button type="button" className="guide-icon-btn" onClick={() => onMove(1)} disabled={index === total - 1} aria-label="Descer passo" title="descer">↓</button>
      <button type="button" className="guide-icon-btn" onClick={onRemove} aria-label={`Tirar o passo ${index + 1}`} title="tirar o passo">✕</button>
    </div>
    <textarea className="inp guide-edit-body" rows={5} value={step.body} onChange={(e) => set({ body: e.target.value })} aria-label={`Texto do passo ${index + 1}`}
      placeholder={"O que fazer, tela por tela. Aceita **negrito**, listas com - e falas com > no começo da linha."} />
    <input className="inp" value={step.tip} onChange={(e) => set({ tip: e.target.value })} placeholder="dica (opcional): o erro comum, o atalho, o que conferir" aria-label={`Dica do passo ${index + 1}`} />
    <div className="guide-edit-images">
      {(step.images || []).map((im, j) => <div key={im.id} className="guide-edit-image">
        <GuideImage id={im.id} />
        <input className="inp" value={im.caption} onChange={(e) => set({ images: step.images.map((x, k) => (k === j ? { ...x, caption: e.target.value } : x)) })} placeholder="legenda" aria-label="Legenda do print" />
        <button type="button" className="guide-link-btn" onClick={() => set({ images: step.images.filter((_, k) => k !== j) })}>tirar print</button>
      </div>)}
      <button type="button" className="guide-edit-add-image" onClick={() => fileRef.current?.click()} disabled={uploading > 0}>
        {uploading > 0 ? "subindo o print…" : "+ print"}<small>ou cole com Ctrl+V aqui no passo</small>
      </button>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={(e) => { addFiles(e.target.files || []); e.target.value = ""; }} />
    </div>
  </section>;
}

function GuideEditor({ saas, guide, onClose, onSaved, onDeleted }) {
  const start = useMemo(() => guide ? JSON.parse(JSON.stringify({ order: 0, ...guide })) : { title: "", summary: "", audience: "integrador", product: "", order: 0, status: "rascunho", steps: [newStep()] }, [guide]);
  const [draft, setDraft] = useState(start);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(start);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const setStep = (i, next) => setDraft((d) => ({ ...d, steps: d.steps.map((s, j) => (j === i ? (typeof next === "function" ? next(s) : next) : s)) }));
  const move = (i, dir) => setDraft((d) => {
    const steps = [...d.steps];
    [steps[i], steps[i + dir]] = [steps[i + dir], steps[i]];
    return { ...d, steps };
  });
  const close = () => { if (busy) return; if (dirty && !window.confirm("Descartar as mudanças neste guia?")) return; onClose(); };
  async function save(status) {
    if (busy) return;
    setBusy("save"); setError("");
    const body = { title: draft.title, summary: draft.summary, audience: draft.audience, product: draft.product, order: Number(draft.order) || 0, status: status || draft.status, steps: draft.steps };
    try {
      const saved = guide ? await api.updateGuide(guide.id, { ...body, rev: guide.rev }) : await api.createGuide({ ...body, saas });
      toast(saved.status === "publicado" ? "Guia publicado" : "Rascunho salvo", "pos");
      onSaved(saved);
    } catch (e) { setError(e.message || "Não foi possível salvar o guia."); }
    finally { setBusy(""); }
  }
  async function remove() {
    if (busy || !guide) return;
    if (!window.confirm(`Apagar o guia "${guide.title}"? Os prints dele também saem, e os itens de checklist que apontam para ele ficam sem guia.`)) return;
    setBusy("delete"); setError("");
    try { await api.deleteGuide(guide.id); toast("Guia apagado", "pos"); onDeleted(guide.id); }
    catch (e) { setError(e.message || "Não foi possível apagar."); setBusy(""); }
  }
  return <Modal onClose={close} fechavel={!busy} label={guide ? `Editar guia · ${guide.title}` : "Novo guia"} largura={920} padding={16}
    painelStyle={{ display: "flex", flexDirection: "column", overflow: "hidden", height: "min(900px, calc(100dvh - 32px))" }}>
    <header className="guide-viewer-head">
      <div><h2>{guide ? "Editar guia" : "Novo guia"}</h2><p>{draft.status === "publicado" ? "publicado: quem tem a tela já vê" : "rascunho: só quem edita vê"}</p></div>
      <button type="button" className="guide-close" aria-label="Fechar editor" onClick={close} disabled={!!busy}>✕</button>
    </header>
    <div className="guide-edit-body-wrap">
      <div className="guide-edit-meta">
        <label className="guide-field guide-field-wide"><span className="kicker">título</span>
          <input className="inp" value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder="ex.: Implantação · call de integração" /></label>
        <div className="guide-field"><span className="kicker">para quem</span>
          <SelectPopover size="sm" label="Para quem" value={draft.audience} options={AUDIENCE_OPTS} onChange={(v) => set({ audience: v })} /></div>
        <div className="guide-field"><span className="kicker">sistema</span>
          <SelectPopover size="sm" label="Sistema" value={draft.product} options={PRODUCT_OPTS} onChange={(v) => set({ product: v })} /></div>
        <label className="guide-field"><span className="kicker">posição na trilha</span>
          <input className="inp tnum" type="number" min={0} max={999} value={draft.order || ""} onChange={(e) => set({ order: Number(e.target.value) || 0 })} placeholder="ex.: 3 (vazio = no fim)" /></label>
        <label className="guide-field guide-field-wide"><span className="kicker">resumo</span>
          <textarea className="inp" rows={2} value={draft.summary} onChange={(e) => set({ summary: e.target.value })} placeholder="quando usar este guia e o que sai pronto no fim" /></label>
      </div>
      {draft.steps.map((st, i) => <StepEditor key={st.id || `novo-${i}`} step={st} index={i} total={draft.steps.length} saas={saas}
        onChange={(next) => setStep(i, next)} onMove={(dir) => move(i, dir)}
        onRemove={() => { if ((st.body || st.images?.length) && !window.confirm(`Tirar o passo "${st.title || i + 1}"?`)) return; setDraft((d) => ({ ...d, steps: d.steps.filter((_, j) => j !== i) })); }} />)}
      <button type="button" className="guide-edit-add-step" onClick={() => setDraft((d) => ({ ...d, steps: [...d.steps, newStep()] }))} disabled={draft.steps.length >= 40}>+ passo</button>
    </div>
    <footer className="guide-edit-foot">
      {error && <p role="alert">{error}</p>}
      {guide && <button type="button" className="guide-link-btn guide-danger" onClick={remove} disabled={!!busy}>{busy === "delete" ? "apagando…" : "apagar guia"}</button>}
      <span style={{ flex: 1 }} />
      <button type="button" className="guide-btn" onClick={close} disabled={!!busy}>Cancelar</button>
      {draft.status === "publicado"
        ? <button type="button" className="guide-btn" onClick={() => save("rascunho")} disabled={!!busy}>Voltar a rascunho</button>
        : <button type="button" className="guide-btn" onClick={() => save("rascunho")} disabled={!!busy}>{busy ? "salvando…" : "Salvar rascunho"}</button>}
      <button type="button" className="guide-btn guide-btn-primary" onClick={() => save("publicado")} disabled={!!busy}>{busy === "save" ? "salvando…" : draft.status === "publicado" ? "Salvar" : "Publicar"}</button>
    </footer>
  </Modal>;
}

// ── Modelos de checklist ────────────────────────────────────────────────────
const KIND_LABEL = { implantacao: "Implantação inicial", novo_produto: "Produto novo", reintegracao: "Reintegração", migracao: "Migração", treinamento: "Treinamento" };

function TemplatesTab({ saas, guides }) {
  const [templates, setTemplates] = useState(null);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const [sel, setSel] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setError("");
    api.onboardingTemplates(saas).then((r) => {
      if (!alive) return;
      setTemplates(r.templates || []); setSaved(JSON.stringify(r.templates || []));
      setSel((cur) => cur || r.templates?.[0]?.id || "");
    }).catch((e) => alive && setError(e.message || "não carregou os modelos"));
    return () => { alive = false; };
  }, [saas, attempt]);
  if (!templates) return <div className="guides-load" role={error ? "alert" : "status"}>{error || "carregando os modelos…"}{error && <button onClick={() => setAttempt((n) => n + 1)}>tentar de novo</button>}</div>;
  const dirty = JSON.stringify(templates) !== saved;
  const ti = Math.max(0, templates.findIndex((t) => t.id === sel));
  const t = templates[ti];
  const setItems = (fn) => setTemplates((all) => all.map((x, i) => (i === ti ? { ...x, items: fn(x.items || []) } : x)));
  const guideOpts = [{ value: "", label: "sem guia" }, ...guides.map((g) => ({ value: g.id, label: g.title, hint: g.status === "rascunho" ? "rascunho" : "" }))];
  async function save() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const r = await api.saveOnboardingTemplates(saas, templates);
      setTemplates(r.templates); setSaved(JSON.stringify(r.templates));
      toast("Modelos salvos · valem para as integrações novas", "pos");
    } catch (e) { setError(e.message || "Não foi possível salvar."); }
    finally { setBusy(false); }
  }
  return <section className="guides-card guides-templates">
    <div className="guides-templates-head">
      <div className="guides-templates-pick"><SelectPopover size="sm" label="Modelo" value={t?.id || ""} options={templates.map((x) => ({ value: x.id, label: x.name || KIND_LABEL[x.kind] || x.kind, hint: (x.planCodes || []).length ? "por plano" : "" }))} onChange={setSel} /></div>
      <p>Cada item pode apontar para o passo do guia que ensina a fazer. Vale para as integrações novas; as abertas mantêm o checklist que já têm.</p>
    </div>
    {t && <div className="guides-template-items">
      {(t.items || []).map((it, i) => {
        const g = guides.find((x) => x.id === it.guide?.id);
        const stepOpts = [{ value: "", label: "começo do guia" }, ...(g?.steps || []).map((s, j) => ({ value: s.id, label: `${j + 1}. ${s.title}` }))];
        const patch = (p) => setItems((items) => items.map((x, j) => (j === i ? { ...x, ...p } : x)));
        return <div key={i} className="guides-template-item">
          <span className="guide-edit-num tnum">{i + 1}</span>
          <div className="guides-template-fields">
            <div className="guides-template-row">
              <input className="inp" value={it.title} onChange={(e) => patch({ title: e.target.value })} aria-label={`Item ${i + 1}`} placeholder="o que precisa ser entregue" />
              <div style={{ width: 120 }}><SelectPopover size="sm" label="Quem entrega" value={it.side === "cliente" ? "cliente" : "lever"} options={[{ value: "lever", label: "Lever" }, { value: "cliente", label: "Cliente" }]} onChange={(v) => patch({ side: v })} /></div>
            </div>
            <div className="guides-template-row">
              <div style={{ flex: 1, minWidth: 0 }}><SelectPopover size="sm" label={`Guia do item ${i + 1}`} value={it.guide?.id || ""} options={guideOpts} onChange={(v) => patch({ guide: v ? { id: v, step: "" } : undefined })} /></div>
              {g && <div style={{ flex: 1, minWidth: 0 }}><SelectPopover size="sm" label={`Passo do guia do item ${i + 1}`} value={it.guide?.step || ""} options={stepOpts} onChange={(v) => patch({ guide: { id: g.id, step: v } })} /></div>}
            </div>
            <input className="inp" value={it.help || ""} onChange={(e) => patch({ help: e.target.value })} placeholder="explicação curta que aparece no checklist (opcional)" aria-label={`Explicação do item ${i + 1}`} />
          </div>
          <div className="guides-template-actions">
            <button type="button" className="guide-icon-btn" disabled={i === 0} onClick={() => setItems((items) => { const n = [...items]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })} aria-label="Subir item">↑</button>
            <button type="button" className="guide-icon-btn" disabled={i === t.items.length - 1} onClick={() => setItems((items) => { const n = [...items]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; return n; })} aria-label="Descer item">↓</button>
            <button type="button" className="guide-icon-btn" onClick={() => setItems((items) => items.filter((_, j) => j !== i))} aria-label={`Tirar o item ${i + 1}`}>✕</button>
          </div>
        </div>;
      })}
      <button type="button" className="guide-edit-add-step" onClick={() => setItems((items) => [...items, { title: "", side: "lever" }])}>+ item</button>
    </div>}
    <footer className="guide-edit-foot">
      {error && <p role="alert">{error}</p>}
      <span style={{ flex: 1 }} />
      {dirty && <button type="button" className="guide-btn" disabled={busy} onClick={() => setTemplates(JSON.parse(saved))}>Descartar</button>}
      <button type="button" className="guide-btn guide-btn-primary" disabled={busy || !dirty} onClick={save}>{busy ? "salvando…" : dirty ? "Salvar modelos" : "salvo"}</button>
    </footer>
  </section>;
}

// ── Tela ────────────────────────────────────────────────────────────────────
export function GuidesScreen() {
  const { version } = useData();
  const [product] = useActiveSaas();
  const saas = product?.id || "";
  const [data, setData] = useState({ key: null, guides: [], canEdit: false, loaded: false, error: null });
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState("guias");
  const [audience, setAudience] = useState("todos");
  const [track, setTrack] = useState("");
  const [q, setQ] = useState("");
  const [viewing, setViewing] = useState(null); // { id, step }
  const [editing, setEditing] = useState(null); // guia ou "novo"
  const [starting, setStarting] = useState(false);
  // Pacote de guias da Lever: o que falta instalar ou atualizar (só quem edita).
  const [pack, setPack] = useState([]);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (!saas) return undefined;
    let alive = true;
    setData((d) => (d.key === saas ? { ...d, error: null } : { key: saas, guides: [], canEdit: false, loaded: false, error: null }));
    api.guides(saas)
      .then((r) => alive && setData({ key: saas, guides: r.guides || [], canEdit: !!r.canEdit, loaded: true, error: null }))
      .catch((error) => alive && setData((d) => ({ ...d, key: saas, error })));
    return () => { alive = false; };
  }, [saas, version, attempt]);

  const guides = data.key === saas ? data.guides : [];
  const canEdit = data.canEdit;
  useEffect(() => {
    if (!saas || !canEdit) { setPack([]); return undefined; }
    let alive = true;
    api.guidePack(saas).then((r) => alive && setPack(r.guides || [])).catch(() => alive && setPack([]));
    return () => { alive = false; };
  }, [saas, canEdit, version, attempt]);
  const packPending = pack.filter((p) => p.state === "faltando" || p.state === "desatualizado");
  const packEdited = pack.filter((p) => p.state === "editado");
  async function installPack() {
    if (installing) return;
    setInstalling(true);
    try {
      const r = await api.installGuidePack(saas);
      const n = r.installed.length + r.updated.length;
      toast(`${n} ${n === 1 ? "guia instalado ou atualizado" : "guias instalados ou atualizados"}${r.edited.length ? ` · ${r.edited.length} editado(s) no Cockpit ficaram como estão` : ""}`, "pos");
      setAttempt((a) => a + 1);
    } catch (e) { toast(`${e.message || "Não foi possível instalar os guias"} · tente de novo`, "neg"); }
    finally { setInstalling(false); }
  }
  const term = q.trim().toLowerCase();
  const searched = term ? guides.filter((g) => `${g.title} ${g.summary} ${(g.steps || []).map((s) => `${s.title} ${s.body}`).join(" ")}`.toLowerCase().includes(term)) : guides;
  const shown = audience === "todos" ? searched : audience === "rascunho" ? searched.filter((g) => g.status === "rascunho") : searched.filter((g) => g.audience === audience);
  const filtros = [
    { id: "todos", label: "Todos", n: searched.length },
    ...AUDIENCE_OPTS.map((a) => ({ id: a.value, label: a.label, n: searched.filter((g) => g.audience === a.value).length })),
    ...(canEdit ? [{ id: "rascunho", label: "Rascunhos", n: searched.filter((g) => g.status === "rascunho").length }] : []),
  ];
  // Trilhas visíveis: com um sistema escolhido, os comuns e ele.
  const tracks = TRACKS.filter((t) => !track || !t.product || t.product === track)
    .map((t) => ({ ...t, guides: shown.filter((g) => (g.product || "") === t.product).sort(byOrder) }))
    .filter((t) => t.guides.length);
  // Próximo guia da trilha; depois dos comuns, o 1º do sistema escolhido.
  function nextOf(id) {
    const ti = tracks.findIndex((t) => t.guides.some((g) => g.id === id));
    if (ti < 0) return null;
    const list = tracks[ti].guides, i = list.findIndex((g) => g.id === id);
    if (i < list.length - 1) return list[i + 1];
    return !tracks[ti].product && track ? tracks.find((t) => t.product === track)?.guides[0] || null : null;
  }
  const nextGuide = viewing ? nextOf(viewing.id) : null;
  // O guia da call do pacote substitui o rascunho de implantação.
  const hasStarter = guides.some((g) => g.starter === "implantacao" || g.pack) || pack.length > 0;
  const reload = () => setAttempt((n) => n + 1);
  async function starter() {
    if (starting) return;
    setStarting(true);
    try {
      const r = await api.guideStarter(saas);
      toast(r.created ? `Rascunho criado${r.linked ? ` e ligado a ${r.linked} itens do checklist` : ""} · complete os prints e publique` : "O guia de implantação já existe", "pos");
      reload();
      setViewing({ id: r.guide.id, step: "" });
    } catch (e) { toast(`${e.message || "Não foi possível criar o rascunho"} · tente de novo`, "neg"); }
    finally { setStarting(false); }
  }

  return <div className="guides-page">
    <header className="guides-header">
      <div style={{ minWidth: 0 }}>
        <h1 className="page-title">Guias</h1>
        <div className="page-sub">o passo a passo com os prints das telas: integração, CS e suporte</div>
      </div>
      <div className="guides-header-actions">
        {canEdit && <Segmented value={tab} onChange={setTab} options={[{ value: "guias", label: "Guias" }, { value: "modelos", label: "Modelos de checklist" }]} />}
        {canEdit && tab === "guias" && <button type="button" className="guide-btn guide-btn-primary guides-new" onClick={() => setEditing("novo")}>Novo guia</button>}
      </div>
    </header>

    {data.key !== saas || (!data.loaded && !data.error)
      ? <div className="guides-load" role="status">Carregando os guias…</div>
      : data.error && !data.loaded
        ? <div className="guides-load" role="alert">Não foi possível carregar os guias. <button onClick={reload}>Tentar novamente</button></div>
        : tab === "modelos" && canEdit
          ? <TemplatesTab saas={saas} guides={guides} />
          : <section className="guides-card">
              <div className="guides-filters">
                <Segmented value={track} onChange={setTrack} options={TRACK_OPTS} />
                <BarraFiltros valor={audience} onChange={setAudience} filtros={filtros} />
                <label className="guides-search">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20.4 20.4-4.2-4.2" /></svg>
                  <input aria-label="Buscar nos guias" value={q} onChange={(e) => setQ(e.target.value)} placeholder="buscar nos guias…" />
                </label>
              </div>
              {canEdit && packPending.length > 0 && <div className="guides-starter">
                <div><strong>Guias da Lever: {packPending.length} {packPending.length === 1 ? "para instalar ou atualizar" : "para instalar ou atualizar"}</strong>
                  <span>{packPending.map((p) => p.title).join(" · ")}{packEdited.length ? `. Editados no Cockpit (não serão sobrescritos): ${packEdited.map((p) => p.title).join(" · ")}` : ""}</span></div>
                <button type="button" className="guide-btn guide-btn-primary" onClick={installPack} disabled={installing}>{installing ? "instalando…" : "Instalar"}</button>
              </div>}
              {canEdit && !hasStarter && <div className="guides-starter">
                <div><strong>Comece pelo guia de implantação</strong><span>Um rascunho a partir do roteiro da call e do checklist de implantação, já ligado aos itens do checklist. Depois é completar cada tela e colar os prints.</span></div>
                <button type="button" className="guide-btn guide-btn-primary" onClick={starter} disabled={starting}>{starting ? "criando…" : "Criar rascunho"}</button>
              </div>}
              {tracks.length
                ? <div className="guides-tracks">
                    {tracks.map((t) => <section key={t.product || "comum"} className="guides-track" aria-label={t.title}>
                      <header className="guides-track-head"><h2>{t.title}</h2><span>{t.guides.length} {t.guides.length === 1 ? "guia" : "guias"} · {t.sub}</span></header>
                      <ol>
                        {t.guides.map((g, i) => <li key={g.id}>
                          <button type="button" className={`guides-row${i === 0 ? " is-first" : ""}`} onClick={() => setViewing({ id: g.id, step: "" })}>
                            <span className="guides-row-num tnum" aria-hidden="true">{i + 1}</span>
                            <span className="guides-row-text">
                              <span className="guides-item-top">
                                <strong>{shortTitle(g)}</strong>
                                {i === 0 && <span className="guides-chip guides-chip-start">leia primeiro</span>}
                                {g.status === "rascunho" && <span className="guides-chip">rascunho</span>}
                              </span>
                              {g.summary && <span className="guides-item-summary">{g.summary}</span>}
                            </span>
                            <span className="guides-item-meta guides-row-meta">
                              {[`${(g.steps || []).length} ${(g.steps || []).length === 1 ? "passo" : "passos"}`, g.audience !== "integrador" ? AUDIENCE_LABEL[g.audience] : "",
                                canEdit && g.updatedAt ? `atualizado ${ago(g.updatedAt)}${g.updatedBy && g.updatedBy !== "api" ? ` por ${displayName(g.updatedBy)}` : ""}` : ""].filter(Boolean).join(" · ")}
                            </span>
                          </button>
                        </li>)}
                      </ol>
                    </section>)}
                  </div>
                : <div className="guides-empty">{guides.length ? "nenhum guia com esses filtros" : canEdit ? "nenhum guia ainda: crie o primeiro ou comece pelo rascunho de implantação" : "nenhum guia publicado neste produto ainda"}</div>}
            </section>}

    {viewing && <GuideViewer guideId={viewing.id} stepId={viewing.step} onClose={() => setViewing(null)}
      next={nextGuide ? { title: shortTitle(nextGuide), onOpen: () => setViewing({ id: nextGuide.id, step: "" }) } : null}
      onEdit={canEdit ? (g) => { setViewing(null); setEditing(g); } : undefined} />}
    {editing && <GuideEditor saas={saas} guide={editing === "novo" ? null : editing}
      onClose={() => setEditing(null)}
      onSaved={(g) => { setEditing(null); reload(); setViewing({ id: g.id, step: "" }); }}
      onDeleted={() => { setEditing(null); reload(); }} />}
  </div>;
}

export default GuidesScreen;
