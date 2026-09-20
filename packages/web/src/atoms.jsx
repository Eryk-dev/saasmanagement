import React from "react";
import { userPhoto } from "./lib/users.js";
import { Popover } from "./components/popover.jsx";
import { useEsc } from "./lib/use-esc.js";
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

// ─────────────────────────────────────────────── Menu de ações da linha ("⋯")
// REGRA (12/09/2026): linha com mais de DUAS ações mostra a principal e guarda
// o resto aqui. Cinco botõezinhos de 11px por linha competem com o dado e nenhum
// se destaca; o `title` do botão lista o que tem dentro, pra não esconder opção
// atrás de clique cego. Fecha no Esc e no clique fora.
// items: [{ label, onClick, tone? }] — entrada falsy é ignorada (condicional).
// ⋯ da linha: uma ação principal fica visível e o resto vem pra cá, com o
// title do botão listando o que tem dentro.
//
// O menu era `position: absolute` DENTRO da linha (14/09). Toda tabela larga
// do app vive num `.tbl-x` (overflow-x: auto), e overflow auto num eixo recorta
// o outro também: o menu das últimas linhas de Contratos, Propostas,
// Formulário de integração, Assinaturas e Consultas nascia cortado ou fora do
// hit-test. O protótipo resolveu virando modal em Contratos; aqui a correção
// vai no componente, que é o que conserta as cinco telas de uma vez: o menu
// passa pelo Popover, que é `position: fixed`, se prende ao botão, se vira
// quando não cabe embaixo e no celular abre como folha de baixo.
function MoreMenu({ items, size = 26, align = "right" }) {
  const [open, setOpen] = React.useState(false);
  const btn = React.useRef(null);
  const vis = (items || []).filter(Boolean);
  if (!vis.length) return null;
  return (
    <span style={{ display: "inline-flex" }} onClick={(e) => e.stopPropagation()}>
      <button ref={btn} onClick={() => setOpen((o) => !o)} title={vis.map((i) => i.label).join(" · ")}
        style={{ width: size, height: size, borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-3)", fontSize: 13, lineHeight: 1, cursor: "pointer" }}>⋯</button>
      {open && (
        <Popover anchor={btn} onClose={() => setOpen(false)} width={200} align={align === "right" ? "end" : "start"}>
          {vis.map((i) => (
            <button key={i.label} onClick={() => { setOpen(false); i.onClick(); }}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: "var(--r-2)", fontSize: 12.5, color: i.tone === "neg" ? "var(--neg)" : "var(--fg-2)", background: "transparent", border: 0, cursor: "pointer" }}>
              {i.label}
            </button>
          ))}
        </Popover>
      )}
    </span>
  );
}

// ───────────────────────────────────────────────────── Esc fecha o popup
// Todo modal/painel fecha no Esc: useEsc(onClose) dentro do componente do
// popup. Pilha por ordem de MONTAGEM: com modal sobre drawer, o Esc fecha só
// o de cima; o próximo Esc fecha o de baixo. Passe null pra desativar
// temporariamente (ex.: enquanto salva).
// useEsc mora em lib/use-esc.js e é re-exportado aqui pra não quebrar os
// imports existentes (metade do app faz `import { useEsc } from "../atoms.jsx"`).

// ───────────────────────────────────────────────────── Toast global
// window.toast("não salvou · tente de novo", "neg") — a superfície de erro das
// mutações otimistas (que antes falhavam em silêncio no console) e de avisos
// rápidos. Um por vez, some sozinho; clique dispensa. O host mora no app.jsx.
// `action` = { label, onClick } desenha um botão no toast (ex.: "Desfazer" ao
// concluir uma tarefa); o clique dispara a ação e dispensa o toast.
function toast(message, tone = "neutral", ms = 4500, action = null) {
  try { window.dispatchEvent(new CustomEvent("cockpit-toast", { detail: { message, tone, ms, action } })); }
  catch { /* fora do browser */ }
}

