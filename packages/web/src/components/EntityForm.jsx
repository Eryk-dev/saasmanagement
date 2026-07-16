import React from "react";
import { ENTITIES, leadQuestionFields, customEntityFields } from "../lib/entities.js";
import { api } from "../lib/api.js";
// Reusable create/edit modal, driven by the per-entity config in entities.js.
// Mirrors deal.jsx's right-drawer overlay. Create vs edit is decided by record.id.

const { useState, useEffect } = React;

const inputStyle = {
  width: "100%", height: 30, padding: "0 8px",
  background: "var(--bg-2)", border: "1px solid var(--line-1)",
  borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 13, fontFamily: "var(--sans)",
};

// Valor sentinela do select "Outro (digitar)…" — nunca é gravado; ao escolher,
// o campo vira texto livre e o que for digitado é salvo direto na chave.
const CUSTOM_OPT = "__outro__";

function resolveOptions(field, values) {
  const o = field.options;
  return (typeof o === "function" ? o(values) : o) || [];
}

// `cfg.fields` é estático; o formulário acrescenta os campos dinâmicos do SaaS
// selecionado: perguntas de qualificação (leads) + campos custom de Ajustes
// (deals/customers/leads). Esta lista efetiva dirige render, validação e payload.
function effectiveFields(cfg, values) {
  const extra = ["leads", "deals", "customers"].includes(cfg.collection)
    ? customEntityFields(cfg.collection, values.saas)
    : [];
  if (cfg.collection === "leads") return [...cfg.fields, ...leadQuestionFields(values.saas), ...extra];
  return [...cfg.fields, ...extra];
}

// Vazio para validação de obrigatório: array sem itens conta como vazio.
function isBlank(val) {
  return Array.isArray(val) ? val.length === 0 : String(val ?? "").trim() === "";
}

// record → input-string values (recebe a lista de fields efetiva)
function toInputs(fields, record) {
  const v = {};
  for (const f of fields) {
    const cur = record ? record[f.key] : undefined;
    const val = cur !== undefined && cur !== null ? cur : f.default;
    if (f.type === "funnel") {
      v[f.key] = Array.isArray(cur) ? cur.map((x) => ({ ...x })) : [];
    } else if (f.type === "questions") {
      v[f.key] = Array.isArray(cur) ? cur.map((q) => ({ ...q, options: (q.options || []).map((o) => ({ ...o })) })) : [];
    } else if (f.type === "multiselect") {
      v[f.key] = Array.isArray(cur) ? [...cur] : [];
    } else if (f.type === "tags") {
      v[f.key] = Array.isArray(cur) ? cur.join(", ") : "";
    } else if (f.type === "pct") {
      v[f.key] = val == null || val === "" ? "" : String(+(Number(val) * 100).toFixed(4));
    } else if (f.type === "bool") {
      v[f.key] = val === true || val === "true" ? "true" : "false";
    } else if (f.type === "date") {
      v[f.key] = val == null ? "" : String(val).slice(0, 10); // ISO completo → YYYY-MM-DD do input nativo
    } else if (f.type === "datetime") {
      v[f.key] = val == null ? "" : String(val).slice(0, 16); // ISO → YYYY-MM-DDTHH:mm do datetime-local
    } else {
      v[f.key] = val == null ? "" : String(val);
    }
  }
  return v;
}

