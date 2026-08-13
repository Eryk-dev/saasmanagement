import React from "react";
import { userPhoto } from "./lib/users.js";
// Shared atomic components — pure visuals, no business logic.
// Exposed on window for cross-script use.

// ───────────────────────────────────────────────────── Health Arc (half-gauge)
// Selected by the user — the "option 4" half-arc with score inside.
function HealthArc({ value = 0, size = 72, strokeWidth = 7, label, sublabel, delta, hover }) {
  const r = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size - strokeWidth - 2;   // anchor near bottom
  // Half-arc spans 180°: from (cx - r, cy) to (cx + r, cy)
  const v = Math.max(0, Math.min(100, value));
  const a = (v / 100) * Math.PI;        // radians swept
  const x = cx - r * Math.cos(a);
  const y = cy - r * Math.sin(a);
  const largeArc = a > Math.PI ? 1 : 0;
  const tone =
    v >= 75 ? "var(--pos)" :
    v >= 50 ? "var(--warn)" :
    "var(--neg)";

  // Tick marks at 25, 50, 75
  const ticks = [25, 50, 75].map((t) => {
    const ta = (t / 100) * Math.PI;
    const x1 = cx - (r + 2) * Math.cos(ta);
    const y1 = cy - (r + 2) * Math.sin(ta);
    const x2 = cx - (r - 4) * Math.cos(ta);
    const y2 = cy - (r - 4) * Math.sin(ta);
    return <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--line-2)" strokeWidth="1" />;
  });

  return (
    <div className="health-arc" data-hover={hover ? "1" : "0"} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <svg width={size} height={cy + strokeWidth} aria-label={`Health ${v}`}>
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          stroke="var(--bg-3)"
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
        />
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 ${largeArc} 1 ${x} ${y}`}
          stroke={tone}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
        />
        {ticks}
        <text x={cx} y={cy - 2} textAnchor="middle" fontFamily="var(--mono)" fontSize={size * 0.30} fontWeight={500} fill="var(--fg-1)" className="tnum">
          {v}
        </text>
      </svg>
      {(label || delta != null) && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 11 }}>
          {label && <span className="muted">{label}</span>}
          {delta != null && (
            <span className={"mono tnum " + (delta > 0 ? "" : delta < 0 ? "" : "")} style={{ color: delta > 0 ? "var(--pos)" : delta < 0 ? "var(--neg)" : "var(--fg-3)" }}>
              {delta > 0 ? "+" : ""}{delta}
            </span>
          )}
        </div>
      )}
      {sublabel && <div className="mono dim" style={{ fontSize: 10 }}>{sublabel}</div>}
    </div>
  );
}

// ───────────────────────────────────────────────────── Sparkline
function Sparkline({ data, width = 120, height = 28, stroke, fill, dot = true, baseline }) {
  const vals = data || [];
  if (!vals.length) return <svg width={width} height={height} style={{ display: "block" }} />;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = Math.max(1, max - min);
  const stepX = width / Math.max(1, vals.length - 1);
  const path = vals.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
  const areaPath = path + ` L ${width} ${height} L 0 ${height} Z`;
  const last = vals[vals.length - 1];
  const lastY = height - ((last - min) / range) * (height - 4) - 2;
  const tone = stroke || (vals[vals.length - 1] >= vals[0] ? "var(--pos)" : "var(--neg)");
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      {fill && <path d={areaPath} fill={fill} opacity="0.35" />}
      {baseline != null && (
        <line
          x1={0} x2={width}
          y1={height - ((baseline - min) / range) * (height - 4) - 2}
          y2={height - ((baseline - min) / range) * (height - 4) - 2}
          stroke="var(--line-1)" strokeDasharray="2 2"
        />
      )}
      <path d={path} stroke={tone} strokeWidth={1.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {dot && <circle cx={width} cy={lastY} r={2} fill={tone} />}
    </svg>
  );
}

// ───────────────────────────────────────────────────── Delta number
function Delta({ value, suffix = "", asPct = false, asInt = false, mono = true, neutralAt = 0, inverted = false }) {
  if (value == null) return <span className="dim mono tnum">—</span>;
  const display = asPct ? `${value > 0 ? "+" : ""}${(value * 100).toFixed(0)}%`
                : asInt ? `${value > 0 ? "+" : ""}${value}`
                : `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
  const dir = value === neutralAt ? 0 : value > neutralAt ? 1 : -1;
  const good = inverted ? -dir : dir;
  const color = good === 0 ? "var(--fg-3)" : good > 0 ? "var(--pos)" : "var(--neg)";
  return <span className={(mono ? "mono " : "") + "tnum"} style={{ color }}>{display}{suffix}</span>;
}

