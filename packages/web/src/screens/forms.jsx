import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { chromeBtnStyleSmall } from "../lib/ui.js";
import { EmptyState, PrimaryButton, RowActions } from "../atoms.jsx";
import { inputStyle, labelStyle, sectionTitle, cardStyle, addBtnStyle, THEME_DEFAULTS, LabeledInput, ThemeEditor } from "../components/theme-inputs.jsx";
import { useActiveSaas } from "../lib/workspace.js";
import { useAttribution } from "../lib/pains.js";
import { InsightsList } from "../components/insights.jsx";
// Form builder — formulários de captação por SaaS, estilo Typeform: uma pergunta
// por vez, branching por opção, tema por marca. Lista → editor (com preview
// server-side em iframe) → respostas. A página pública vive na API (/f/:id).

const { useState, useEffect, useRef, useCallback } = React;

const QUESTION_TYPES = [
  ["text", "Texto curto"], ["textarea", "Texto longo"], ["email", "E-mail"],
  ["phone", "Telefone"], ["number", "Número"], ["select", "Escolha única"], ["multiselect", "Múltipla escolha"],
  ["insight", "Tela de insight (loading)"],
];
const LEAD_FIELDS = [["name", "Nome do lead"], ["email", "E-mail"], ["phone", "Telefone"], ["company", "Empresa"], ["amount", "Valor (R$)"]];

// Base das URLs públicas: no dev o proxy do Vite repassa /f e /embed.js pra API.
const publicBase = () => import.meta.env.VITE_API_BASE || window.location.origin;
const formUrl = (f) => `${publicBase()}/f/${f.id}`;
const embedSnippet = (f) =>
  `<script src="${publicBase()}/embed.js" defer><\/script>\n<div data-cockpit-form="${f.id}"></div>`;

const slug = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