// input-string values → API payload. Blanks are omitted so create falls back to
// the backend defaults and edit keeps untouched fields via merge.
function toPayload(fields, values) {
  const out = {};
  for (const f of fields) {
    const raw = values[f.key];
    if (f.type === "funnel") {
      // Mantém props derivadas (count/flag) via spread; só nome + conv são editados.
      // conv guardado como fração; 1º estágio é a entrada (conv ignorado na previsão).
      const rows = (raw || [])
        .filter((s) => String(s.stage || "").trim())
        .map((s, i) => {
          const conv = i === 0 || s.conv === "" || s.conv == null || Number.isNaN(Number(s.conv)) ? 1 : Number(s.conv);
          return { ...s, stage: s.stage.trim(), conv };
        });
      if (rows.length) out[f.key] = rows;
      continue;
    }
    if (f.type === "questions") {
      // Editor de perguntas do pipeline: normaliza chave/rótulo/tipo/obrigatório + opções.
      const rows = (raw || [])
        .filter((q) => String(q.key || "").trim() && String(q.label || "").trim())
        .map((q) => {
          const base = { key: q.key.trim(), label: q.label.trim(), type: q.type || "text", required: !!q.required };
          if (q.type === "select" || q.type === "multiselect") {
            base.options = (q.options || [])
              .filter((o) => String(o.value || "").trim())
              .map((o) => ({ value: o.value.trim(), label: String(o.label || o.value).trim() }));
          }
          if (q.type === "select") base.allowCustom = !!q.allowCustom;
          return base;
        });
      out[f.key] = rows; // sempre grava (permite limpar para [])
      continue;
    }
    if (f.type === "multiselect") {
      const arr = Array.isArray(raw) ? raw : [];
      if (arr.length) out[f.key] = arr; // array de respostas (ex.: marketplaces)
      continue;
    }
    if (f.type === "tags") {
      const arr = String(raw || "").split(",").map((t) => t.trim()).filter(Boolean);
      if (arr.length) out[f.key] = arr;
      continue;
    }
    if (f.type === "bool") { out[f.key] = raw === "true"; continue; }
    if (raw === "" || raw == null) continue;
    if (f.type === "number" || f.type === "money") {
      const n = Number(raw);
      if (!Number.isNaN(n)) out[f.key] = n;
    } else if (f.type === "pct") {
      const n = Number(raw);
      if (!Number.isNaN(n)) out[f.key] = n / 100;
    } else if (f.type === "datetime") {
      // datetime-local (naive) → ISO UTC, formato dos campos de agenda do GPS.
      const d = new Date(raw);
      if (Number.isFinite(d.getTime())) out[f.key] = d.toISOString();
    } else {
      out[f.key] = raw;
    }
  }
  return out;
}