function ToastHost() {
  const [t, setT] = React.useState(null); // { message, tone, key }
  React.useEffect(() => {
    let timer = null;
    function onToast(e) {
      const d = e.detail || {};
      setT({ message: d.message || "", tone: d.tone || "neutral", action: d.action && typeof d.action.onClick === "function" ? d.action : null, key: Date.now() });
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
      {t.action && (
        <button onClick={(e) => { e.stopPropagation(); setT(null); try { t.action.onClick(); } catch { /* ação já tratou */ } }}
          style={{ marginLeft: 6, padding: "3px 8px", borderRadius: "var(--r-1)", background: "color-mix(in srgb, var(--bg-1) 16%, transparent)", color: "var(--bg-1)", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
          {t.action.label}
        </button>
      )}
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
// ── A escala de botão da prancha, medida no DOM do protótipo (14/09) ───────
// Cinco tamanhos, e cada um com a sua fonte e o seu peso. Três coisas que o
// repo fazia diferente e apareciam em TODA tela:
//   · nenhum botão do protótipo tem sombra (o primário do repo tinha);
//   · a borda do secundário é --line-1 (#E4E8EB), não --line-2 (#CBD4DA), que
//     deixava todo botão fantasma mais pesado do que devia;
//   · o primário é peso 650, não 600.
const BTN = {
  xs: { h: 28, pad: "0 11px", fs: 12,   fwP: 650, fwS: 500, r: "var(--r-1)" },
  sm: { h: 32, pad: "0 12px", fs: 12,   fwP: 600, fwS: 500, r: "var(--r-2)" },
  md: { h: 34, pad: "0 14px", fs: 12.5, fwP: 650, fwS: 600, r: "var(--r-2)" },
  lg: { h: 38, pad: "0 16px", fs: 13,   fwP: 650, fwS: 600, r: "var(--r-2)" },
  xl: { h: 42, pad: "0 18px", fs: 13.5, fwP: 650, fwS: 600, r: "var(--r-2)" },
};

function SecondaryButton({ onClick, children, title, size = "md", tom, disabled, style, type, ...props }) {
  const b = BTN[size] || BTN.md;
  return (
    <button {...props} type={type} onClick={onClick} title={title} disabled={disabled} style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
      height: b.h, padding: b.pad,
      borderRadius: 999, border: "1px solid var(--line-1)",
      background: "var(--bg-1)", color: tom === "neg" ? "var(--neg)" : size === "xs" || size === "sm" ? "var(--fg-2)" : "var(--fg-1)",
      fontSize: b.fs, fontWeight: b.fwS,
      opacity: disabled ? 0.5 : 1, cursor: disabled ? "not-allowed" : "pointer",
      transition: "var(--transition-ui)", ...style,
    }}>{children}</button>
  );
}

// Primary CTA button — shared so empty states and toolbars create records the
// same way. `onClick` opens the relevant EntityForm.
function PrimaryButton({ onClick, children, disabled, size = "md", title, style, type }) {
  const b = BTN[size] || BTN.md;
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
      height: b.h, padding: b.pad,
      background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))",
      border: "1px solid var(--btn-bg, var(--accent))",
      borderRadius: 999, fontSize: b.fs, fontWeight: b.fwP,
      opacity: disabled ? 0.5 : 1, cursor: disabled ? "not-allowed" : "pointer",
      transition: "var(--transition-ui)", ...style,
    }}>{children}</button>
  );
}

// Placeholder de carregamento: um bloco pulsando com a medida do conteúdo que
// vai chegar (título, linha, tile). A tela monta a estrutura de verdade e troca
// pelo dado quando ele vem, em vez de um "carregando…" solto ou tela vazia.
function Skeleton({ w = "100%", h = 14, r = 6, style }) {
  return <div className="skel" aria-hidden="true" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

Object.assign(window, { HealthArc, Sparkline, Delta, TrendBadge, SeverityDot, Avatar, FunnelHeatmap, SectionHead, CardHead, Ticker, Led, EmptyState, PrimaryButton, SecondaryButton, RowActions, toast, ToastHost, WaButton, Skeleton });

export { BTN, HealthArc, Sparkline, Delta, TrendBadge, SeverityDot, Avatar, FunnelHeatmap, SectionHead, CardHead, Ticker, Led, EmptyState, PrimaryButton, SecondaryButton, RowActions, MoreMenu, useEsc, toast, ToastHost, WaButton, Skeleton };