function FormsScreen({ saasId }) {
  const { SAAS } = window.SEED;
  const { version, openDelete } = useData();
  // Produto do WORKSPACE (seletor no pé da sidebar) — sem abas próprias.
  const [activeProduct] = useActiveSaas();
  const active = activeProduct?.id;
  const [forms, setForms] = useState([]);
  const [counts, setCounts] = useState({}); // formId -> nº de respostas
  const [stats, setStats] = useState({});   // formId -> { views, submits } · 30d (funil)
  const [view, setView] = useState({ mode: "list" }); // list | edit | subs
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    if (!active) return;
    const [fs, subs] = await Promise.all([
      api.list("forms", { saas: active }),
      api.list("form_submissions", { saas: active }),
    ]);
    fs.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    const c = {};
    for (const s of subs) c[s.form] = (c[s.form] || 0) + 1;
    setForms(fs); setCounts(c);
    // Métricas de funil (30d) por form publicado — visitas e conversão da lista.
    const since = new Date(Date.now() - 30 * 86400e3).toISOString();
    const pub = fs.filter((f) => f.status === "published");
    const results = await Promise.allSettled(pub.map((f) => api.formFunnel(f.id, { since })));
    const st = {};
    results.forEach((r, i) => { if (r.status === "fulfilled") st[pub[i].id] = { views: r.value.views, submits: r.value.submits }; });
    setStats(st);
  }, [active]);

  useEffect(() => { load(); }, [load, version]);

  // Troca de produto (workspace) volta pra lista e limpa as linhas antigas —
  // editor/respostas do produto anterior não podem ficar abertos sob a marca
  // do outro, nem as linhas dele aparecer sob o cabeçalho novo.
  useEffect(() => {
    setView((v) => (v.mode === "list" ? v : { mode: "list" }));
    setForms([]); setCounts({}); setStats({});
  }, [active]);

  function flash(msg) { setToast(msg); setTimeout(() => setToast(null), 1800); }
  async function copy(text, msg) {
    try { await navigator.clipboard.writeText(text); flash(msg); }
    catch { window.prompt("Copie:", text); }
  }
  async function togglePublish(f) {
    await api.update("forms", f.id, { status: f.status === "published" ? "draft" : "published" });
    await load();
  }

  if (!SAAS.length) return (
    <EmptyState title="Nenhum SaaS ainda" hint="Crie um produto em Ajustes — cada form pertence a um SaaS (tema, pipeline e propostas da marca)." />
  );

  if (view.mode === "edit") return (
    <FormEditor
      form={view.form} saasId={active}
      onDone={async () => { setView({ mode: "list" }); await load(); }}
      onCancel={() => setView({ mode: "list" })}
    />
  );
  if (view.mode === "subs") return (
    <SubmissionsView form={view.form} onBack={() => setView({ mode: "list" })} />
  );


  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ padding: "12px var(--pad-x)", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{activeProduct?.name}</span>
        <PrimaryButton onClick={() => setView({ mode: "edit", form: null })}>+ novo form</PrimaryButton>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "20px var(--pad-x)" }}>
        {forms.some((f) => f.status === "published") && (
          <FormsDashboard forms={forms.filter((f) => f.status === "published")} />
        )}
        {!forms.length ? (
          <EmptyState
            title="Nenhum form neste SaaS"
            hint="Crie um formulário de captação: uma pergunta por vez, com branching e o tema da marca. Cada resposta vira um lead no pipeline."
            action={<PrimaryButton onClick={() => setView({ mode: "edit", form: null })}>+ Criar form</PrimaryButton>}
          />
        ) : (
          <div className="tbl-x" style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)" }}>
            <div className="mono" style={{ display: "grid", gridTemplateColumns: "1fr 100px 74px 90px 90px 84px 360px", padding: "10px 14px", background: "var(--bg-inset)", fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase", borderBottom: "1px solid var(--line-1)" }}>
              <span>Form</span><span>Status</span><span>Perguntas</span><span title="sessões que abriram a página nos últimos 30 dias">Visitas · 30d</span><span title="envios ÷ visitas (30d)">Conversão</span><span>Respostas</span><span style={{ textAlign: "right" }}>Ações</span>
            </div>
            {forms.map((f) => {
              const pub = f.status === "published";
              return (
                <div key={f.id} style={{ display: "grid", gridTemplateColumns: "1fr 100px 74px 90px 90px 84px 360px", padding: "10px 14px", borderBottom: "1px solid var(--line-1)", alignItems: "center", fontSize: 13 }}>
                  <span style={{ fontWeight: 500 }}>{f.name || f.id}</span>
                  <span><span className={"chip " + (pub ? "pos" : "")} style={{ height: 20 }}>{pub ? "publicado" : "rascunho"}</span></span>
                  <span className="mono tnum dim">{(f.questions || []).length}</span>
                  <span className="mono tnum dim">{stats[f.id] ? window.fmt.int(stats[f.id].views) : ""}</span>
                  <span className="mono tnum" style={{ fontWeight: 600, color: stats[f.id]?.views > 0 ? "var(--fg-1)" : "var(--fg-4)" }}>
                    {stats[f.id]?.views > 0 ? ((stats[f.id].submits / stats[f.id].views) * 100).toFixed(1).replace(".", ",") + "%" : ""}
                  </span>
                  <button className="mono tnum" onClick={() => setView({ mode: "subs", form: f })} style={{ textAlign: "left", color: "var(--accent)", fontSize: 13 }}>
                    {counts[f.id] || 0}
                  </button>
                  <span style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                    <button onClick={() => togglePublish(f)} style={{ ...chromeBtnStyleSmall }}>
                      <span style={{ fontSize: 11 }}>{pub ? "despublicar" : "publicar"}</span>
                    </button>
                    <button onClick={() => copy(formUrl(f), "Link copiado")} disabled={!pub} title={pub ? formUrl(f) : "Publique para gerar o link"} style={{ ...chromeBtnStyleSmall, opacity: pub ? 1 : 0.45 }}>
                      <span style={{ fontSize: 11 }}>link</span>
                    </button>
                    <button onClick={() => copy(embedSnippet(f), "Snippet de embed copiado")} disabled={!pub} title="Copiar código de embed" style={{ ...chromeBtnStyleSmall, opacity: pub ? 1 : 0.45 }}>
                      <span style={{ fontSize: 11 }}>embed</span>
                    </button>
                    <RowActions onEdit={() => setView({ mode: "edit", form: f })} onDelete={() => openDelete("forms", f)} />
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {toast && (
        <div className="mono" style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", background: "var(--bg-3)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", padding: "8px 14px", fontSize: 12, boxShadow: "var(--shadow-pop)", zIndex: 90 }}>
          {toast}
        </div>
      )}
    </div>
  );
}

// ── Editor ──────────────────────────────────────────────────────────────────

function newForm(saasId) {
  return {
    name: "", saas: saasId, status: "draft",
    theme: { ...THEME_DEFAULTS },
    welcome: null,
    questions: [{ key: "nome", label: "Qual é o seu nome?", type: "text", required: true, placeholder: "", help: "", options: [] }],
    thanks: { title: "Recebido! Obrigado.", subtitle: "", redirectUrl: "", whatsapp: "", whatsappMsg: "" },
    reject: { title: "", subtitle: "" },
    mapping: { name: "nome" },
  };
}

function FormEditor({ form, saasId, onDone, onCancel }) {
  const isEdit = !!form?.id;
  const [draft, setDraft] = useState(() => form
    ? { ...newForm(saasId), ...structuredClone(form), theme: { ...THEME_DEFAULTS, ...(form.theme || {}) } }
    : newForm(saasId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  // Preview server-side (mesmo HTML da página pública), debounced.
  const [previewHtml, setPreviewHtml] = useState("");
  const timer = useRef(null);
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try { setPreviewHtml((await api.formPreview(draft)).html); }
      catch { /* preview é best-effort */ }
    }, 500);
    return () => clearTimeout(timer.current);
  }, [draft]);

  function validate() {
    if (!String(draft.name).trim()) return "Dê um nome ao form";
    const qs = (draft.questions || []).filter((q) => String(q.label).trim());
    if (!qs.length) return "Adicione ao menos uma pergunta";
    const keys = qs.map((q) => q.key);
    if (keys.some((k) => !String(k).trim())) return "Toda pergunta precisa de uma chave";
    if (new Set(keys).size !== keys.length) return "Chaves de pergunta duplicadas";
    return null;
  }

  async function save() {
    const err = validate();
    if (err) { setError(err); return; }
    setBusy(true); setError(null);
    const payload = {
      name: draft.name.trim(), saas: draft.saas, status: draft.status,
      theme: draft.theme,
      submitLabel: String(draft.submitLabel || '').trim(),
      welcome: draft.welcome && String(draft.welcome.title || "").trim() ? draft.welcome : null,
      questions: (draft.questions || [])
        .filter((q) => String(q.label).trim() && String(q.key).trim())
        .map((q, i) => {
          const base = { key: q.key.trim(), label: q.label.trim(), type: q.type || "text", required: !!q.required };
          if (q.stack && i > 0 && q.type !== "insight") base.stack = true;
          if (q.placeholder) base.placeholder = q.placeholder;
          if (q.help) base.help = q.help;
          if (q.to) base.to = q.to;
          if (q.type === "insight") {
            base.required = false;
            if (q.stat) base.stat = q.stat;
            if (q.statLabel) base.statLabel = q.statLabel;
            if (Number(q.durationMs) > 0) base.durationMs = Number(q.durationMs);
          }
          if (q.type === "select" || q.type === "multiselect") {
            base.options = (q.options || [])
              .filter((o) => String(o.value || "").trim())
              .map((o) => {
                const opt = { value: o.value.trim(), label: String(o.label || o.value).trim() };
                if (o.to) opt.to = o.to;
                return opt;
              });
          }
          return base;
        }),
      thanks: draft.thanks,
      // Tela de descarte: só persiste se o builder configurou algum texto.
      reject: draft.reject && (String(draft.reject.title || "").trim() || String(draft.reject.subtitle || "").trim()) ? draft.reject : null,
      mapping: Object.fromEntries(Object.entries(draft.mapping || {}).filter(([, v]) => v)),
    };
    try {
      if (isEdit) await api.update("forms", form.id, payload);
      else await api.create("forms", payload);
      await onDone();
    } catch (e) {
      setBusy(false); setError(e.message || String(e));
    }
  }

  const qKeys = (draft.questions || []).filter((q) => q.key && q.type !== "insight").map((q) => ({ value: q.key, label: q.label || q.key }));

  return (
    <div className="editor-split" style={{ flex: 1, "--cols": "minmax(440px, 1fr) minmax(380px, 46%)", minHeight: 0 }}>
      {/* coluna do editor */}
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, borderRight: "1px solid var(--line-1)" }}>
        <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="mono dim" style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>{isEdit ? "Editar form" : "Novo form"}</div>
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
          <LabeledInput label="Nome do form" value={draft.name} onChange={(v) => set({ name: v })} placeholder="Diagnóstico · LeverAds" />
          <LabeledInput label="Texto do botão de enviar (última tela)" value={draft.submitLabel || ""} onChange={(v) => set({ submitLabel: v })} placeholder="Enviar" />

          <div style={sectionTitle}>Boas-vindas (opcional)</div>
          {!draft.welcome ? (
            <button onClick={() => set({ welcome: { title: "", subtitle: "", button: "Começar" } })} style={addBtnStyle}>+ adicionar tela de boas-vindas</button>
          ) : (
            <div style={cardStyle}>
              <LabeledInput label="Título" value={draft.welcome.title} onChange={(v) => set({ welcome: { ...draft.welcome, title: v } })} />
              <LabeledInput label="Subtítulo" value={draft.welcome.subtitle} onChange={(v) => set({ welcome: { ...draft.welcome, subtitle: v } })} />
              <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                <LabeledInput label="Texto do botão" value={draft.welcome.button} onChange={(v) => set({ welcome: { ...draft.welcome, button: v } })} />
                <button onClick={() => set({ welcome: null })} className="mono dim" style={{ fontSize: 12, padding: "8px 6px" }}>remover</button>
              </div>
              <VariantsEditor welcome={draft.welcome} onChange={(w) => set({ welcome: w })} />
              <PainWelcomesEditor welcome={draft.welcome} saas={draft.saas} onChange={(w) => set({ welcome: w })} />
            </div>
          )}

          <div style={sectionTitle}>Perguntas</div>
          <div className="mono dim" style={{ fontSize: 11, marginBottom: 8, lineHeight: 1.5 }}>
            Nos títulos, *palavra* vira itálico na cor da marca. "Tela de insight" mostra copy + estatística entre perguntas e avança sozinha.
          </div>
          <QuestionsBuilder
            questions={draft.questions || []}
            onChange={(qs) => set({ questions: qs })}
          />

          <div style={sectionTitle}>Tela final (qualificado)</div>
          <div style={cardStyle}>
            <LabeledInput label="Título" value={draft.thanks?.title || ""} onChange={(v) => set({ thanks: { ...draft.thanks, title: v } })} />
            <LabeledInput label="Subtítulo" value={draft.thanks?.subtitle || ""} onChange={(v) => set({ thanks: { ...draft.thanks, subtitle: v } })} />
            <LabeledInput label="Redirecionar para (URL, opcional)" value={draft.thanks?.redirectUrl || ""} onChange={(v) => set({ thanks: { ...draft.thanks, redirectUrl: v } })} placeholder="https://…" />
            <LabeledInput label="WhatsApp do time (opcional)" value={draft.thanks?.whatsapp || ""} onChange={(v) => set({ thanks: { ...draft.thanks, whatsapp: v } })} placeholder="(11) 99999-9999" />
            <LabeledInput label="Texto acima do botão WhatsApp" value={draft.thanks?.whatsappMsg || ""} onChange={(v) => set({ thanks: { ...draft.thanks, whatsappMsg: v } })} placeholder="Caso tenha ficado com alguma dúvida, você pode falar com nosso time agora." />
          </div>

          <div style={sectionTitle}>Tela final (não qualificado)</div>
          <div className="mono dim" style={{ fontSize: 11, marginBottom: 8, lineHeight: 1.5 }}>
            Mostrada quando uma opção rota para <b>→ fim (não qualificado)</b>. O contato ainda é
            registrado (marcado como desqualificado), mas <b>sem proposta e sem contar como conversão</b> (Pixel/CAPI).
          </div>
          <div style={cardStyle}>
            <LabeledInput label="Título" value={draft.reject?.title || ""} onChange={(v) => set({ reject: { ...draft.reject, title: v } })} placeholder="Obrigado pelo seu interesse!" />
            <LabeledInput label="Subtítulo" value={draft.reject?.subtitle || ""} onChange={(v) => set({ reject: { ...draft.reject, subtitle: v } })} placeholder="No momento não é um fit, mas agradecemos o contato." />
          </div>

          <div style={sectionTitle}>Mapeamento → lead</div>
          <div className="mono dim" style={{ fontSize: 11, marginBottom: 8, lineHeight: 1.5 }}>
            Cada envio vira um lead no pipeline deste SaaS. Aponte qual pergunta alimenta cada campo do lead — as demais respostas vão juntas no lead.
          </div>
          <div style={{ ...cardStyle, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {LEAD_FIELDS.map(([k, label]) => (
              <label key={k} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span className="mono" style={labelStyle}>{label}</span>
                <select value={draft.mapping?.[k] || ""} onChange={(e) => set({ mapping: { ...draft.mapping, [k]: e.target.value } })} style={inputStyle}>
                  <option value="">—</option>
                  {qKeys.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            ))}
          </div>

          <div style={sectionTitle}>Tema da marca</div>
          <ThemeEditor theme={draft.theme} onChange={(theme) => set({ theme })} />
        </div>
      </div>

      {/* coluna do preview */}
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, background: "var(--bg-inset)" }}>
        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="mono dim" style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>Preview ao vivo</span>
          {isEdit && draft.status === "published" && (
            <a href={formUrl(draft)} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 11, color: "var(--accent)" }}>abrir página pública ↗</a>
          )}
        </div>
        <iframe
          title="Preview do form"
          srcDoc={previewHtml}
          sandbox="allow-scripts allow-same-origin"
          style={{ flex: 1, border: 0, width: "100%", background: draft.theme.bg }}
        />
      </div>
    </div>
  );
}