function EntityForm({ entityKey, record, onClose, onSaved }) {
  const cfg = ENTITIES[entityKey];
  const isEdit = !!(record && record.id);
  const [values, setValues] = useState(() => toInputs(effectiveFields(cfg, record || {}), record));
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  const set = (key, val) => setValues((v) => ({ ...v, [key]: val }));

  // Ao trocar de SaaS no form, semeia em branco os campos dinâmicos que aparecem
  // (perguntas do pipeline + campos custom), sem apagar valores já digitados.
  useEffect(() => {
    setValues((v) => {
      let changed = false;
      const next = { ...v };
      for (const f of effectiveFields(cfg, v)) {
        if (f._dynamic && next[f.key] === undefined) {
          next[f.key] = f.type === "multiselect" ? [] : "";
          changed = true;
        }
      }
      return changed ? next : v;
    });
  }, [values.saas]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e) {
    e.preventDefault();
    const eff = effectiveFields(cfg, values);
    const missing = eff
      .filter((f) => f.required && isBlank(values[f.key]))
      .map((f) => f.label);
    if (missing.length) { setError("Preencha: " + missing.join(", ")); return; }
    setBusy(true); setError(null);
    try {
      const payload = toPayload(eff, values);
      if (isEdit) {
        await api.update(cfg.collection, record.id, payload);
      } else {
        const created = await api.create(cfg.collection, payload);
        // Best-effort: ao criar um lead, dispara a geração da proposta no Levercopy.
        // O servidor decide a elegibilidade (saas/config) e nunca quebra a criação —
        // se falhar, o lead já existe e o botão "Gerar proposta" cobre a 2ª tentativa.
        if (cfg.collection === "leads" && created?.id) {
          setGenerating(true);
          try { await api.generateProposal(created.id, { auto: true }); } catch { /* fail-open */ }
        }
      }
      await onSaved(); // App closes the modal + refreshes (this component unmounts)
    } catch (err) {
      setBusy(false);
      setError(err.message || String(err));
    }
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "oklch(0 0 0 / 0.4)", display: "flex", justifyContent: "flex-end", zIndex: 70 }}
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{ width: "min(560px, 100vw)", height: "100%", background: "var(--bg-1)", borderLeft: "1px solid var(--line-2)", display: "flex", flexDirection: "column", boxShadow: "var(--shadow-pop)" }}
      >
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="mono dim" style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>{isEdit ? "Editar" : "Novo"}</div>
            <div style={{ fontSize: 18, fontWeight: 500, marginTop: 2 }}>{cfg.singular}</div>
          </div>
          <button type="button" onClick={onClose} className="mono dim" style={{ fontSize: 16 }}>✕</button>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            {effectiveFields(cfg, values).map((f) => (
              <Field key={f.key} f={f} value={values[f.key]} values={values} recordId={record?.id} onChange={(val) => set(f.key, val)} />
            ))}
          </div>
        </div>

        <div style={{ padding: "12px 20px", borderTop: "1px solid var(--line-1)", background: "var(--bg-inset)" }}>
          {error && <div className="mono" style={{ fontSize: 11, color: "var(--neg)", marginBottom: 8 }}>{error}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" disabled={busy} style={{ flex: 1, padding: "9px 12px", background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))", borderRadius: "var(--r-2)", fontSize: 13, fontWeight: 500, opacity: busy ? 0.6 : 1 }}>
              {generating ? "Gerando proposta…" : busy ? "Salvando…" : isEdit ? "Salvar" : "Criar"}
            </button>
            <button type="button" onClick={onClose} style={{ padding: "9px 16px", background: "var(--bg-2)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", fontSize: 13 }}>Cancelar</button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Field({ f, value, values, onChange, recordId }) {
  const [customOpen, setCustomOpen] = useState(false); // "Outro (digitar)…" ativo neste select
  let input;
  if (f.type === "textarea") {
    input = <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} rows={3} style={{ ...inputStyle, height: "auto", minHeight: 60, padding: "6px 8px", resize: "vertical" }} />;
  } else if (f.type === "funnel") {
    input = <FunnelEditor stages={value || []} onChange={onChange} />;
  } else if (f.type === "questions") {
    // No pipeline LeverAds as chaves/valores são contrato da proposta → travadas.
    input = <QuestionsEditor questions={value || []} onChange={onChange} lockKeys={recordId === "leverads"} />;
  } else if (f.type === "multiselect") {
    const opts = resolveOptions(f, values);
    const sel = Array.isArray(value) ? value : [];
    const toggle = (val) => onChange(sel.includes(val) ? sel.filter((x) => x !== val) : [...sel, val]);
    input = (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: "4px 0" }}>
        {opts.map((o) => (
          <label key={String(o.value)} style={{ display: "inline-flex", gap: 5, alignItems: "center", fontSize: 12, cursor: "pointer" }}>
            <input type="checkbox" checked={sel.includes(o.value)} onChange={() => toggle(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
    );
  } else if (f.type === "bool") {
    input = (
      <select value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
        <option value="false">Não</option>
        <option value="true">Sim</option>
      </select>
    );
  } else if (f.type === "select") {
    const opts = resolveOptions(f, values);
    // allowCustom: opção "Outro (digitar)…" abre um campo de texto e grava a
    // resposta livre no mesmo campo. Valor salvo que não está nas opções (lead
    // antigo com resposta livre) reabre no modo digitado.
    const isCustomValue = f.allowCustom && !isBlank(value) && !opts.some((o) => String(o.value) === String(value));
    const custom = f.allowCustom && (customOpen || isCustomValue);
    input = (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <select
          value={custom ? CUSTOM_OPT : value}
          onChange={(e) => {
            if (e.target.value === CUSTOM_OPT) { setCustomOpen(true); onChange(""); }
            else { setCustomOpen(false); onChange(e.target.value); }
          }}
          style={inputStyle}
        >
          <option value="">{f.blankLabel || "Selecione…"}</option>
          {opts.map((o) => <option key={String(o.value)} value={o.value}>{o.label}</option>)}
          {f.allowCustom && <option value={CUSTOM_OPT}>Outro (digitar)…</option>}
        </select>
        {custom && (
          <input
            type="text" value={value} placeholder="Digite a resposta específica"
            autoFocus={customOpen}
            onChange={(e) => onChange(e.target.value)}
            style={inputStyle}
          />
        )}
      </div>
    );
  } else {
    const numeric = f.type === "number" || f.type === "money" || f.type === "pct";
    input = (
      <div style={{ position: "relative" }}>
        {f.type === "money" && <span className="mono dim" style={{ position: "absolute", left: 8, top: 7, fontSize: 12 }}>R$</span>}
        <input
          type={numeric ? "number" : f.type === "date" ? "date" : f.type === "datetime" ? "datetime-local" : "text"} step="any"
          value={value} placeholder={f.placeholder}
          onChange={(e) => onChange(e.target.value)}
          style={{ ...inputStyle, paddingLeft: f.type === "money" ? 28 : 8, paddingRight: f.type === "pct" ? 22 : 8 }}
        />
        {f.type === "pct" && <span className="mono dim" style={{ position: "absolute", right: 8, top: 7, fontSize: 12 }}>%</span>}
      </div>
    );
  }
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: f.full ? "1 / -1" : "auto" }}>
      <span className="mono" style={{ fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {f.label}{f.required && <span style={{ color: "var(--neg)" }}> *</span>}
      </span>
      {input}
      {f.help && <span className="mono dim" style={{ fontSize: 10 }}>{f.help}</span>}
    </label>
  );
}

function FunnelEditor({ stages, onChange }) {
  const update = (i, patch) => { const next = [...stages]; next[i] = { ...next[i], ...patch }; onChange(next); };
  const remove = (i) => onChange(stages.filter((_, j) => j !== i));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= stages.length) return;
    const next = [...stages];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const arrowStyle = (disabled) => ({ fontSize: 12, padding: "0 3px", color: "var(--fg-3)", opacity: disabled ? 0.3 : 1, fontFamily: "var(--mono)", cursor: disabled ? "default" : "pointer" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {stages.map((st, i) => {
        const pct = st.conv === "" || st.conv == null ? "" : Math.round(Number(st.conv) * 100);
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className="mono dim tnum" style={{ fontSize: 11, width: 18 }}>{String(i + 1).padStart(2, "0")}</span>
            <input
              value={st.stage || ""} placeholder="Nome do estágio"
              onChange={(e) => update(i, { stage: e.target.value })}
              style={{ ...inputStyle, flex: 1 }}
            />
            {i === 0 ? (
              <span className="mono dim" style={{ fontSize: 10, width: 64, textAlign: "center" }}>entrada</span>
            ) : (
              <div style={{ position: "relative", width: 64 }}>
                <input
                  type="number" step="any" value={pct} placeholder="conv"
                  onChange={(e) => update(i, { conv: e.target.value === "" ? "" : Number(e.target.value) / 100 })}
                  style={{ ...inputStyle, paddingRight: 18, textAlign: "right" }}
                />
                <span className="mono dim" style={{ position: "absolute", right: 6, top: 7, fontSize: 11 }}>%</span>
              </div>
            )}
            <div style={{ display: "flex" }}>
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} style={arrowStyle(i === 0)}>↑</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === stages.length - 1} style={arrowStyle(i === stages.length - 1)}>↓</button>
            </div>
            <button type="button" onClick={() => remove(i)} className="mono dim" style={{ fontSize: 13, padding: "0 6px" }}>✕</button>
          </div>
        );
      })}
      <button type="button" onClick={() => onChange([...stages, { stage: "", conv: 1 }])} style={{ alignSelf: "flex-start", padding: "5px 10px", background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", fontSize: 11, fontFamily: "var(--mono)", color: "var(--fg-2)" }}>+ adicionar estágio</button>
    </div>
  );
}

