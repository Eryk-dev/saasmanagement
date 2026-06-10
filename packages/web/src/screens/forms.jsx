import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { chromeBtnStyleSmall } from "../lib/ui.js";
import { EmptyState, PrimaryButton, RowActions } from "../atoms.jsx";
import { inputStyle, labelStyle, sectionTitle, cardStyle, addBtnStyle, THEME_DEFAULTS, LabeledInput, ThemeEditor } from "../components/theme-inputs.jsx";
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
  const [active, setActive] = useState(saasId || SAAS[0]?.id);
  const [forms, setForms] = useState([]);
  const [counts, setCounts] = useState({}); // formId -> nº de respostas
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
  }, [active]);

  useEffect(() => { load(); }, [load, version]);

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
        <PrimaryButton onClick={() => setView({ mode: "edit", form: null })}>+ novo form</PrimaryButton>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
        {!forms.length ? (
          <EmptyState
            title="Nenhum form neste SaaS"
            hint="Crie um formulário de captação: uma pergunta por vez, com branching e o tema da marca. Cada resposta vira um lead no pipeline."
            action={<PrimaryButton onClick={() => setView({ mode: "edit", form: null })}>+ Criar form</PrimaryButton>}
          />
        ) : (
          <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", overflow: "hidden", background: "var(--bg-1)" }}>
            <div className="mono" style={{ display: "grid", gridTemplateColumns: "1fr 110px 90px 90px 300px", padding: "10px 14px", background: "var(--bg-inset)", fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase", borderBottom: "1px solid var(--line-1)" }}>
              <span>Form</span><span>Status</span><span>Perguntas</span><span>Respostas</span><span style={{ textAlign: "right" }}>Ações</span>
            </div>
            {forms.map((f) => {
              const pub = f.status === "published";
              return (
                <div key={f.id} style={{ display: "grid", gridTemplateColumns: "1fr 110px 90px 90px 300px", padding: "10px 14px", borderBottom: "1px solid var(--line-1)", alignItems: "center", fontSize: 13 }}>
                  <span style={{ fontWeight: 500 }}>{f.name || f.id}</span>
                  <span><span className={"chip " + (pub ? "pos" : "")} style={{ height: 20 }}>{pub ? "publicado" : "rascunho"}</span></span>
                  <span className="mono tnum dim">{(f.questions || []).length}</span>
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
    thanks: { title: "Recebido! Obrigado.", subtitle: "", redirectUrl: "" },
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
    <div style={{ flex: 1, display: "grid", gridTemplateColumns: "minmax(440px, 1fr) minmax(380px, 46%)", minHeight: 0 }}>
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

          <div style={sectionTitle}>Tela final</div>
          <div style={cardStyle}>
            <LabeledInput label="Título" value={draft.thanks?.title || ""} onChange={(v) => set({ thanks: { ...draft.thanks, title: v } })} />
            <LabeledInput label="Subtítulo" value={draft.thanks?.subtitle || ""} onChange={(v) => set({ thanks: { ...draft.thanks, subtitle: v } })} />
            <LabeledInput label="Redirecionar para (URL, opcional)" value={draft.thanks?.redirectUrl || ""} onChange={(v) => set({ thanks: { ...draft.thanks, redirectUrl: v } })} placeholder="https://…" />
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

  // Destinos de branching: outra pergunta ou o fim. Exclui a própria pergunta.
  const jumpOptions = (selfKey) => [
    { value: "", label: "(próxima pergunta)" },
    ...questions.filter((q) => q.key && q.key !== selfKey).map((q) => ({ value: q.key, label: `→ ${q.label || q.key}` })),
    { value: "_end", label: "→ fim do form" },
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
                  if (!q._keyTouched) patch.key = slug(e.target.value);
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
      <button type="button" onClick={() => onChange([...questions, { key: "", label: "", type: "text", required: false, options: [] }])} style={addBtnStyle}>+ adicionar pergunta</button>
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
      <div style={{ padding: "12px 24px", borderBottom: "1px solid var(--line-1)", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} style={chromeBtnStyleSmall}><span style={{ fontSize: 12 }}>← forms</span></button>
        <div>
          <div style={{ fontSize: 15, fontWeight: 500 }}>{form.name}</div>
          <div className="mono dim" style={{ fontSize: 11 }}>{subs ? `${subs.length} resposta${subs.length === 1 ? "" : "s"}` : "carregando…"}</div>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
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

export { FormsScreen };
