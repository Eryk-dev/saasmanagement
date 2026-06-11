import React from "react";
// Átomos compartilhados pelos builders (forms + propostas): inputs rotulados,
// cor, fonte (Google Fonts) e os defaults do tema por marca.

const { useState } = React;

export const inputStyle = {
  width: "100%", height: 30, padding: "0 8px",
  background: "var(--bg-2)", border: "1px solid var(--line-1)",
  borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 13, fontFamily: "var(--sans)",
};
export const labelStyle = { fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase" };
export const sectionTitle = { fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg-4)", margin: "18px 0 8px" };
export const cardStyle = { border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", padding: 10, display: "flex", flexDirection: "column", gap: 8, background: "var(--bg-2)" };
export const addBtnStyle = { alignSelf: "flex-start", padding: "5px 10px", background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", fontSize: 11, fontFamily: "var(--mono)", color: "var(--fg-2)" };

export const THEME_DEFAULTS = { bg: "#0f1115", surface: "#181b22", fg: "#f2f3f5", accent: "#6c5ce7", accentFg: "#ffffff", font: "", radius: 10, logoUrl: "", logoHeight: 24 };

// Fontes curadas (Google Fonts) — as páginas públicas carregam a família
// primária do tema automaticamente; qualquer fonte do catálogo via custom.
export const FONT_CHOICES = ["Space Grotesk", "Inter", "Poppins", "Montserrat", "DM Sans", "Manrope", "Sora", "Playfair Display"];
export const fontFamilyOf = (font) => String(font || "").split(",")[0].trim().replace(/^['"]|['"]$/g, "");
export const fontValueOf = (name) => `'${name}', system-ui, sans-serif`;

export function LabeledInput({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
      <span className="mono" style={labelStyle}>{label}</span>
      <input type={type} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
    </label>
  );
}

export function LabeledTextarea({ label, value, onChange, placeholder, rows = 2 }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
      <span className="mono" style={labelStyle}>{label}</span>
      <textarea value={value ?? ""} placeholder={placeholder} rows={rows} onChange={(e) => onChange(e.target.value)}
        style={{ ...inputStyle, height: "auto", minHeight: 48, padding: "6px 8px", resize: "vertical" }} />
    </label>
  );
}

export function ColorInput({ label, value, onChange }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span className="mono" style={labelStyle}>{label}</span>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input type="color" value={value || "#000000"} onChange={(e) => onChange(e.target.value)} style={{ width: 30, height: 30, padding: 0, border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-2)" }} />
        <input value={value ?? ""} onChange={(e) => onChange(e.target.value)} className="mono" style={{ ...inputStyle, fontSize: 12 }} />
      </div>
    </label>
  );
}

export function FontPicker({ value, onChange }) {
  const fam = fontFamilyOf(value);
  const isCurated = !fam || FONT_CHOICES.includes(fam);
  const [custom, setCustom] = useState(!isCurated);
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span className="mono" style={labelStyle}>Fonte da marca</span>
      <div style={{ display: "flex", gap: 6 }}>
        <select
          value={custom ? "_custom" : (fam || "Space Grotesk")}
          onChange={(e) => {
            if (e.target.value === "_custom") { setCustom(true); return; }
            setCustom(false);
            onChange(fontValueOf(e.target.value));
          }}
          style={{ ...inputStyle, width: custom ? 130 : "100%" }}
        >
          {FONT_CHOICES.map((f) => <option key={f} value={f}>{f}</option>)}
          <option value="_custom">outra…</option>
        </select>
        {custom && (
          <input
            value={fam} placeholder="Nome no Google Fonts"
            onChange={(e) => onChange(e.target.value ? fontValueOf(e.target.value) : "")}
            style={{ ...inputStyle, flex: 1 }}
          />
        )}
      </div>
    </label>
  );
}

// Grade de tema completa (8 tokens) — usada pelos dois builders.
export function ThemeEditor({ theme, onChange }) {
  const set = (k, v) => onChange({ ...theme, [k]: v });
  return (
    <div style={{ ...cardStyle, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      <ColorInput label="Fundo" value={theme.bg} onChange={(v) => set("bg", v)} />
      <ColorInput label="Superfície" value={theme.surface} onChange={(v) => set("surface", v)} />
      <ColorInput label="Texto" value={theme.fg} onChange={(v) => set("fg", v)} />
      <ColorInput label="Acento" value={theme.accent} onChange={(v) => set("accent", v)} />
      <ColorInput label="Texto no acento" value={theme.accentFg} onChange={(v) => set("accentFg", v)} />
      <LabeledInput label="Raio (px)" type="number" value={theme.radius} onChange={(v) => set("radius", v === "" ? "" : Number(v))} />
      <FontPicker value={theme.font} onChange={(v) => set("font", v)} />
      <LabeledInput label="Logo (URL)" value={theme.logoUrl} onChange={(v) => set("logoUrl", v)} placeholder="https://…/logo.svg" />
      <LabeledInput label="Logo · altura (px)" type="number" value={theme.logoHeight} onChange={(v) => set("logoHeight", v === "" ? "" : Number(v))} placeholder="24" />
    </div>
  );
}