// Editor da lista de perguntas — espelha o QuestionsEditor do EntityForm, com os
// tipos extras (email/phone/textarea) e branching por opção ("pular para").
function QuestionsBuilder({ questions, onChange }) {
  const update = (i, patch) => { const next = [...questions]; next[i] = { ...next[i], ...patch }; onChange(next); };
  const remove = (i) => onChange(questions.filter((_, j) => j !== i));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= questions.length) return;
    const next = [...questions];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const updateOpt = (qi, oi, patch) => {
    const opts = [...(questions[qi].options || [])];
    opts[oi] = { ...opts[oi], ...patch };
    update(qi, { options: opts });
  };
  const arrowStyle = (disabled) => ({ fontSize: 12, padding: "0 3px", color: "var(--fg-3)", opacity: disabled ? 0.3 : 1, fontFamily: "var(--mono)", cursor: disabled ? "default" : "pointer" });

  // Destinos de branching: outra pergunta ou um dos fins. Exclui a própria pergunta.
  // "_reject" = fim de NÃO-qualificado (tela negativa, sem proposta/conversão).
  const jumpOptions = (selfKey) => [
    { value: "", label: "(próxima pergunta)" },
    ...questions.filter((q) => q.key && q.key !== selfKey).map((q) => ({ value: q.key, label: `→ ${q.label || q.key}` })),
    { value: "_end", label: "→ fim do form" },
    { value: "_reject", label: "→ fim (não qualificado)" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {questions.map((q, i) => {
        const isInsight = q.type === "insight";
        const hasOptions = q.type === "select" || q.type === "multiselect";
        return (
          <div key={i} style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="mono dim" style={{ fontSize: 11, width: 18 }}>{String(i + 1).padStart(2, "0")}</span>
              <input
                value={q.label || ""} placeholder={isInsight ? "Título do insight (*palavra* destaca)" : "Pergunta"}
                onChange={(e) => {
                  const patch = { label: e.target.value };
                  if (!q._keyTouched && (q._keyAuto || !String(q.key || "").trim())) patch.key = slug(e.target.value);
                  update(i, patch);
                }}
                style={{ ...inputStyle, flex: 1 }}
              />
              <input
                value={q.key || ""} placeholder="chave" title="Chave da resposta (vira campo do lead)"
                onChange={(e) => update(i, { key: slug(e.target.value) || e.target.value, _keyTouched: true })}
                className="mono" style={{ ...inputStyle, width: 120, fontSize: 12 }}
              />
              <div style={{ display: "flex" }}>
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} style={arrowStyle(i === 0)}>↑</button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === questions.length - 1} style={arrowStyle(i === questions.length - 1)}>↓</button>
              </div>
              <button type="button" onClick={() => remove(i)} className="mono dim" style={{ fontSize: 13, padding: "0 6px" }}>✕</button>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, paddingLeft: 24, flexWrap: "wrap" }}>
              <select value={q.type || "text"} onChange={(e) => update(i, { type: e.target.value })} style={{ ...inputStyle, width: 180 }}>
                {QUESTION_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              {!isInsight && (
                <label style={{ display: "inline-flex", gap: 5, alignItems: "center", fontSize: 12 }}>
                  <input type="checkbox" checked={!!q.required} onChange={(e) => update(i, { required: e.target.checked })} />
                  obrigatória
                </label>
              )}
              {!isInsight && i > 0 && (
                <label style={{ display: "inline-flex", gap: 5, alignItems: "center", fontSize: 12 }} title="Renderiza na mesma tela da pergunta anterior (ex.: nome + e-mail + telefone juntos)">
                  <input type="checkbox" checked={!!q.stack} onChange={(e) => update(i, { stack: e.target.checked })} />
                  mesma tela que a anterior
                </label>
              )}
              {!isInsight && !hasOptions && (
                <input value={q.placeholder || ""} placeholder="placeholder (opcional)" onChange={(e) => update(i, { placeholder: e.target.value })} style={{ ...inputStyle, flex: 1, minWidth: 140 }} />
              )}
            </div>

            {isInsight && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 24 }}>
                <input value={q.stat || ""} placeholder="stat (ex.: +50%)" onChange={(e) => update(i, { stat: e.target.value })} className="mono" style={{ ...inputStyle, width: 120, fontSize: 12 }} />
                <input value={q.statLabel || ""} placeholder="legenda do stat (opcional)" onChange={(e) => update(i, { statLabel: e.target.value })} style={{ ...inputStyle, flex: 1 }} />
                <input type="number" value={q.durationMs ?? ""} placeholder="2400" title="Duração em ms antes de avançar" onChange={(e) => update(i, { durationMs: e.target.value === "" ? "" : Number(e.target.value) })} className="mono" style={{ ...inputStyle, width: 90, fontSize: 12 }} />
                <span className="mono dim" style={{ fontSize: 10 }}>ms</span>
              </div>
            )}

            <div style={{ paddingLeft: 24 }}>
              <input value={q.help || ""} placeholder="texto de apoio (opcional)" onChange={(e) => update(i, { help: e.target.value })} style={inputStyle} />
            </div>

            {hasOptions && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingLeft: 24 }}>
                {(q.options || []).map((o, oi) => (
                  <div key={oi} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input value={o.label || ""} placeholder="Rótulo" onChange={(e) => updateOpt(i, oi, { label: e.target.value, value: o._valTouched ? o.value : slug(e.target.value) })} style={{ ...inputStyle, flex: 1 }} />
                    <input value={o.value || ""} placeholder="valor" onChange={(e) => updateOpt(i, oi, { value: e.target.value, _valTouched: true })} className="mono" style={{ ...inputStyle, width: 110, fontSize: 12 }} />
                    {q.type === "select" && (
                      <select value={o.to || ""} title="Pular para…" onChange={(e) => updateOpt(i, oi, { to: e.target.value })} style={{ ...inputStyle, width: 170, fontSize: 12 }}>
                        {jumpOptions(q.key).map((j) => <option key={j.value} value={j.value}>{j.label}</option>)}
                      </select>
                    )}
                    <button type="button" onClick={() => update(i, { options: (q.options || []).filter((_, j) => j !== oi) })} className="mono dim" style={{ fontSize: 13, padding: "0 6px" }}>✕</button>
                  </div>
                ))}
                <button type="button" onClick={() => update(i, { options: [...(q.options || []), { value: "", label: "" }] })} style={addBtnStyle}>+ opção</button>
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 24 }}>
              <span className="mono dim" style={{ fontSize: 10, letterSpacing: "0.04em" }}>depois desta pergunta:</span>
              <select value={q.to || ""} onChange={(e) => update(i, { to: e.target.value })} style={{ ...inputStyle, width: 200, fontSize: 12 }}>
                {jumpOptions(q.key).map((j) => <option key={j.value} value={j.value}>{j.label}</option>)}
              </select>
            </div>
          </div>
        );
      })}
      <button type="button" onClick={() => onChange([...questions, { key: "", label: "", type: "text", required: false, options: [], _keyAuto: true }])} style={addBtnStyle}>+ adicionar pergunta</button>
    </div>
  );
}

