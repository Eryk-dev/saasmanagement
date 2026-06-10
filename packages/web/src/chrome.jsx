import React from "react";
import { api, clearKey } from "./lib/api.js";
// App chrome v3 "Operations Terminal" — grouped nav rail + topbar with live clock.

const { useState: useS, useEffect: useE, useRef: useR } = React;

const PERSONAS = [
  { id: "founder", name: "Fundador",          subtitle: "você",         home: "portfolio" },
  { id: "manager", name: "Gestor de SaaS",     subtitle: "Quill",       home: "saas",      saas: "quill" },
  { id: "sdr",     name: "SDR",              subtitle: "Sam Sato",    home: "pipeline" },
  { id: "closer",  name: "Closer",           subtitle: "Mika K.",     home: "pipeline" },
  { id: "cs",      name: "Customer Success", subtitle: "Amelia B.",   home: "customers" },
];

const NAV = [
  { id: "portfolio",  label: "Portfólio",   icon: "▦",  group: "overview" },
  { id: "saas",       label: "SaaS",        icon: "◇",  group: "overview" },
  { id: "pipeline",   label: "Pipeline",    icon: "≡",  group: "sales" },
  { id: "forms",      label: "Forms",       icon: "▤",  group: "sales" },
  { id: "proposals",  label: "Propostas",   icon: "▥",  group: "sales" },
  { id: "customers",  label: "Clientes",   icon: "○",  group: "customer" },
  { id: "subscriptions", label: "Assinaturas", icon: "◈", group: "customer" },
  { id: "nps",        label: "NPS",         icon: "☷",  group: "customer" },
  { id: "goals",      label: "Metas",       icon: "◎",  group: "team" },
  { id: "leaderboard",label: "Ranking", icon: "♔",  group: "team" },
  { id: "settings",   label: "Ajustes",    icon: "✦",  group: "system" },
];

const GROUP_LABELS = {
  overview: "visão geral",
  sales: "receita",
  customer: "retenção",
  team: "pessoas",
  system: "config",
};

