import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { chromeBtnStyleSmall } from "../lib/ui.js";
import { EmptyState, PrimaryButton, RowActions } from "../atoms.jsx";
import { inputStyle, labelStyle, sectionTitle, cardStyle, addBtnStyle, THEME_DEFAULTS, LabeledInput, LabeledTextarea, ThemeEditor } from "../components/theme-inputs.jsx";
// Proposal builder — propostas comerciais por marca, no MESMO modelo do form
// builder: template = lista de SLIDES estruturados + tema + calculadora; cada
// lead ganha uma instância (snapshot) servida em /p/:id com trava magnética.
// Aba Templates (editor + preview ao vivo) e aba Propostas (geradas: views,
// aceite, links). O editor de slides é dirigido por SLIDE_SPECS — cada tipo
// declara seus campos e o form renderiza genericamente.

const { useState, useEffect, useRef, useCallback } = React;

const SLIDE_TYPES = [
  ["hero", "Hero (abertura)"], ["cards", "Cards (diagnóstico)"], ["receipt", "Fatura (custo oculto)"],
  ["steps", "Passos (solução)"], ["compare", "Antes × Depois"], ["bignum", "Número grande (ROI)"],
  ["pricing", "Investimento (preço)"], ["closer", "Bloco do closer"], ["custom", "HTML livre"],
];

// kind: text | textarea | strlist | objlist (com colunas). Caminhos com ponto
// (ex.: before.label) acessam objetos aninhados.
const SLIDE_SPECS = {
  hero: [
    ["tag", "Tag (pill do topo)", "text"],
    ["title", "Título (h1)", "textarea"],
    ["subtitle", "Subtítulo", "textarea"],
    ["meta", "Meta (grid de até 4)", "objlist", [["label", "rótulo"], ["value", "valor"]]],
  ],
  cards: [
    ["eyebrow", "Eyebrow", "text"], ["title", "Título", "textarea"], ["lead", "Texto de apoio", "textarea"],
    ["cards", "Cards", "objlist", [["label", "rótulo"], ["value", "valor"], ["tag", "tag"]]],
    ["highlight.label", "Destaque · rótulo", "text"], ["highlight.title", "Destaque · título", "text"], ["highlight.pill", "Destaque · pill", "text"],
  ],
  receipt: [
    ["eyebrow", "Eyebrow", "text"], ["title", "Título", "textarea"],
    ["body", "Texto à esquerda", "textarea"], ["note", "Nota (mono, embaixo)", "text"],
    ["header", "Cabeçalho do cupom", "text"], ["subheader", "Subcabeçalho", "text"],
    ["rows", "Linhas", "objlist", [["label", "item"], ["value", "valor"]]],
    ["totalLabel", "Rótulo do total", "text"], ["totalValue", "Valor do total", "text"], ["foot", "Rodapé do cupom", "text"],
  ],
  steps: [
    ["eyebrow", "Eyebrow", "text"], ["title", "Título", "textarea"],
    ["steps", "Passos (último ganha destaque)", "objlist", [["tag", "tag"], ["title", "título"], ["text", "texto"]]],
    ["pills", "Pills (✓ features)", "strlist"],
  ],
  compare: [
    ["eyebrow", "Eyebrow", "text"], ["title", "Título", "textarea"],
    ["before.label", "Antes · rótulo", "text"], ["before.num", "Antes · número", "text"], ["before.unit", "Antes · unidade", "text"], ["before.sub", "Antes · subtexto", "text"],
    ["before.points", "Antes · pontos (✕)", "strlist"],
    ["after.label", "Depois · rótulo", "text"], ["after.num", "Depois · número", "text"], ["after.unit", "Depois · unidade", "text"], ["after.sub", "Depois · subtexto", "text"],
    ["after.points", "Depois · pontos (✓)", "strlist"],
  ],
  bignum: [
    ["eyebrow", "Eyebrow", "text"], ["title", "Título", "textarea"],
    ["items", "Passos numerados", "strlist"], ["note", "Nota destacada", "textarea"],
    ["bigLabel", "Rótulo acima do número", "text"], ["bigValue", "Número grande", "text"],
    ["bigLabel2", "Rótulo abaixo do número", "text"], ["bigCaption", "Legenda", "textarea"],
  ],
  pricing: [
    ["eyebrow", "Eyebrow", "text"], ["title", "Título", "textarea"],
    ["planPill", "Pill do card", "text"], ["planTag", "Tag do plano", "text"],
    ["price", "Preço (vazio = {{calc.preco}})", "text"], ["per", "Sufixo (/ mês)", "text"],
    ["sub", "Subtexto do preço", "text"], ["cycles", "Linha de ciclos (vazio = {{calc.precoCiclos}})", "text"],
    ["features", "Lista de features (✓)", "strlist"],
    ["guaranteeHead", "Garantia · cabeçalho", "text"], ["guaranteeTitle", "Garantia · título", "text"], ["guaranteeText", "Garantia · texto", "textarea"],
    ["paybackLabel", "Payback · rótulo", "text"], ["paybackNum", "Payback · número", "text"], ["paybackCaption", "Payback · legenda", "text"],
    ["closeLine", "Frase de fechamento", "textarea"], ["acceptLabel", "Botão de aceite (vazio = sem botão)", "text"],
  ],
  closer: [
    ["label", "Rótulo", "text"], ["name", "Nome do closer", "text"], ["photo", "Foto (URL)", "text"],
    ["ctaLabel", "Texto do CTA", "text"], ["ctaUrl", "URL do CTA (wa.me/…)", "text"],
  ],
  custom: [["html", "HTML do slide (interpolações {{...}} funcionam)", "textarea"]],
};