// ── Respostas ───────────────────────────────────────────────────────────────

function SubmissionsView({ form, onBack }) {
  const [subs, setSubs] = useState(null);
  const [open, setOpen] = useState(null); // id expandido
  const labels = Object.fromEntries((form.questions || []).map((q) => [q.key, q.label]));

  useEffect(() => {
    api.list("form_submissions", { form: form.id }).then((rows) => {
      rows.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
      setSubs(rows);
    });
  }, [form.id]);

  const headline = (s) => {
    const m = form.mapping || {};
    const name = m.name && s.answers?.[m.name];
    const email = m.email && s.answers?.[m.email];
    return [name, email].filter(Boolean).join(" · ") || Object.values(s.answers || {})[0] || s.id;
  };
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ padding: "12px var(--pad-x)", borderBottom: "1px solid var(--line-1)", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} style={chromeBtnStyleSmall}><span style={{ fontSize: 12 }}>← forms</span></button>
        <div>
          <div style={{ fontSize: 15, fontWeight: 500 }}>{form.name}</div>
          <div className="mono dim" style={{ fontSize: 11 }}>{subs ? `${subs.length} resposta${subs.length === 1 ? "" : "s"}` : "carregando…"}</div>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "20px var(--pad-x)" }}>
        {subs && !subs.length && (
          <EmptyState title="Nenhuma resposta ainda" hint="Publique o form e compartilhe o link — cada envio aparece aqui e vira um lead no pipeline." />
        )}
        {subs && subs.length > 0 && (
          <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", overflow: "hidden", background: "var(--bg-1)" }}>
            {subs.map((s) => (
              <div key={s.id} style={{ borderBottom: "1px solid var(--line-1)" }}>
                <button
                  onClick={() => setOpen(open === s.id ? null : s.id)}
                  style={{ display: "grid", gridTemplateColumns: "150px 1fr 20px", width: "100%", padding: "10px 14px", alignItems: "center", textAlign: "left", fontSize: 13, color: "var(--fg-1)", gap: 10 }}
                >
                  <span className="mono dim" style={{ fontSize: 11 }}>{fmtDate(s.createdAt)}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{headline(s)}</span>
                  <span className="mono dim">{open === s.id ? "▾" : "▸"}</span>
                </button>
                {open === s.id && (
                  <div style={{ padding: "4px 14px 14px 174px", display: "flex", flexDirection: "column", gap: 6 }}>
                    {Object.entries(s.answers || {}).map(([k, v]) => (
                      <div key={k} style={{ fontSize: 12.5 }}>
                        <span className="mono dim" style={{ fontSize: 11 }}>{labels[k] || k}: </span>
                        <span>{Array.isArray(v) ? v.join(", ") : String(v)}</span>
                      </div>
                    ))}
                    {s.lead && <div className="mono dim" style={{ fontSize: 10.5, marginTop: 4 }}>lead: {s.lead}</div>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Welcome por DOR (anúncio → headline) ─────────────────────────────────────
// A página /f/:id resolve a dor do anúncio de origem (utm_content → nome →
// "[X]") e mostra a welcome daquela dor — consistência anúncio → página sem
// duplicar o form. Cada dor pode ter o próprio teste A/B (ids das variantes
// ganham o prefixo da dor pra não colidir no funil).
function PainWelcomesEditor({ welcome, saas, onChange }) {
  const painMap = ((window.SEED?.SAAS || []).find((x) => x.id === saas) || {}).painMap || {};
  const codes = Object.keys(painMap);
  if (!codes.length) return null;
  const byPain = welcome.byPain || {};
  const setPain = (code, patch) => onChange({ ...welcome, byPain: { ...byPain, [code]: { ...(byPain[code] || {}), ...patch } } });
  const removePain = (code) => {
    const next = { ...byPain };
    delete next[code];
    onChange({ ...welcome, ...(Object.keys(next).length ? { byPain: next } : { byPain: undefined }) });
  };
  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--line-2)" }}>
      <div className="mono" style={{ fontSize: 10.5, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--fg-3)", marginBottom: 6 }}>
        Headline por dor (anúncio → página)
      </div>
      <div className="mono dim" style={{ fontSize: 11, lineHeight: 1.5, marginBottom: 8 }}>
        Quem chega por um anúncio com código de dor vê a welcome daquela dor (campo vazio herda a base). Sem dor resolvida, vale a base acima.
      </div>
      {codes.map((code) => {
        const pw = byPain[code];
        if (!pw) {
          return (
            <button key={code} onClick={() => setPain(code, { title: "", subtitle: "", button: "" })} style={{ ...addBtnStyle, marginBottom: 6 }}>
              + headline pra dor [{code}] · {painMap[code]}
            </button>
          );
        }
        return (
          <div key={code} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", padding: 10, marginBottom: 8, background: "var(--bg-inset)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", border: "1px solid var(--accent-line)", borderRadius: 5, padding: "1px 7px" }}>[{code}]</span>
              <span style={{ fontSize: 12, color: "var(--fg-3)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{painMap[code]}</span>
              <button onClick={() => removePain(code)} className="mono dim" style={{ fontSize: 12 }}>✕</button>
            </div>
            <LabeledInput label="Título" value={pw.title || ""} onChange={(x) => setPain(code, { title: x })} placeholder="vazio = herda o título base" />
            <LabeledInput label="Subtítulo" value={pw.subtitle || ""} onChange={(x) => setPain(code, { subtitle: x })} placeholder="vazio = herda" />
            <LabeledInput label="Texto do botão (CTA)" value={pw.button || ""} onChange={(x) => setPain(code, { button: x })} placeholder="vazio = herda" />
            <VariantsEditor welcome={pw} idPrefix={code + "-"} onChange={(w) => setPain(code, w)} />
          </div>
        );
      })}
    </div>
  );
}

// ── Teste A/B da tela de boas-vindas ─────────────────────────────────────────
// Cada variante sobrescreve título/subtítulo/botão da welcome base (campo vazio
// herda). A página sorteia por navegador (sticky) e carimba a variante nos
// eventos do funil e no lead (formVariant) — o funil compara as versões.
function VariantsEditor({ welcome, onChange, idPrefix = "" }) {
  const variants = welcome.variants || [];
  const setV = (i, patch) => onChange({ ...welcome, variants: variants.map((v, j) => (j === i ? { ...v, ...patch } : v)) });
  const add = () => {
    // Numeração B-001, B-002… monotônica (variantSeq nunca decresce): id de
    // variante NUNCA se repete entre rodadas — o histórico do funil não mistura
    // copies diferentes na mesma linha.
    const seq = (Number(welcome.variantSeq) || 0) + 1;
    const id = `${idPrefix}${String(seq).padStart(3, "0")}`;
    onChange({ ...welcome, variantSeq: seq, variants: [...variants, { id, title: "", subtitle: "", button: "" }] });
  };
  const remove = (i) => {
    const next = variants.filter((_, j) => j !== i);
    onChange({ ...welcome, ...(next.length ? { variants: next } : { variants: undefined }) });
  };
  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--line-2)" }}>
      <div className="mono" style={{ fontSize: 10.5, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--fg-3)", marginBottom: 6 }}>
        Teste A/B da headline {variants.length > 0 && `· ${variants.length} variante${variants.length > 1 ? "s" : ""} ativas`}
      </div>
      {variants.length === 0 && (
        <div className="mono dim" style={{ fontSize: 11, lineHeight: 1.5, marginBottom: 8 }}>
          Com 2+ variantes, cada visitante vê UMA versão (sorteio fixo por navegador) e o funil compara view → começar → envio por versão. Campo vazio herda o da welcome acima.
        </div>
      )}
      {variants.map((v, i) => (
        <div key={i} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", padding: 10, marginBottom: 8, background: "var(--bg-inset)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", border: "1px solid var(--accent-line)", borderRadius: 5, padding: "1px 7px" }}>{v.id}</span>
            <span style={{ flex: 1 }} />
            <button onClick={() => remove(i)} className="mono dim" style={{ fontSize: 12 }}>✕</button>
          </div>
          <LabeledInput label="Título" value={v.title || ""} onChange={(x) => setV(i, { title: x })} placeholder="vazio = herda o título base" />
          <LabeledInput label="Subtítulo" value={v.subtitle || ""} onChange={(x) => setV(i, { subtitle: x })} placeholder="vazio = herda" />
          <LabeledInput label="Texto do botão (CTA)" value={v.button || ""} onChange={(x) => setV(i, { button: x })} placeholder="vazio = herda" />
        </div>
      ))}
      <button onClick={add} style={addBtnStyle}>+ variante {idPrefix + String((Number(welcome.variantSeq) || 0) + 1).padStart(3, "0")}</button>
    </div>
  );
}

// ── Regras do campeão do teste A/B ───────────────────────────────────────────
// Elegibilidade: ≥100 visitas E ≥7 dias corridos na variante líder. Decisão:
// líder pela % de começar com ≥95% de confiança (z de duas proporções vs. a
// vice) e SEM regressão de envio (% envio ≥ 70% da vice, quando a vice tem
// amostra). Ganhos desempatam e vetam: campeã de clique que não fecha, não é
// campeã. Comparação sempre DENTRO da mesma dor (ou da base).
const MIN_VIEWS = 100;
const MIN_DAYS = 7;
function normCdf(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  const pos = 0.5 * (1 + erf);
  return z >= 0 ? pos : 1 - pos;
}
function championVerdicts(variants) {
  const out = {}; // `${pain}|${id}` -> { label, tone }
  const groups = {};
  for (const v of variants) (groups[v.pain || ""] = groups[v.pain || ""] || []).push(v);
  for (const pain of Object.keys(groups)) {
    const g = groups[pain].filter((v) => v.views > 0).sort((a, b) => b.starts / b.views - a.starts / a.views);
    const key = (v) => `${v.pain || ""}|${v.id}`;
    if (g.length === 0) continue;
    if (g.length === 1) { out[key(g[0])] = { label: "sem rival", tone: "var(--fg-4)" }; continue; }
    const [top, second] = g;
    const days = top.firstAt ? Math.max(1, Math.ceil((Date.now() - new Date(top.firstAt).getTime()) / 86400e3)) : 0;
    for (const v of g.slice(1)) out[key(v)] = { label: "", tone: "var(--fg-4)" };
    if (top.views < MIN_VIEWS || days < MIN_DAYS) {
      out[key(top)] = { label: `coletando · ${top.views}/${MIN_VIEWS} visitas · ${Math.min(days, MIN_DAYS)}/${MIN_DAYS}d`, tone: "var(--warn)" };
      continue;
    }
    const p1 = top.starts / top.views;
    const p2 = second.starts / second.views;
    const pool = (top.starts + second.starts) / (top.views + second.views);
    const se = Math.sqrt(pool * (1 - pool) * (1 / top.views + 1 / second.views));
    const conf = se > 0 ? normCdf((p1 - p2) / se) : 0.5;
    const subTop = top.submits / top.views;
    const subSecond = second.views > 0 ? second.submits / second.views : 0;
    const submitWorse = second.views >= 50 && subSecond > 0 && subTop < 0.7 * subSecond;
    const wonWorse = second.won > top.won; // fechou menos contrato que a vice
    if (conf >= 0.95 && !submitWorse && !wonWorse) out[key(top)] = { label: "campeã ✓ promova pro texto base", tone: "var(--pos)" };
    else if (conf >= 0.95 && (submitWorse || wonWorse)) out[key(top)] = { label: submitWorse ? "ganha clique, perde envio ⚠" : "ganha clique, fecha menos ⚠", tone: "var(--neg)" };
    else out[key(top)] = { label: `líder · ${Math.round(conf * 100)}% de confiança`, tone: "var(--fg-3)" };
  }
  return out;
}

// Rótulo do ANÚNCIO de uma origem: utm_content (ad id) resolvido pra nome pelo
// catálogo; sem content, cai no nome da campanha; orgânico (só source, derivado
// do referrer) mostra "(orgânico)".
function originAdLabel(o, cat) {
  if (o.content) return cat?.ads?.[o.content]?.name || o.content;
  if (o.campaign) return cat?.campaigns?.[o.campaign]?.name || o.campaign;
  return "(orgânico)";
}

// ── Insights do funil do form ────────────────────────────────────────────────
// Mesma filosofia do card da Publicidade (regras explicáveis, cada uma com os
// números do porquê); render/dispensa no components/insights.jsx. Ids estáveis
// por regra+alvo. Volumes mínimos evitam insight de amostra pequena.
function buildFormInsights(data, form, cat) {
  if (!data || data.error) return [];
  const out = [];
  const pctN = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

  // Welcome segurando pouca gente: poucas visitas viram "começar".
  if (data.views >= 30 && form.welcome) {
    const startRate = pctN(data.starts, data.views);
    if (startRate < 40) {
      out.push({ id: "welcome-starts", meta: { kind: "newHeadline", startRate }, tone: "atencao", tag: "Atenção", text: `Só ${startRate}% das ${data.views} visitas clicam em começar. A headline/promessa da boas-vindas é o primeiro suspeito, vale rodar uma variante nova no teste A/B.` });
    }
  }
  // Etapa que mais derruba: maior queda relativa entre telas consecutivas.
  const steps = (data.steps || []).filter((s) => !s.insight);
  const chain = [{ key: "_start", label: "começar", sessions: data.starts }, ...steps];
  let worst = null;
  for (let i = 1; i < chain.length; i++) {
    const prev = chain[i - 1].sessions;
    if (prev < 15) continue; // amostra pequena não vira insight
    const drop = 1 - chain[i].sessions / prev;
    if (drop >= 0.25 && (!worst || drop > worst.drop)) worst = { step: chain[i], prev, drop };
  }
  if (worst) {
    out.push({ id: `drop-step:${worst.step.key}`, meta: { kind: "makeOptional", key: worst.step.key }, tone: "cortar", tag: "Revisar", text: `A pergunta “${worst.step.label}” derruba ${Math.round(worst.drop * 100)}% de quem chega nela (${worst.prev} → ${worst.step.sessions} sessões). Simplifique a pergunta, torne opcional ou mova pra mais perto do fim.` });
  }
  // Origens: taxa de envio muito abaixo/acima da média do form.
  const origins = (data.origins || []).filter((o) => o.views >= 15);
  if (origins.length >= 2 && data.views > 0) {
    const rate = (o) => (o.views > 0 ? o.submits / o.views : 0);
    const overall = data.submits / data.views;
    const name = (o) => `${o.source || "(sem source)"}${o.content || o.campaign ? ` · ${originAdLabel(o, cat)}` : ""}`;
    const sorted = [...origins].sort((a, b) => rate(a) - rate(b));
    const weak = sorted[0];
    const best = sorted[sorted.length - 1];
    if (overall > 0 && rate(weak) < overall / 2) {
      out.push({ id: `origin-weak:${weak.source || ""}|${weak.content || weak.campaign || ""}`, meta: { kind: "pauseCampaign", campaign: weak.campaign || "" }, tone: "atencao", tag: "Atenção", text: `A origem ${name(weak)} converte ${pctN(weak.submits, weak.views)}% das visitas em envio, menos da metade da média do form (${Math.round(overall * 100)}%). O público desse tráfego pode não casar com a promessa ou com as perguntas.` });
    }
    if (best !== weak && rate(best) >= overall * 1.5) {
      out.push({ id: `origin-best:${best.source || ""}|${best.content || best.campaign || ""}`, meta: { kind: "raiseCampaignBudget", campaign: best.campaign || "" }, tone: "escalar", tag: "Escalar", text: `${name(best)} converte ${pctN(best.submits, best.views)}% das visitas em envio (média do form: ${Math.round(overall * 100)}%). Tráfego com esse perfil rende mais form completo — vale priorizar.` });
    }
  }
  return out.slice(0, 5);
}

// Ação executável dos insights do form (botão "aplicar" + confirmação), na
// mesma regra da Publicidade: só quando a plataforma consegue fazer sozinha e
// com segurança. Pergunta que derruba → tornar opcional (edição do próprio
// form); origem fraca/campeã → pausar campanha / subir orçamento na Meta, e
// nesses casos a campanha precisa estar VIVA (effectiveStatus ACTIVE na
// listagem da conta) — sem listagem (sem permissão de metrics, Meta fora) ou
// com campanha parada, o insight fica só informativo.
const moneyBRL = (v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v) || 0);
function withFormInsightAction(it, { form, adObjects }) {
  const m = it.meta;
  if (!m) return it;
  if (m.kind === "newHeadline") {
    // A IA escreve a variante; os campos chegam EDITÁVEIS no popup (regra do
    // Leo pra ação de texto) e o confirmar publica como variante nova do A/B,
    // com o id monotônico do builder (variantSeq nunca repete entre rodadas).
    return {
      ...it,
      action: {
        label: "Criar variante de headline (IA)",
        prepare: async () => {
          const s = await api.suggestWelcome(form.id, { startRate: m.startRate });
          return [
            { key: "title", label: "Título", value: s.title || "" },
            { key: "subtitle", label: "Subtítulo", value: s.subtitle || "", multiline: true, optional: true },
            { key: "button", label: "Botão", value: s.button || "" },
          ];
        },
        steps: [
          "Ajuste os textos acima se quiser (o que estiver nos campos é o que vai pro ar).",
          `Confirmar publica a copy como VARIANTE NOVA do teste A/B da welcome do form “${form.name || form.id}”: a versão atual continua no ar e o sorteio por visitante decide quem vê qual.`,
          "O funil passa a comparar as duas versões; a campeã você promove no builder, como sempre.",
        ],
        execute: (v) => {
          const w = form.welcome || {};
          const seq = (Number(w.variantSeq) || 0) + 1;
          const variant = { id: String(seq).padStart(3, "0"), title: v.title, subtitle: v.subtitle || "", button: v.button };
          return api.update("forms", form.id, { welcome: { ...w, variantSeq: seq, variants: [...(w.variants || []), variant] } });
        },
      },
    };
  }
  if (m.kind === "makeOptional") {
    const q = (form.questions || []).find((x) => x.key === m.key);
    if (!q || !q.required) return it; // já é opcional (ou saiu do form)
    return {
      ...it,
      action: {
        label: "Tornar a pergunta opcional",
        steps: [
          `Marcar a pergunta “${q.label || q.key}” do form “${form.name || form.id}” como opcional — quem não quiser responder consegue avançar.`,
          "A mudança vale na hora na página pública do form.",
        ],
        execute: () => api.update("forms", form.id, { questions: (form.questions || []).map((x) => (x.key === m.key ? { ...x, required: false } : x)) }),
      },
    };
  }
  const live = (adObjects?.campaigns || []).find((c) => String(c.id) === String(m.campaign) || (c.name && c.name === m.campaign));
  const active = live && (live.effectiveStatus || live.status) === "ACTIVE";
  if (m.kind === "pauseCampaign" && active) {
    return {
      ...it,
      action: {
        label: "Pausar campanha",
        steps: [`Pausar a campanha “${live.name}” na Meta — todos os conjuntos e anúncios dela param de veicular na hora; dá pra reativar na tela Publicidade.`],
        execute: () => api.metaObjectStatus(live.id, "PAUSED"),
      },
    };
  }
  if (m.kind === "raiseCampaignBudget" && active) {
    const bump = (v) => Math.ceil(v * 1.2);
    if (live.dailyBudget > 0) {
      return {
        ...it,
        action: {
          label: "Subir orçamento (+20%)",
          steps: [`Campanha “${live.name}” (orçamento na campanha): diário ${moneyBRL(live.dailyBudget)} → ${moneyBRL(bump(live.dailyBudget))} (+20%), aplicado direto no Gerenciador da Meta.`],
          execute: () => api.metaObjectBudget(live.id, bump(live.dailyBudget)),
        },
      };
    }
    const targets = (adObjects?.adsets || []).filter((s) => String(s.campaignId) === String(live.id) && s.dailyBudget > 0 && s.status !== "PAUSED");
    if (!targets.length) return it;
    return {
      ...it,
      action: {
        label: "Subir orçamento (+20%)",
        steps: targets.map((s) => `Conjunto “${s.name}”: orçamento diário ${moneyBRL(s.dailyBudget)} → ${moneyBRL(bump(s.dailyBudget))} (+20%), aplicado direto no Gerenciador da Meta.`),
        execute: async () => { for (const s of targets) await api.metaObjectBudget(s.id, bump(s.dailyBudget)); },
      },
    };
  }
  return it;
}

// ── Dashboard de métricas (visão principal da tela) ─────────────────────────
// Seletor de form (quando há mais de um publicado), filtros completos (hoje/
// ontem/3/7/30/tudo + data personalizada), tiles do topo, RESULTADOS DOS
// TESTES A/B agrupados por dor (veredito de campeã por grupo) e o funil de
// drop-off. A lista de forms fica logo abaixo, só gestão.
const DASH_PRESETS = [["hoje", "hoje"], ["ontem", "ontem"], ["3", "3 dias"], ["7", "7 dias"], ["30", "30 dias"], ["", "tudo"]];

function FormsDashboard({ forms }) {
  const [formId, setFormId] = useState(forms[0]?.id);
  const form = forms.find((f) => f.id === formId) || forms[0];
  const [preset, setPreset] = useState("30"); // chave em DASH_PRESETS ou "custom"
  const [custom, setCustom] = useState({ since: "", until: "" });
  const [data, setData] = useState(null);

  const dayStart = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.toISOString(); };
  const dayEnd = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x.toISOString(); };
  // Range SEMPRE ancorado em fronteira de dia: o valor é estável entre
  // re-renders (um since com Date.now() cru mudava a cada tick do tempo real,
  // re-disparava o fetch e fazia a tela piscar "carregando…" sem parar).
  const range = (() => {
    const now = new Date();
    if (preset === "hoje") return { since: dayStart(now), until: "" };
    if (preset === "ontem") { const y = new Date(now); y.setDate(y.getDate() - 1); return { since: dayStart(y), until: dayEnd(y) }; }
    if (preset === "custom") {
      return {
        since: custom.since ? dayStart(custom.since + "T12:00:00") : "",
        until: custom.until ? dayEnd(custom.until + "T12:00:00") : "",
      };
    }
    if (!preset) return { since: "", until: "" };
    const from = new Date(now); from.setDate(from.getDate() - (Number(preset) - 1));
    return { since: dayStart(from), until: "" }; // "últimos N dias" = N dias corridos incluindo hoje
  })();

  useEffect(() => {
    if (!form) return;
    setData(null);
    api.formFunnel(form.id, range).then(setData).catch(() => setData({ error: true }));
  }, [form?.id, range.since, range.until]); // eslint-disable-line react-hooks/exhaustive-deps

  // Campanha nos eventos chega como id dinâmico da Meta — resolve pra nome.
  const cat = useAttribution(form?.saas, !!(data && !data.error && data.origins?.length));

  // Estado VIVO da conta de anúncios (mesma listagem do card Anúncios da
  // Publicidade): valida se a campanha de um insight de origem ainda veicula
  // antes de oferecer o "aplicar" e dá nome/orçamento pros passos do popup.
  // Falha (sem permissão de metrics, Meta fora) só tira os botões de ação.
  const [adObjects, setAdObjects] = useState(null);
  const saasProd = (window.SEED?.SAAS || []).find((x) => x.id === form?.saas);
  const wantAds = !!(saasProd?.metaAdAccount && data && !data.error && (data.origins || []).length);
  const fetchAdObjects = () => api.adObjects(form.saas).then((v) => { if (!v?.error) setAdObjects(v); }).catch(() => { /* insights ficam informativos */ });
  useEffect(() => { setAdObjects(null); }, [form?.saas]);
  useEffect(() => { if (wantAds) fetchAdObjects(); }, [wantAds, form?.saas]); // eslint-disable-line react-hooks/exhaustive-deps

  const formInsights = (data && !data.error ? buildFormInsights(data, form, cat) : [])
    .map((it) => withFormInsightAction(it, { form, adObjects }));

  if (!form) return null;
  const painMap = ((window.SEED?.SAAS || []).find((x) => x.id === form.saas) || {}).painMap || {};
  const rows = data && !data.error ? [
    { label: "Abriu a página", sessions: data.views, mono: true },
    ...(form.welcome ? [{ label: "Clicou em começar", sessions: data.starts, mono: true }] : []),
    ...(data.steps || []).map((st, i) => ({ label: st.label, sessions: st.sessions, insight: st.insight, n: i + 1 })),
    { label: "Enviou o form", sessions: data.submits, mono: true },
  ] : [];
  const top = rows.length ? Math.max(rows[0].sessions, 1) : 1;
  const pct = (a, b) => (b > 0 ? ((a / b) * 100).toFixed(1).replace(".", ",") + "%" : "0%");
  const tile = (label, value, sub) => (
    <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", padding: "10px 13px", background: "var(--bg-1)" }}>
      <span className="mono" style={{ display: "block", fontSize: 9.5, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--fg-4)" }}>{label}</span>
      <span className="tnum" style={{ display: "block", fontFamily: "var(--display)", fontSize: 22, fontWeight: 700, marginTop: 2 }}>{value}</span>
      {sub && <span className="mono" style={{ display: "block", fontSize: 10, color: "var(--fg-4)", marginTop: 1 }}>{sub}</span>}
    </div>
  );
  const dateInput = (key) => (
    <input type="date" value={custom[key]}
      onChange={(e) => { setCustom((c) => ({ ...c, [key]: e.target.value })); setPreset("custom"); }}
      style={{ height: 24, padding: "0 6px", borderRadius: "var(--r-2)", fontSize: 10.5, fontFamily: "var(--mono)",
        border: "1px solid " + (preset === "custom" ? "var(--accent-line)" : "var(--line-1)"),
        background: "var(--bg-1)", color: "var(--fg-1)" }} />
  );

  // Testes A/B agrupados por dor (base primeiro) — visão completa por grupo.
  const variants = data && !data.error ? (data.variants || []) : [];
  const verdicts = championVerdicts(variants);
  const groups = [];
  for (const v of variants) {
    const key = v.pain || "";
    let g = groups.find((x) => x.pain === key);
    if (!g) { g = { pain: key, rows: [] }; groups.push(g); }
    g.rows.push(v);
  }
  groups.sort((a, b) => (a.pain === "" ? -1 : b.pain === "" ? 1 : a.pain.localeCompare(b.pain)));
  const vDefs = [
    ...(form.welcome?.variants || []),
    ...Object.values(form.welcome?.byPain || {}).flatMap((pn) => pn.variants || []),
  ];
  const titleOf = (v) => vDefs.find((d) => String(d.id) === String(v.id))?.title
    || form.welcome?.byPain?.[v.pain]?.title || form.welcome?.title || v.id;
  const thAB = (h, i) => (
    <th key={h + i} className="mono" style={{ textAlign: i < 2 ? "left" : "right", fontSize: 10, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--fg-4)", padding: "6px 8px", borderBottom: "1px solid var(--line-1)" }}>{h}</th>
  );
  const tdAB = { padding: "7px 8px", fontSize: 12, textAlign: "right", borderBottom: "1px solid var(--line-1)" };

  return (
    <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", background: "var(--bg-1)", padding: "14px 16px 16px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {forms.length > 1 ? (
          <select value={form.id} onChange={(e) => setFormId(e.target.value)}
            style={{ height: 26, padding: "0 8px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 12.5, fontWeight: 600 }}>
            {forms.map((f) => <option key={f.id} value={f.id}>{f.name || f.id}</option>)}
          </select>
        ) : (
          <span style={{ fontSize: 14, fontWeight: 600 }}>{form.name}</span>
        )}
        <span className="mono dim" style={{ fontSize: 10.5 }}>métricas · testes A/B · funil</span>
        <span style={{ flex: 1 }} />
        {DASH_PRESETS.map(([v, label]) => (
          <button key={v || "all"} onClick={() => setPreset(v)} className="mono" style={{
            height: 24, padding: "0 10px", borderRadius: "var(--r-2)", fontSize: 11,
            border: "1px solid " + (preset === v ? "var(--line-strong)" : "var(--line-1)"),
            background: preset === v ? "var(--bg-3)" : "var(--bg-2)",
            color: preset === v ? "var(--fg-1)" : "var(--fg-3)",
          }}>{label}</button>
        ))}
        {dateInput("since")}
        <span className="mono dim" style={{ fontSize: 10 }}>até</span>
        {dateInput("until")}
      </div>

      {!data && <div className="mono dim" style={{ fontSize: 12 }}>carregando…</div>}
      {data?.error && <div className="mono" style={{ fontSize: 12, color: "var(--neg)" }}>Falha ao carregar as métricas.</div>}

      {data && !data.error && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginBottom: 14 }}>
          {tile("Visitas", window.fmt.int(data.views))}
          {tile("Começaram", window.fmt.int(data.starts), pct(data.starts, data.views) + " das visitas")}
          {tile("Enviaram", window.fmt.int(data.submits), pct(data.submits, Math.max(data.starts, 1)) + " dos que começaram")}
          {tile("Conversão", pct(data.submits, data.views), "envios ÷ visitas")}
        </div>
      )}

      {data && !data.error && (
        <InsightsList items={formInsights} scope={`form:${form.id}`}
          style={{ marginBottom: 14 }}
          onApplied={() => { if (wantAds) fetchAdObjects(); }}
          header={
            <div className="mono" style={{ fontSize: 10.5, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--fg-3)", marginBottom: 8 }}>
              Insights do funil · aplicar mostra os passos e pede confirmação · ✕ dispensa por 7 dias
            </div>
          } />
      )}

      {data && !data.error && groups.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div className="mono" style={{ fontSize: 10.5, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--fg-3)", marginBottom: 8 }}>
            Resultados dos testes A/B · por dor
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {groups.map((g) => {
              const leader = g.rows.map((v) => verdicts[`${v.pain || ""}|${v.id}`]).find((x) => x?.label);
              return (
                <div key={g.pain || "base"} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-inset)", padding: "10px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                    <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", border: "1px solid var(--accent-line)", borderRadius: 5, padding: "1px 7px" }}>
                      {g.pain ? `[${g.pain}]` : "BASE"}
                    </span>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{g.pain ? (painMap[g.pain] || "dor " + g.pain) : "Sem dor identificada (tráfego direto)"}</span>
                    <span style={{ flex: 1 }} />
                    {leader && <span className="mono" style={{ fontSize: 10.5, fontWeight: 600, color: leader.tone }}>{leader.label}</span>}
                  </div>
                  <div className="tbl-x">
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead><tr>{["Variante", "Título mostrado", "Visitas", "Começou", "% começar", "Enviou", "% envio", "Ganhos", "% fechou"].map(thAB)}</tr></thead>
                      <tbody>
                        {g.rows.map((v) => {
                          const verdict = verdicts[`${v.pain || ""}|${v.id}`];
                          const isLeader = !!verdict?.label;
                          return (
                            <tr key={v.id}>
                              <td className="mono" style={{ ...tdAB, textAlign: "left", fontWeight: 700, color: isLeader ? "var(--fg-1)" : "var(--fg-2)" }}>{v.id}</td>
                              <td style={{ ...tdAB, textAlign: "left", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--fg-2)" }} title={titleOf(v)}>{titleOf(v)}</td>
                              <td className="mono tnum" style={tdAB}>{v.views}</td>
                              <td className="mono tnum" style={tdAB}>{v.starts}</td>
                              <td className="mono tnum" style={{ ...tdAB, fontWeight: 600 }}>{v.views > 0 ? pct(v.starts, v.views) : ""}</td>
                              <td className="mono tnum" style={tdAB}>{v.submits}</td>
                              <td className="mono tnum" style={tdAB}>{v.views > 0 ? pct(v.submits, v.views) : ""}</td>
                              <td className="mono tnum" style={tdAB}>{v.won || 0}</td>
                              <td className="mono tnum" style={tdAB}>{v.leads > 0 ? pct(v.won, v.leads) : ""}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mono dim" style={{ fontSize: 10.5, marginTop: 6, lineHeight: 1.6 }}>
            regras da campeã: ≥100 visitas e ≥7 dias na líder · ≥95% de confiança na % de começar vs. a vice (z de 2 proporções) · sem regressão de envio nem de ganhos. Campeã eleita: promova a copy pro texto base e remova as variantes; teste novo = variante nova (numeração nunca repete).
          </div>
        </div>
      )}

      {data && !data.error && (data.origins || []).length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div className="mono" style={{ fontSize: 10.5, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--fg-3)", marginBottom: 8 }}>
            Origens do tráfego · drop-off por anúncio (orgânico entra pelo referrer: google, instagram, site)
          </div>
          <div className="tbl-x" style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-inset)", padding: "4px 12px 8px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["Origem", "Anúncio", "Visitas", "Começou", "% começar", "Enviou", "% envio"].map(thAB)}</tr></thead>
              <tbody>
                {data.origins.map((o, i) => (
                  <tr key={i}>
                    <td className="mono" style={{ ...tdAB, textAlign: "left", fontWeight: 600 }}>{o.source || "(sem source)"}</td>
                    <td style={{ ...tdAB, textAlign: "left", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--fg-2)" }} title={originAdLabel(o, cat)}>
                      {originAdLabel(o, cat)}
                    </td>
                    <td className="mono tnum" style={tdAB}>{o.views}</td>
                    <td className="mono tnum" style={tdAB}>{o.starts}</td>
                    <td className="mono tnum" style={{ ...tdAB, fontWeight: 600 }}>{o.views > 0 ? pct(o.starts, o.views) : ""}</td>
                    <td className="mono tnum" style={tdAB}>{o.submits}</td>
                    <td className="mono tnum" style={tdAB}>{o.views > 0 ? pct(o.submits, o.views) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data && !data.error && rows[0].sessions > 0 && (
        <div>
          <div className="mono" style={{ fontSize: 10.5, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--fg-3)", marginBottom: 8 }}>
            Funil de drop-off por etapa
          </div>
          <div className="tbl-x" style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-inset)" }}>
            {rows.map((r, i) => {
              const prev = i > 0 ? rows[i - 1].sessions : null;
              const drop = prev > 0 ? Math.round((1 - r.sessions / prev) * 100) : 0;
              return (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "220px 1fr 60px 70px", gap: 12, alignItems: "center", padding: "9px 12px", borderBottom: "1px solid var(--line-1)", opacity: r.insight ? 0.6 : 1 }}>
                  <span className={r.mono ? "mono dim" : ""} style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.label}>
                    {r.n ? `${String(r.n).padStart(2, "0")} · ` : ""}{r.label}{r.insight ? " (insight)" : ""}
                  </span>
                  <div style={{ height: 8, background: "var(--bg-1)", borderRadius: 999, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.round((r.sessions / top) * 100)}%`, background: "var(--accent)", borderRadius: 999 }} />
                  </div>
                  <span className="mono tnum" style={{ fontSize: 12, textAlign: "right" }}>{r.sessions}</span>
                  <span className="mono tnum" style={{ fontSize: 11, textAlign: "right", color: drop > 0 ? "var(--neg)" : "var(--fg-4)" }}>
                    {prev != null && prev > 0 ? `-${Math.max(drop, 0)}%` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {data && !data.error && rows.length > 0 && !rows[0].sessions && (
        <div className="mono dim" style={{ fontSize: 12 }}>Nenhum evento no período selecionado.</div>
      )}
    </div>
  );
}

export { FormsScreen };