// ───────────────────────────────────────────────────── Trend badge
function TrendBadge({ trend }) {
  const map = {
    improving: { label: "Melhorando", cls: "chip pos", glyph: "↑" },
    stable:    { label: "Estável",    cls: "chip",     glyph: "→" },
    worsening: { label: "Piorando", cls: "chip neg", glyph: "↓" },
  };
  const m = map[trend] || map.stable;
  return <span className={m.cls}><span className="mono">{m.glyph}</span>{m.label}</span>;
}

// ───────────────────────────────────────────────────── Severity dot
function SeverityDot({ s }) {
  const c = s === "critical" ? "var(--neg)" :
            s === "high"     ? "var(--accent)" :
            s === "medium"   ? "var(--warn)" :
                               "var(--info)";
  return <span className="dot" style={{ color: c }} />;
}

// ───────────────────────────────────────────────────── Avatar
// Foto de perfil quando o usuário subiu uma (resolvida pelo id no time carregado
// no boot); iniciais como fallback. `photo` explícito atende quem já tem a URL
// em mãos (o preview do "Meu perfil" antes de salvar).
function Avatar({ id, name, size = 22, photo }) {
  const src = photo !== undefined ? photo : userPhoto(id);
  const initials = (name || id || "?")
    .split(" ").map(s => s[0]).join("").slice(0, 2).toUpperCase();
  const base = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: size, height: size, borderRadius: 999,
    background: "var(--bg-2)",
    border: "1px solid var(--line-1)",
    flex: "0 0 auto",
  };
  if (src) {
    return (
      <img
        src={src}
        alt={name || id || ""}
        title={name || id}
        style={{ ...base, objectFit: "cover" }}
      />
    );
  }
  return (
    <span
      style={{ ...base, fontSize: size * 0.4, fontWeight: 600, color: "var(--fg-2)" }}
      title={name || id}
    >
      {initials}
    </span>
  );
}