const CALC_FIELDS = [
  ["salaryMonthly", "Salário/mês (R$)"], ["workHours", "Horas/mês"], ["minCopy", "Min cópia/anúncio"],
  ["minCompatEdit", "Min compat/edição"], ["reworkPct", "Retrabalho (0–1)"], ["netMargin", "Margem líquida (0–1)"],
  ["revenueUpliftPct", "Uplift receita (%)"], ["maxSeats", "Máx. contas"], ["validDays", "Validade (dias)"],
];

const getPath = (obj, path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
const setPath = (obj, path, val) => {
  const parts = path.split(".");
  const out = { ...obj };
  let cur = out;
  for (let i = 0; i < parts.length - 1; i++) { cur[parts[i]] = { ...(cur[parts[i]] || {}) }; cur = cur[parts[i]]; }
  cur[parts[parts.length - 1]] = val;
  return out;
};

const publicBase = () => import.meta.env.VITE_API_BASE || window.location.origin;

function ProposalsScreen({ saasId }) {
  const { SAAS } = window.SEED;
  const { version, openDelete } = useData();
  const [active, setActive] = useState(saasId || SAAS[0]?.id);
  const [tab, setTab] = useState("templates"); // templates | geradas
  const [templates, setTemplates] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [editing, setEditing] = useState(null); // { template } | null
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    if (!active) return;
    const [ts, ps] = await Promise.all([
      api.list("proposal_templates", { saas: active }),
      api.list("proposals", { saas: active }),
    ]);
    ps.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    setTemplates(ts); setProposals(ps);
  }, [active]);
  useEffect(() => { load(); }, [load, version]);

  function flash(msg) { setToast(msg); setTimeout(() => setToast(null), 1800); }
  async function copy(text, msg) {
    try { await navigator.clipboard.writeText(text); flash(msg); }
    catch { window.prompt("Copie:", text); }
  }
  async function togglePublish(t) {
    await api.update("proposal_templates", t.id, { status: t.status === "published" ? "draft" : "published" });
    await load();
  }

  if (!SAAS.length) return <EmptyState title="Nenhum SaaS ainda" hint="Crie um produto em Ajustes — templates de proposta pertencem a um SaaS." />;

  if (editing) return (
    <TemplateEditor
      template={editing.template} saasId={active}
      onDone={async () => { setEditing(null); await load(); }}
      onCancel={() => setEditing(null)}
    />
  );

  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ padding: "12px 24px", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {SAAS.map((x) => (
            <button key={x.id} onClick={() => setActive(x.id)} style={{
              height: 26, padding: "0 10px", borderRadius: "var(--r-2)",
              border: "1px solid " + (active === x.id ? "var(--line-strong)" : "var(--line-1)"),
              background: active === x.id ? "var(--bg-3)" : "var(--bg-2)",
              color: active === x.id ? "var(--fg-1)" : "var(--fg-3)",
              fontSize: 12, fontFamily: "var(--mono)",
            }}>{x.name}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {[["templates", "Templates"], ["geradas", `Geradas (${proposals.length})`]].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={{
              height: 26, padding: "0 10px", borderRadius: "var(--r-2)",
              border: "1px solid " + (tab === k ? "var(--line-strong)" : "var(--line-1)"),
              background: tab === k ? "var(--bg-3)" : "var(--bg-2)",
              color: tab === k ? "var(--fg-1)" : "var(--fg-3)", fontSize: 12,
            }}>{l}</button>
          ))}
          <PrimaryButton onClick={() => setEditing({ template: null })}>+ novo template</PrimaryButton>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
        {tab === "templates" && (!templates.length ? (
          <EmptyState
            title="Nenhum template neste SaaS"
            hint="O template define os slides, o tema da marca e a calculadora. Cada lead ganha uma proposta própria em /p/:id, com trava magnética entre os slides."
            action={<PrimaryButton onClick={() => setEditing({ template: null })}>+ Criar template</PrimaryButton>}
          />
        ) : (
          <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", overflow: "hidden", background: "var(--bg-1)" }}>
            <div className="mono" style={{ display: "grid", gridTemplateColumns: "1fr 110px 90px 290px", padding: "10px 14px", background: "var(--bg-inset)", fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase", borderBottom: "1px solid var(--line-1)" }}>
              <span>Template</span><span>Status</span><span>Slides</span><span style={{ textAlign: "right" }}>Ações</span>
            </div>
            {templates.map((t) => {
              const pub = t.status === "published";
              return (
                <div key={t.id} style={{ display: "grid", gridTemplateColumns: "1fr 110px 90px 290px", padding: "10px 14px", borderBottom: "1px solid var(--line-1)", alignItems: "center", fontSize: 13 }}>
                  <span style={{ fontWeight: 500 }}>{t.name || t.id}</span>
                  <span><span className={"chip " + (pub ? "pos" : "")} style={{ height: 20 }}>{pub ? "publicado" : "rascunho"}</span></span>
                  <span className="mono tnum dim">{(t.slides || []).length}</span>
                  <span style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end" }}>
                    <a href={`${publicBase()}/p/t/${t.id}`} target="_blank" rel="noreferrer" style={{ ...chromeBtnStyleSmall, textDecoration: "none" }}><span style={{ fontSize: 11 }}>preview ↗</span></a>
                    <button onClick={() => togglePublish(t)} style={chromeBtnStyleSmall}><span style={{ fontSize: 11 }}>{pub ? "despublicar" : "publicar"}</span></button>
                    <RowActions onEdit={() => setEditing({ template: t })} onDelete={() => openDelete("proposal_templates", t)} />
                  </span>
                </div>
              );
            })}
          </div>
        ))}

        {tab === "geradas" && (!proposals.length ? (
          <EmptyState title="Nenhuma proposta gerada" hint="Propostas nascem do pipeline: lead novo (ou botão gerar proposta) cria uma instância do template publicado deste SaaS." />
        ) : (
          <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", overflow: "hidden", background: "var(--bg-1)" }}>
            <div className="mono" style={{ display: "grid", gridTemplateColumns: "130px 1fr 70px 90px 230px", padding: "10px 14px", background: "var(--bg-inset)", fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase", borderBottom: "1px solid var(--line-1)" }}>
              <span>Criada</span><span>Lead</span><span>Views</span><span>Status</span><span style={{ textAlign: "right" }}>Ações</span>
            </div>
            {proposals.map((p) => (
              <div key={p.id} style={{ display: "grid", gridTemplateColumns: "130px 1fr 70px 90px 230px", padding: "10px 14px", borderBottom: "1px solid var(--line-1)", alignItems: "center", fontSize: 13 }}>
                <span className="mono dim" style={{ fontSize: 11 }}>{fmtDate(p.createdAt)}</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.data?.lead?.name || p.lead}{p.data?.lead?.company ? ` · ${p.data.lead.company}` : ""}</span>
                <span className="mono tnum dim">{p.views || 0}</span>
                <span>{p.accepted ? <span className="chip pos" style={{ height: 20 }}>aceita</span> : p.state?.frozen ? <span className="chip" style={{ height: 20 }}>congelada</span> : <span className="mono dim" style={{ fontSize: 11 }}>—</span>}</span>
                <span style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                  <a href={`${publicBase()}/p/${p.id}`} target="_blank" rel="noreferrer" style={{ ...chromeBtnStyleSmall, textDecoration: "none" }}><span style={{ fontSize: 11 }}>ver ↗</span></a>
                  <button onClick={() => copy(`${publicBase()}/p/${p.id}`, "Link copiado")} style={chromeBtnStyleSmall}><span style={{ fontSize: 11 }}>link</span></button>
                  <button onClick={() => copy(`${publicBase()}/p/${p.id}?k=${p.editKey}`, "Link do closer copiado")} style={chromeBtnStyleSmall}><span style={{ fontSize: 11 }}>closer</span></button>
                  <RowActions onDelete={() => openDelete("proposals", p)} />
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {toast && (
        <div className="mono" style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", background: "var(--bg-3)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", padding: "8px 14px", fontSize: 12, boxShadow: "var(--shadow-pop)", zIndex: 90 }}>
          {toast}
        </div>
      )}
    </div>
  );
}

// ── Editor de template ───────────────────────────────────────────────────────

function newTemplate(saasId) {
  return {
    name: "", saas: saasId, status: "draft",
    theme: { ...THEME_DEFAULTS },
    acceptStage: "",
    calc: { salaryMonthly: 3000, workHours: 176, minCopy: 10, minCompatEdit: 2, reworkPct: 0.10, netMargin: 0.10, revenueUpliftPct: 50, maxSeats: 20, validDays: 7, seatsKey: "", volumeKey: "", seatsMap: {}, volumeMid: {}, plans: {}, defaultCycle: "monthly" },
    slides: [
      { key: "hero", type: "hero", tag: "Proposta personalizada · confidencial", title: "Quanto a *{{lead.company}}* perde *todo mês*.", subtitle: "", meta: [{ label: "Apresentado a", value: "{{lead.name}}" }, { label: "Empresa", value: "{{lead.company}}" }] },
      { key: "preco", type: "pricing", eyebrow: "Investimento", title: "O investimento:", planTag: "PLANO · {{calc.plano}}", per: "/ mês", features: [], acceptLabel: "Aceitar proposta" },
    ],
  };
}

function TemplateEditor({ template, saasId, onDone, onCancel }) {
  const isEdit = !!template?.id;
  const [draft, setDraft] = useState(() => template
    ? { ...newTemplate(saasId), ...structuredClone(template), theme: { ...THEME_DEFAULTS, ...(template.theme || {}) } }
    : newTemplate(saasId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const product = (window.SEED.SAAS || []).find((s) => s.id === draft.saas);
  const stages = (product?.funnel || []).map((f) => f.stage);

  const [previewHtml, setPreviewHtml] = useState("");
  const timer = useRef(null);
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try { setPreviewHtml((await api.proposalPreview({ template: draft })).html); }
      catch { /* best-effort */ }
    }, 600);
    return () => clearTimeout(timer.current);
  }, [draft]);

  async function save() {
    if (!String(draft.name).trim()) { setError("Dê um nome ao template"); return; }
    if (!(draft.slides || []).length) { setError("Adicione ao menos um slide"); return; }
    setBusy(true); setError(null);
    const payload = {
      name: draft.name.trim(), saas: draft.saas, status: draft.status,
      theme: draft.theme, acceptStage: draft.acceptStage || "",
      calc: draft.calc, slides: draft.slides,
    };
    try {
      if (isEdit) await api.update("proposal_templates", template.id, payload);
      else await api.create("proposal_templates", payload);
      await onDone();
    } catch (e) { setBusy(false); setError(e.message || String(e)); }
  }

  return (
    <div style={{ flex: 1, display: "grid", gridTemplateColumns: "minmax(460px, 1fr) minmax(380px, 44%)", minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, borderRight: "1px solid var(--line-1)" }}>
        <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="mono dim" style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>{isEdit ? "Editar template" : "Novo template"}</div>
            <div style={{ fontSize: 16, fontWeight: 500, marginTop: 2 }}>{draft.name || "Sem nome"}</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className={"chip " + (draft.status === "published" ? "pos" : "")} style={{ height: 20 }}>{draft.status === "published" ? "publicado" : "rascunho"}</span>
            <button onClick={onCancel} style={{ padding: "7px 12px", background: "var(--bg-2)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", fontSize: 12 }}>Cancelar</button>
            <button onClick={save} disabled={busy} style={{ padding: "7px 14px", background: "var(--accent)", color: "var(--accent-fg)", borderRadius: "var(--r-2)", fontSize: 12, fontWeight: 500, opacity: busy ? 0.6 : 1 }}>
              {busy ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "14px 20px 32px" }}>
          {error && <div className="mono" style={{ fontSize: 11, color: "var(--neg)", marginBottom: 10 }}>{error}</div>}

          <div style={sectionTitle}>Básico</div>
          <div style={{ display: "flex", gap: 10 }}>
            <LabeledInput label="Nome do template" value={draft.name} onChange={(v) => set({ name: v })} placeholder="Proposta · LeverAds" />
            <label style={{ display: "flex", flexDirection: "column", gap: 4, width: 220 }}>
              <span className="mono" style={labelStyle}>Aceite move o lead para</span>
              <select value={draft.acceptStage || ""} onChange={(e) => set({ acceptStage: e.target.value })} style={inputStyle}>
                <option value="">(não mover)</option>
                {stages.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>
          <div className="mono dim" style={{ fontSize: 11, margin: "8px 0 0", lineHeight: 1.5 }}>
            Interpolações: {"{{lead.name}} {{lead.firstName}} {{lead.company}} {{answers.<chave>}} {{calc.preco}} {{calc.custoMes}} {{calc.custoAno}} {{calc.vendasEquiv}} {{calc.roi}} {{calc.plano}} {{calc.precoCiclos}} {{calc.fatTotal}} {{calc.horasMes}} {{state.validUntil}}"} · *palavra* = itálico na cor da marca.
          </div>

          <div style={sectionTitle}>Slides</div>
          <SlidesBuilder slides={draft.slides || []} onChange={(slides) => set({ slides })} />

          <div style={sectionTitle}>Calculadora (custo oculto / preço)</div>
          <CalcEditor calc={draft.calc || {}} onChange={(calc) => set({ calc })} />

          <div style={sectionTitle}>Tema da marca</div>
          <ThemeEditor theme={draft.theme} onChange={(theme) => set({ theme })} />
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, background: "var(--bg-inset)" }}>
        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="mono dim" style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>Preview ao vivo (dados de exemplo)</span>
          {isEdit && (
            <a href={`${publicBase()}/p/t/${template.id}`} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 11, color: "var(--accent)" }}>
              abrir preview ↗
            </a>
          )}
        </div>
        <iframe title="Preview da proposta" srcDoc={previewHtml} sandbox="allow-scripts allow-same-origin" style={{ flex: 1, border: 0, width: "100%", background: draft.theme.bg }} />
      </div>
    </div>
  );
}

// ── Editor de slides (dirigido por SLIDE_SPECS) ──────────────────────────────

function SlidesBuilder({ slides, onChange }) {
  const update = (i, next) => { const arr = [...slides]; arr[i] = next; onChange(arr); };
  const remove = (i) => onChange(slides.filter((_, j) => j !== i));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= slides.length) return;
    const arr = [...slides];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    onChange(arr);
  };
  const arrowStyle = (disabled) => ({ fontSize: 12, padding: "0 3px", color: "var(--fg-3)", opacity: disabled ? 0.3 : 1, fontFamily: "var(--mono)", cursor: disabled ? "default" : "pointer" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {slides.map((s, i) => (
        <SlideCard key={i} slide={s} index={i} total={slides.length}
          onChange={(next) => update(i, next)} onRemove={() => remove(i)} onMove={(d) => move(i, d)} arrowStyle={arrowStyle} />
      ))}
      <button type="button" style={addBtnStyle}
        onClick={() => onChange([...slides, { key: `slide_${slides.length + 1}`, type: "cards" }])}>+ adicionar slide</button>
    </div>
  );
}

function SlideCard({ slide, index, total, onChange, onRemove, onMove, arrowStyle }) {
  const [open, setOpen] = useState(false);
  const spec = SLIDE_SPECS[slide.type] || [];
  const typeName = (SLIDE_TYPES.find(([v]) => v === slide.type) || [])[1] || slide.type;
  const title = getPath(slide, "title") || getPath(slide, "name") || getPath(slide, "tag") || "";

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span className="mono dim" style={{ fontSize: 11, width: 18 }}>{String(index + 1).padStart(2, "0")}</span>
        <button type="button" onClick={() => setOpen(!open)} style={{ flex: 1, textAlign: "left", display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span className="chip" style={{ height: 20, flexShrink: 0 }}>{typeName}</span>
          <span style={{ fontSize: 12.5, color: "var(--fg-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
          <span className="mono dim" style={{ marginLeft: "auto" }}>{open ? "▾" : "▸"}</span>
        </button>
        <div style={{ display: "flex" }}>
          <button type="button" onClick={() => onMove(-1)} disabled={index === 0} style={arrowStyle(index === 0)}>↑</button>
          <button type="button" onClick={() => onMove(1)} disabled={index === total - 1} style={arrowStyle(index === total - 1)}>↓</button>
        </div>
        <button type="button" onClick={onRemove} className="mono dim" style={{ fontSize: 13, padding: "0 6px" }}>✕</button>
      </div>

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: 24 }}>
          <select value={slide.type} onChange={(e) => onChange({ key: slide.key, type: e.target.value })} style={{ ...inputStyle, width: 220 }}>
            {SLIDE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {spec.map(([path, label, kind, cols]) => {
            const val = getPath(slide, path);
            if (kind === "text") return <LabeledInput key={path} label={label} value={val} onChange={(v) => onChange(setPath(slide, path, v))} />;
            if (kind === "textarea") return <LabeledTextarea key={path} label={label} value={val} onChange={(v) => onChange(setPath(slide, path, v))} />;
            if (kind === "strlist") return <StrList key={path} label={label} items={val || []} onChange={(v) => onChange(setPath(slide, path, v))} />;
            if (kind === "objlist") return <ObjList key={path} label={label} cols={cols} items={val || []} onChange={(v) => onChange(setPath(slide, path, v))} />;
            return null;
          })}
        </div>
      )}
    </div>
  );
}

function StrList({ label, items, onChange }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span className="mono" style={labelStyle}>{label}</span>
      {items.map((it, i) => (
        <div key={i} style={{ display: "flex", gap: 6 }}>
          <input value={it} onChange={(e) => { const arr = [...items]; arr[i] = e.target.value; onChange(arr); }} style={inputStyle} />
          <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} className="mono dim" style={{ fontSize: 13, padding: "0 6px" }}>✕</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, ""])} style={addBtnStyle}>+ item</button>
    </div>
  );
}