function NavRail({ current, onNav, collapsed }) {
  const w = collapsed ? 52 : 220;
  // Build grouped list
  const groups = [];
  NAV.forEach(item => {
    let g = groups.find(x => x.key === item.group);
    if (!g) { g = { key: item.group, items: [] }; groups.push(g); }
    g.items.push(item);
  });

  return (
    <nav style={{
      width: w,
      flexShrink: 0,
      borderRight: "1px solid var(--line-1)",
      background: "var(--bg-1)",
      display: "flex",
      flexDirection: "column",
      transition: "width 180ms ease",
      overflow: "hidden",
    }}>
      <div style={{ padding: "0 14px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid var(--line-1)", height: 52 }}>
        <Logo />
        {!collapsed && (
          <div style={{ lineHeight: 1.1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--fg-1)", letterSpacing: "-0.01em" }}>Cockpit</div>
            <div style={{ fontSize: 11, color: "var(--fg-4)", marginTop: 1 }}>Portfolio OS</div>
          </div>
        )}
      </div>

      <div style={{ flex: 1, padding: "10px 8px", overflowY: "auto", overflowX: "hidden" }}>
        {groups.map(g => (
          <div key={g.key} style={{ marginBottom: 12 }}>
            {!collapsed && (
              <div style={{ fontSize: 11, fontWeight: 510, letterSpacing: "0.02em", textTransform: "uppercase", color: "var(--fg-5)", padding: "2px 10px 6px" }}>
                {GROUP_LABELS[g.key]}
              </div>
            )}
            {g.items.map(item => {
              const active = current === item.id;
              return (
                <button key={item.id}
                  onClick={() => onNav(item.id)}
                  title={collapsed ? item.label : undefined}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--hover)"; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
                  style={{
                    display: "flex", alignItems: "center", gap: 9,
                    width: "100%", padding: "6px 9px",
                    borderRadius: "var(--r-1)",
                    background: active ? "var(--hover)" : "transparent",
                    color: active ? "var(--fg-1)" : "var(--fg-3)",
                    fontSize: 13,
                    fontWeight: active ? 510 : 450,
                    marginBottom: 1,
                    textAlign: "left",
                  }}>
                  <span style={{ fontSize: 13, width: 16, textAlign: "center", color: active ? "var(--fg-2)" : "var(--fg-4)" }}>{item.icon}</span>
                  {!collapsed && <span>{item.label}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div style={{ padding: "10px 14px", borderTop: "1px solid var(--line-1)" }}>
        {!collapsed && (
          <div style={{ fontSize: 11.5, color: "var(--fg-4)", lineHeight: 1.6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="led" style={{ color: "var(--pos)", width: 7, height: 7 }} /> Fontes sincronizadas
            </div>
            <SessionFooter />
          </div>
        )}
      </div>
    </nav>
  );
}

// Usuário logado (gravado pelo login) + sair. Quem entra por API key não tem
// sessão — o footer só mostra o status de fontes.
function SessionFooter() {
  let user = null;
  try { user = JSON.parse(localStorage.getItem("cockpit_user") || "null"); } catch { /* ignore */ }
  if (!user) return null;
  async function logout() {
    try { await api.logout(); } catch { /* sessão já pode estar morta */ }
    clearKey();
    try { localStorage.removeItem("cockpit_user"); } catch { /* ignore */ }
    location.reload();
  }
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
      <span style={{ color: "var(--fg-3)" }}>{user.name}</span>
      <button onClick={logout} className="mono" style={{ fontSize: 10, color: "var(--fg-4)", textDecoration: "underline" }}>sair</button>
    </div>
  );
}

function Logo() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <rect x="0.5" y="0.5" width="23" height="23" rx="6" fill="var(--accent)" />
      <circle cx="12" cy="12" r="5.5" fill="none" stroke="var(--accent-fg)" strokeWidth="1.3" opacity="0.5" />
      <circle cx="12" cy="12" r="2.1" fill="var(--accent-fg)" />
    </svg>
  );
}

function TopBar({ title, subtitle, persona, onPersona, trailing, breadcrumb }) {
  return (
    <header style={{
      height: 48,
      flexShrink: 0,
      borderBottom: "1px solid var(--line-1)",
      background: "var(--bg-0)",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 16px",
      gap: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {breadcrumb && breadcrumb.map((b, i) => {
            const last = i === breadcrumb.length - 1;
            return (
              <React.Fragment key={i}>
                {i > 0 && <span style={{ color: "var(--line-strong)", fontSize: 13 }}>/</span>}
                <span style={{ fontSize: 13.5, fontWeight: last ? 510 : 450, color: last ? "var(--fg-1)" : "var(--fg-4)", whiteSpace: "nowrap" }}>{b}</span>
              </React.Fragment>
            );
          })}
          {!breadcrumb && title && <h1 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{title}</h1>}
        </div>
        {subtitle && <span style={{ fontSize: 12, color: "var(--fg-5)", whiteSpace: "nowrap" }}>{subtitle}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {trailing}
        <CmdK />
        <PersonaSwitcher persona={persona} onPersona={onPersona} />
      </div>
    </header>
  );
}

function CmdK() {
  return (
    <button style={{
      display: "inline-flex", alignItems: "center", gap: 8,
      height: 28, padding: "0 8px 0 10px",
      border: "1px solid var(--line-2)",
      background: "var(--bg-3)",
      borderRadius: "var(--r-1)",
      color: "var(--fg-4)",
      fontSize: 13,
      whiteSpace: "nowrap",
      boxShadow: "var(--shadow-1)",
    }}>
      <span>Buscar…</span>
      <span className="kbd">⌘K</span>
    </button>
  );
}

function PersonaSwitcher({ persona, onPersona }) {
  const [open, setOpen] = useS(false);
  const ref = useR(null);
  useE(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const cur = PERSONAS.find(p => p.id === persona) || PERSONAS[0];
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          height: 28, padding: "0 8px 0 4px",
          border: "1px solid " + (open ? "var(--accent-line)" : "var(--line-2)"),
          background: "var(--bg-3)",
          borderRadius: "var(--r-1)",
          boxShadow: "var(--shadow-1)",
        }}>
        <PersonaDot persona={cur} />
        <span style={{ fontSize: 13, color: "var(--fg-2)", fontWeight: 450 }}>{cur.name}</span>
        <span className="dim" style={{ fontSize: 10 }}>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 5px)", right: 0,
          width: 252,
          border: "1px solid var(--line-2)",
          background: "var(--bg-1)",
          borderRadius: "var(--r-3)",
          boxShadow: "var(--shadow-pop)",
          padding: 5,
          zIndex: 80,
        }}>
          <div className="bkt" style={{ display: "block", padding: "8px 9px 6px" }}>Trocar papel</div>
          {PERSONAS.map(p => (
            <button key={p.id}
              onClick={() => { onPersona(p.id); setOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                width: "100%", padding: "8px 8px",
                borderRadius: "var(--r-2)",
                background: p.id === persona ? "var(--bg-3)" : "transparent",
                color: "var(--fg-1)",
                fontSize: 13,
                textAlign: "left",
              }}>
              <PersonaDot persona={p} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13 }}>{p.name}</div>
                <div className="mono dim" style={{ fontSize: 10 }}>{p.subtitle}</div>
              </div>
              {p.id === persona && <span className="led" style={{ color: "var(--accent)" }} />}
            </button>
          ))}
          <div style={{ borderTop: "1px solid var(--line-1)", marginTop: 4, padding: "8px 8px" }}>
            <div className="mono dim" style={{ fontSize: 10, lineHeight: 1.5 }}>
              Trocar de papel muda sua tela inicial e os filtros padrão. Os dados por baixo são os mesmos.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PersonaDot({ persona }) {
  const tone = {
    founder: "var(--accent)",
    manager: "var(--info)",
    sdr:     "var(--warn)",
    closer:  "var(--pos)",
    cs:      "oklch(0.74 0.12 300)",
  }[persona.id] || "var(--fg-3)";
  const ch = (persona.name || "?")[0];
  return (
    <span style={{
      width: 24, height: 24, borderRadius: "var(--r-1)",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      background: `oklch(from ${tone} l c h / 0.16)`,
      border: `1px solid ${tone}`,
      color: tone,
      fontSize: 12,
      fontWeight: 600,
    }}>{ch}</span>
  );
}

Object.assign(window, { NavRail, TopBar, PersonaSwitcher, PERSONAS, NAV });

export { NavRail, TopBar, PersonaSwitcher, PERSONAS, NAV };