// Editor de perguntas de qualificação por pipeline (espelha o FunnelEditor). Cada
// pergunta tem chave/rótulo/tipo/obrigatório + opções (para escolha única/múltipla).
// `lockKeys` trava chave + valores das opções (contrato da proposta do LeverAds);
// rótulos seguem editáveis.
function QuestionsEditor({ questions, onChange, lockKeys }) {
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
  const addOpt = (qi) => update(qi, { options: [...(questions[qi].options || []), { value: "", label: "" }] });
  const removeOpt = (qi, oi) => update(qi, { options: (questions[qi].options || []).filter((_, j) => j !== oi) });
  const arrowStyle = (disabled) => ({ fontSize: 12, padding: "0 3px", color: "var(--fg-3)", opacity: disabled ? 0.3 : 1, fontFamily: "var(--mono)", cursor: disabled ? "default" : "pointer" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {questions.map((q, i) => {
        const hasOptions = q.type === "select" || q.type === "multiselect";
        return (
          <div key={i} style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", padding: 10, display: "flex", flexDirection: "column", gap: 6, background: "var(--bg-2)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="mono dim tnum" style={{ fontSize: 11, width: 18 }}>{String(i + 1).padStart(2, "0")}</span>
              <input value={q.key || ""} placeholder="chave" disabled={lockKeys} onChange={(e) => update(i, { key: e.target.value })} title={lockKeys ? "Chave travada neste pipeline (contrato da proposta)" : "Chave enviada ao gerador de proposta"} style={{ ...inputStyle, width: 110, opacity: lockKeys ? 0.6 : 1 }} />
              <input value={q.label || ""} placeholder="Pergunta" onChange={(e) => update(i, { label: e.target.value })} style={{ ...inputStyle, flex: 1 }} />
              <div style={{ display: "flex" }}>
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} style={arrowStyle(i === 0)}>↑</button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === questions.length - 1} style={arrowStyle(i === questions.length - 1)}>↓</button>
              </div>
              <button type="button" onClick={() => remove(i)} className="mono dim" style={{ fontSize: 13, padding: "0 6px" }}>✕</button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, paddingLeft: 24 }}>
              <select value={q.type || "text"} disabled={lockKeys} onChange={(e) => update(i, { type: e.target.value })} style={{ ...inputStyle, width: 150, opacity: lockKeys ? 0.6 : 1 }}>
                <option value="text">Texto</option>
                <option value="number">Número</option>
                <option value="select">Escolha única</option>
                <option value="multiselect">Múltipla escolha</option>
              </select>
              <label style={{ display: "inline-flex", gap: 5, alignItems: "center", fontSize: 12 }}>
                <input type="checkbox" checked={!!q.required} onChange={(e) => update(i, { required: e.target.checked })} />
                obrigatória
              </label>
              {q.type === "select" && (
                <label style={{ display: "inline-flex", gap: 5, alignItems: "center", fontSize: 12 }} title='Acrescenta "Outro (digitar)…" no formulário de lead, que abre um campo de texto livre'>
                  <input type="checkbox" checked={!!q.allowCustom} onChange={(e) => update(i, { allowCustom: e.target.checked })} />
                  aceita resposta livre
                </label>
              )}
            </div>
            {hasOptions && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingLeft: 24 }}>
                {(q.options || []).map((o, oi) => (
                  <div key={oi} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input value={o.value || ""} placeholder="valor" disabled={lockKeys} onChange={(e) => updateOpt(i, oi, { value: e.target.value })} style={{ ...inputStyle, width: 110, opacity: lockKeys ? 0.6 : 1 }} />
                    <input value={o.label || ""} placeholder="Rótulo" onChange={(e) => updateOpt(i, oi, { label: e.target.value })} style={{ ...inputStyle, flex: 1 }} />
                    {!lockKeys && <button type="button" onClick={() => removeOpt(i, oi)} className="mono dim" style={{ fontSize: 13, padding: "0 6px" }}>✕</button>}
                  </div>
                ))}
                {!lockKeys && <button type="button" onClick={() => addOpt(i)} style={{ alignSelf: "flex-start", padding: "4px 8px", background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", fontSize: 11, fontFamily: "var(--mono)", color: "var(--fg-2)" }}>+ opção</button>}
              </div>
            )}
          </div>
        );
      })}
      <button type="button" onClick={() => onChange([...questions, { key: "", label: "", type: "text", required: false, options: [] }])} style={{ alignSelf: "flex-start", padding: "5px 10px", background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", fontSize: 11, fontFamily: "var(--mono)", color: "var(--fg-2)" }}>+ adicionar pergunta</button>
    </div>
  );
}

export { EntityForm };