function ObjList({ label, cols, items, onChange }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span className="mono" style={labelStyle}>{label}</span>
      {items.map((it, i) => (
        <div key={i} style={{ display: "flex", gap: 6 }}>
          {cols.map(([ck, cph]) => (
            <input key={ck} value={it[ck] ?? ""} placeholder={cph}
              onChange={(e) => { const arr = [...items]; arr[i] = { ...arr[i], [ck]: e.target.value }; onChange(arr); }}
              style={{ ...inputStyle, flex: 1 }} />
          ))}
          <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} className="mono dim" style={{ fontSize: 13, padding: "0 6px" }}>✕</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, {}])} style={addBtnStyle}>+ item</button>
    </div>
  );
}

// ── Calculadora ──────────────────────────────────────────────────────────────

function CalcEditor({ calc, onChange }) {
  const set = (k, v) => onChange({ ...calc, [k]: v });
  const cycles = [["monthly", "Mensal"], ["quarterly", "Trimestral"], ["annual", "Anual"]];
  const setPlan = (cycle, field, v) => {
    const plans = { ...(calc.plans || {}) };
    plans[cycle] = { ...(plans[cycle] || {}), [field]: v === "" ? "" : Number(v) };
    if (Object.values(plans[cycle]).every((x) => x === "" || x == null)) delete plans[cycle];
    onChange({ ...calc, plans });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ ...cardStyle, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        {CALC_FIELDS.map(([k, label]) => (
          <LabeledInput key={k} label={label} type="number" value={calc[k]} onChange={(v) => set(k, v === "" ? "" : Number(v))} />
        ))}
      </div>
      <div style={{ ...cardStyle }}>
        <div style={{ display: "flex", gap: 10 }}>
          <LabeledInput label="Chave da resposta de CONTAS (ex.: accounts)" value={calc.seatsKey} onChange={(v) => set("seatsKey", v)} />
          <LabeledInput label="Chave da resposta de VOLUME (ex.: volume)" value={calc.volumeKey} onChange={(v) => set("volumeKey", v)} />
          <label style={{ display: "flex", flexDirection: "column", gap: 4, width: 140 }}>
            <span className="mono" style={labelStyle}>Ciclo padrão</span>
            <select value={calc.defaultCycle || "monthly"} onChange={(e) => set("defaultCycle", e.target.value)} style={inputStyle}>
              {cycles.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>
        <MapEditor label="Resposta de contas → nº de contas (seatsMap)" map={calc.seatsMap || {}} onChange={(m) => set("seatsMap", m)} />
        <MapEditor label="Faixa de volume → anúncios/semana (volumeMid)" map={calc.volumeMid || {}} onChange={(m) => set("volumeMid", m)} />
      </div>
      <div style={{ ...cardStyle }}>
        <span className="mono" style={labelStyle}>Planos (R$/mês · contas incluídas · R$ por conta extra)</span>
        {cycles.map(([v, l]) => (
          <div key={v} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span className="mono dim" style={{ fontSize: 11, width: 76 }}>{l}</span>
            <input type="number" placeholder="base R$" value={calc.plans?.[v]?.base ?? ""} onChange={(e) => setPlan(v, "base", e.target.value)} style={{ ...inputStyle, width: 110 }} />
            <input type="number" placeholder="incluídas" value={calc.plans?.[v]?.included ?? ""} onChange={(e) => setPlan(v, "included", e.target.value)} style={{ ...inputStyle, width: 100 }} />
            <input type="number" placeholder="extra R$" value={calc.plans?.[v]?.extra ?? ""} onChange={(e) => setPlan(v, "extra", e.target.value)} style={{ ...inputStyle, width: 110 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function MapEditor({ label, map, onChange }) {
  const entries = Object.entries(map);
  const setEntry = (i, k, v) => {
    const arr = entries.map(([ek, ev]) => [ek, ev]);
    arr[i] = [k, v];
    onChange(Object.fromEntries(arr.filter(([ek]) => String(ek).trim() !== "")));
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
      <span className="mono" style={labelStyle}>{label}</span>
      {entries.map(([k, v], i) => (
        <div key={i} style={{ display: "flex", gap: 6 }}>
          <input value={k} placeholder="resposta" onChange={(e) => setEntry(i, e.target.value, v)} className="mono" style={{ ...inputStyle, width: 140, fontSize: 12 }} />
          <input type="number" value={v} placeholder="número" onChange={(e) => setEntry(i, k, e.target.value === "" ? "" : Number(e.target.value))} style={{ ...inputStyle, width: 110 }} />
          <button type="button" onClick={() => onChange(Object.fromEntries(entries.filter((_, j) => j !== i)))} className="mono dim" style={{ fontSize: 13, padding: "0 6px" }}>✕</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange({ ...map, "": 0 })} style={addBtnStyle}>+ par</button>
    </div>
  );
}

export { ProposalsScreen };
