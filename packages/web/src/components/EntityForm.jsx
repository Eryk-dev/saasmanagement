import React from "react";
import { ENTITIES } from "../lib/entities.js";
import { api } from "../lib/api.js";
// Reusable create/edit modal, driven by the per-entity config in entities.js.
// Mirrors deal.jsx's right-drawer overlay. Create vs edit is decided by record.id.

const { useState } = React;

const inputStyle = {
  width: "100%", height: 30, padding: "0 8px",
  background: "var(--bg-2)", border: "1px solid var(--line-1)",
  borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 13, fontFamily: "var(--sans)",
};

function resolveOptions(field, values) {
  const o = field.options;
  return (typeof o === "function" ? o(values) : o) || [];
}

// record → input-string values
function toInputs(cfg, record) {
  const v = {};
  for (const f of cfg.fields) {
    const cur = record ? record[f.key] : undefined;
    const val = cur !== undefined && cur !== null ? cur : f.default;
    if (f.type === "funnel") {
      v[f.key] = Array.isArray(cur) ? cur.map((x) => x.stage) : [];
    } else if (f.type === "tags") {
      v[f.key] = Array.isArray(cur) ? cur.join(", ") : "";
    } else if (f.type === "pct") {
      v[f.key] = val == null || val === "" ? "" : String(+(Number(val) * 100).toFixed(4));
    } else if (f.type === "bool") {
      v[f.key] = val === true || val === "true" ? "true" : "false";
    } else {
      v[f.key] = val == null ? "" : String(val);
    }
  }
  return v;
}

// input-string values → API payload. Blanks are omitted so create falls back to
// the backend defaults and edit keeps untouched fields via merge.
function toPayload(cfg, values) {
  const out = {};
  for (const f of cfg.fields) {
    const raw = values[f.key];
    if (f.type === "funnel") {
      const rows = (raw || []).map((s) => s.trim()).filter(Boolean);
      if (rows.length) out[f.key] = rows.map((stage) => ({ stage }));
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
    } else {
      out[f.key] = raw;
    }
  }
  return out;
}

function EntityForm({ entityKey, record, onClose, onSaved }) {
  const cfg = ENTITIES[entityKey];
  const isEdit = !!(record && record.id);
  const [values, setValues] = useState(() => toInputs(cfg, record));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const set = (key, val) => setValues((v) => ({ ...v, [key]: val }));

  async function submit(e) {
    e.preventDefault();
    const missing = cfg.fields
      .filter((f) => f.required && String(values[f.key] ?? "").trim() === "")
      .map((f) => f.label);
    if (missing.length) { setError("Preencha: " + missing.join(", ")); return; }
    setBusy(true); setError(null);
    try {
      const payload = toPayload(cfg, values);
      if (isEdit) await api.update(cfg.collection, record.id, payload);
      else await api.create(cfg.collection, payload);
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
        style={{ width: 560, height: "100%", background: "var(--bg-1)", borderLeft: "1px solid var(--line-2)", display: "flex", flexDirection: "column", boxShadow: "var(--shadow-pop)" }}
      >
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="mono dim" style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>{isEdit ? "Editar" : "Novo"}</div>
            <div style={{ fontSize: 18, fontWeight: 500, marginTop: 2 }}>{cfg.singular}</div>
          </div>
          <button type="button" onClick={onClose} className="mono dim" style={{ fontSize: 16 }}>✕</button>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {cfg.fields.map((f) => (
              <Field key={f.key} f={f} value={values[f.key]} values={values} onChange={(val) => set(f.key, val)} />
            ))}
          </div>
        </div>

        <div style={{ padding: "12px 20px", borderTop: "1px solid var(--line-1)", background: "var(--bg-inset)" }}>
          {error && <div className="mono" style={{ fontSize: 11, color: "var(--neg)", marginBottom: 8 }}>{error}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" disabled={busy} style={{ flex: 1, padding: "9px 12px", background: "var(--accent)", color: "var(--accent-fg)", borderRadius: "var(--r-2)", fontSize: 13, fontWeight: 500, opacity: busy ? 0.6 : 1 }}>
              {busy ? "Salvando…" : isEdit ? "Salvar" : "Criar"}
            </button>
            <button type="button" onClick={onClose} style={{ padding: "9px 16px", background: "var(--bg-2)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", fontSize: 13 }}>Cancelar</button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Field({ f, value, values, onChange }) {
  let input;
  if (f.type === "textarea") {
    input = <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} rows={3} style={{ ...inputStyle, height: "auto", minHeight: 60, padding: "6px 8px", resize: "vertical" }} />;
  } else if (f.type === "funnel") {
    input = <FunnelEditor stages={value || []} onChange={onChange} />;
  } else if (f.type === "bool") {
    input = (
      <select value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
        <option value="false">Não</option>
        <option value="true">Sim</option>
      </select>
    );
  } else if (f.type === "select") {
    const opts = resolveOptions(f, values);
    input = (
      <select value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
        <option value="">{f.blankLabel || "Selecione…"}</option>
        {opts.map((o) => <option key={String(o.value)} value={o.value}>{o.label}</option>)}
      </select>
    );
  } else {
    const numeric = f.type === "number" || f.type === "money" || f.type === "pct";
    input = (
      <div style={{ position: "relative" }}>
        {f.type === "money" && <span className="mono dim" style={{ position: "absolute", left: 8, top: 7, fontSize: 12 }}>R$</span>}
        <input
          type={numeric ? "number" : "text"} step="any"
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
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {stages.map((st, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="mono dim" style={{ fontSize: 11, width: 18 }}>{String(i + 1).padStart(2, "0")}</span>
          <input
            value={st} placeholder="Nome do estágio"
            onChange={(e) => { const next = [...stages]; next[i] = e.target.value; onChange(next); }}
            style={{ ...inputStyle, flex: 1 }}
          />
          <button type="button" onClick={() => onChange(stages.filter((_, j) => j !== i))} className="mono dim" style={{ fontSize: 13, padding: "0 6px" }}>✕</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...stages, ""])} style={{ alignSelf: "flex-start", padding: "5px 10px", background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", fontSize: 11, fontFamily: "var(--mono)", color: "var(--fg-2)" }}>+ adicionar estágio</button>
    </div>
  );
}

export { EntityForm };