// ───────────────────────────────────────────────────── Funnel heatmap row
// Heat bars representing volume + conversion. Color tints stage health (cold/warm/hot).
function FunnelHeatmap({ stages, dense }) {
  return (
    <div className="funnel-heat" style={{ display: "grid", gridTemplateColumns: `repeat(${stages.length}, 1fr)`, gap: 4 }}>
      {stages.map((s, i) => (
        <div key={s.k} style={{
          background: "var(--bg-2)",
          border: "1px solid var(--line-1)",
          borderRadius: 4,
          padding: dense ? "4px 6px" : "8px 10px",
          minHeight: dense ? 38 : 56,
          position: "relative",
          overflow: "hidden",
        }}>
          <div style={{
            position: "absolute", inset: 0,
            background: `linear-gradient(180deg, transparent, ${s.tone || "oklch(0.72 0.18 33 / 0.18)"})`,
            opacity: s.heat,
          }} />
          <div style={{ position: "relative" }}>
            <div className="mono tnum" style={{ fontSize: 10, color: "var(--fg-3)" }}>{String(i+1).padStart(2,"0")} {s.k}</div>
            <div className="mono tnum" style={{ fontSize: dense ? 14 : 18, marginTop: 2 }}>{s.count}</div>
            {!dense && s.note && <div className="mono dim" style={{ fontSize: 10, marginTop: 2 }}>{s.note}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ───────────────────────────────────────────────────── Cabeçalhos canônicos
// A régua única dos cabeçalhos (classes em tokens.css): página 26 · seção 17 ·
// card 15 · kicker 10/0.08em uppercase. Subtítulo sempre na linha de baixo.
function SectionHead({ title, sub, action }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <div style={{ minWidth: 0 }}>
        <h2 className="sec-title">{title}</h2>
        {sub && <div className="sec-sub" style={{ marginTop: 2 }}>{sub}</div>}
      </div>
      {action}
    </div>
  );
}

// Cabeçalho de card: kicker opcional (accent = nomeia o bloco) → título → sub,
// com `meta` (badge/ação) encostado à direita.
function CardHead({ kicker, accent, title, sub, meta }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {kicker && <div className={"kicker" + (accent ? " accent" : "")}>{kicker}</div>}
        {title && <div className="card-title" style={kicker ? { marginTop: 4 } : undefined}>{title}</div>}
        {sub && <div className="card-sub" style={{ marginTop: 3 }}>{sub}</div>}
      </div>
      {meta}
    </div>
  );
}

// ───────────────────────────────────────────────────── Ticker tape
// Seamless horizontal scroll of KPI items. items: [{ label, value, delta, unit, invert }]
function Ticker({ items }) {
  const renderRun = (keyPrefix) => items.map((it, i) => {
    const d = it.delta;
    const dir = d == null || d === 0 ? 0 : d > 0 ? 1 : -1;
    const good = it.invert ? -dir : dir;
    const color = good === 0 ? "var(--fg-4)" : good > 0 ? "var(--pos)" : "var(--neg)";
    let dstr = "";
    if (d != null) {
      if (it.unit === "$") dstr = window.fmt.money(d, { sign: true });
      else if (it.unit === "pct" || it.unit === "pp") dstr = window.fmt.pctDelta(d);
      else dstr = `${d > 0 ? "+" : ""}${d}`;
    }
    return (
      <span key={keyPrefix + i} style={{ display: "inline-flex", alignItems: "baseline", gap: 8, padding: "0 22px", borderRight: "1px solid var(--line-1)", whiteSpace: "nowrap" }}>
        <span className="kicker">{it.label}</span>
        <span className="mono tnum" style={{ fontSize: 12, color: "var(--fg-1)", fontWeight: 500 }}>{it.value}</span>
        {d != null && (
          <span className="mono tnum" style={{ fontSize: 11, color }}>
            <span style={{ fontSize: 8 }}>{dir > 0 ? "▲" : dir < 0 ? "▼" : "▬"}</span> {dstr}
          </span>
        )}
      </span>
    );
  });
  return (
    <div className="ticker-wrap" style={{ flexShrink: 0, overflow: "hidden", borderBottom: "1px solid var(--line-1)", background: "var(--bg-inset)", height: 30, display: "flex", alignItems: "center" }}>
      <span className="mono" style={{ flexShrink: 0, padding: "0 12px", fontSize: 9, letterSpacing: "0.14em", color: "var(--accent)", borderRight: "1px solid var(--line-1)", height: "100%", display: "flex", alignItems: "center" }}>● LIVE</span>
      <div style={{ display: "flex", alignItems: "center", animation: "tickerscroll 48s linear infinite", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center" }}>{renderRun("a")}</div>
        <div style={{ display: "flex", alignItems: "center" }} aria-hidden>{renderRun("b")}</div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────── LED
function Led({ tone = "var(--pos)", pulse, size = 7 }) {
  return <span className={"led" + (pulse ? " pulse" : "")} style={{ color: tone, width: size, height: size }} />;
}

// ───────────────────────────────────────────────────── Estado vazio
function EmptyState({ title, hint, action }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 40, minHeight: 0 }}>
      <div style={{ textAlign: "center", maxWidth: 460 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--fg-1)" }}>{title}</div>
        {hint && <div className="dim" style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.55 }}>{hint}</div>}
        {action && <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}>{action}</div>}
      </div>
    </div>
  );
}

// Inline edit/delete actions for list rows and cards. Stops click propagation so
// it works inside clickable rows.
function RowActions({ onEdit, onDelete }) {
  const btn = { width: 30, height: 30, display: "inline-flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--line-2)", background: "var(--bg-1)", borderRadius: "var(--r-2)", fontSize: 12, color: "var(--fg-3)", boxShadow: "var(--shadow-1)" };
  const stop = (fn) => (e) => { e.stopPropagation(); fn && fn(); };
  return (
    <span style={{ display: "inline-flex", gap: 4 }}>
      {onEdit && <button onClick={stop(onEdit)} title="Editar" style={btn}>✎</button>}
      {onDelete && <button onClick={stop(onDelete)} title="Excluir" style={{ ...btn, color: "var(--neg)" }}>✕</button>}
    </span>
  );
}

// ───────────────────────────────────────────────────── Esc fecha o popup
// Todo modal/painel fecha no Esc: useEsc(onClose) dentro do componente do
// popup. Pilha por ordem de MONTAGEM: com modal sobre drawer, o Esc fecha só
// o de cima; o próximo Esc fecha o de baixo. Passe null pra desativar
// temporariamente (ex.: enquanto salva).
const escStack = [];
function useEsc(onClose) {
  const ref = React.useRef(onClose);
  ref.current = onClose;
  React.useEffect(() => {
    const entry = {};
    escStack.push(entry);
    function onKey(e) {
      if (e.key !== "Escape") return;
      if (escStack[escStack.length - 1] !== entry || !ref.current) return;
      // Esc dentro de campo primeiro tira o foco; o próximo Esc fecha.
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) { t.blur(); return; }
      ref.current();
    }
    window.addEventListener("keydown", onKey);
    return () => { escStack.splice(escStack.indexOf(entry), 1); window.removeEventListener("keydown", onKey); };
  }, []);
}

// ───────────────────────────────────────────────────── Toast global
// window.toast("não salvou · tente de novo", "neg") — a superfície de erro das
// mutações otimistas (que antes falhavam em silêncio no console) e de avisos
// rápidos. Um por vez, some sozinho; clique dispensa. O host mora no app.jsx.
function toast(message, tone = "neutral", ms = 4500) {
  try { window.dispatchEvent(new CustomEvent("cockpit-toast", { detail: { message, tone, ms } })); }
  catch { /* fora do browser */ }
}

function ToastHost() {
  const [t, setT] = React.useState(null); // { message, tone, key }
  React.useEffect(() => {
    let timer = null;
    function onToast(e) {
      const d = e.detail || {};
      setT({ message: d.message || "", tone: d.tone || "neutral", key: Date.now() });
      clearTimeout(timer);
      timer = setTimeout(() => setT(null), d.ms || 4500);
    }
    window.addEventListener("cockpit-toast", onToast);
    return () => { window.removeEventListener("cockpit-toast", onToast); clearTimeout(timer); };
  }, []);
  if (!t) return null;
  const dot = t.tone === "neg" ? "var(--neg)" : t.tone === "pos" ? "var(--pos)" : t.tone === "warn" ? "var(--warn)" : "var(--fg-4)";
  return (
    <div onClick={() => setT(null)} role="status" style={{
      position: "fixed", left: "50%", bottom: 22, transform: "translateX(-50%)", zIndex: 200,
      maxWidth: "min(92vw, 480px)", display: "flex", alignItems: "center", gap: 8,
      padding: "10px 14px", borderRadius: "var(--r-2)", cursor: "pointer",
      background: "var(--fg-1)", color: "var(--bg-1)", boxShadow: "var(--shadow-pop)", fontSize: 12.5, fontWeight: 500,
    }}>
      <span style={{ width: 7, height: 7, borderRadius: 999, background: dot, flexShrink: 0 }} />
      <span style={{ minWidth: 0 }}>{t.message}</span>
    </div>
  );
}

// ───────────────────────────────────────────────────── Botão WhatsApp
// O verde da marca num lugar só: com `href` vira link (deep-link do app), com
// `onClick` vira botão (inbox interno). `block` estica na linha inteira.
function WaButton({ href, onClick, children, title, block, small }) {
  const style = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    height: small ? 26 : 32, padding: small ? "0 10px" : "0 14px",
    ...(block ? { flex: "1 1 100%", height: "auto", padding: "10px 14px" } : {}),
    borderRadius: "var(--r-2)", border: "none",
    background: "var(--wa-brand)", color: "var(--wa-brand-fg)",
    fontSize: block ? 13.5 : small ? 11.5 : 12.5, fontWeight: 700,
    textDecoration: "none", cursor: "pointer",
  };
  return href
    ? <a href={href} target="_blank" rel="noopener noreferrer" title={title} style={style}>{children}</a>
    : <button onClick={onClick} title={title} style={style}>{children}</button>;
}

// ───────────────────────────────────────────────────── Botão secundário
// A escala de controles do DS: 28 denso · 32 padrão · 40 CTA. Secundário =
// borda line-2 sobre bg-1 (o "const btn" que cada tela redeclarava).
function SecondaryButton({ onClick, children, title, size = "md", disabled, style }) {
  const h = size === "sm" ? 28 : size === "lg" ? 40 : 32;
  return (
    <button onClick={onClick} title={title} disabled={disabled} style={{
      height: h, padding: size === "sm" ? "0 10px" : "0 14px",
      borderRadius: "var(--r-2)", border: "1px solid var(--line-2)",
      background: "var(--bg-1)", color: "var(--fg-2)",
      fontSize: size === "sm" ? 12 : 12.5, fontWeight: 500,
      opacity: disabled ? 0.5 : 1, cursor: disabled ? "not-allowed" : "pointer",
      transition: "var(--transition-ui)", ...style,
    }}>{children}</button>
  );
}

// Primary CTA button — shared so empty states and toolbars create records the
// same way. `onClick` opens the relevant EntityForm.
function PrimaryButton({ onClick, children, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      height: 32, padding: "0 15px",
      background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))",
      boxShadow: "var(--shadow-btn)",
      borderRadius: "var(--r-2)", fontSize: 13, fontWeight: 600,
      opacity: disabled ? 0.5 : 1,
      transition: "var(--transition-ui)",
    }}>{children}</button>
  );
}

Object.assign(window, { HealthArc, Sparkline, Delta, TrendBadge, SeverityDot, Avatar, FunnelHeatmap, SectionHead, CardHead, Ticker, Led, EmptyState, PrimaryButton, SecondaryButton, RowActions, toast, ToastHost, WaButton });

export { HealthArc, Sparkline, Delta, TrendBadge, SeverityDot, Avatar, FunnelHeatmap, SectionHead, CardHead, Ticker, Led, EmptyState, PrimaryButton, SecondaryButton, RowActions, useEsc, toast, ToastHost, WaButton };
