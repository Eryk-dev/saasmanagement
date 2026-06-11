import React from "react";
import { api, clearKey } from "./lib/api.js";
// App chrome v3 "Operations Terminal" — grouped nav rail + topbar with live clock.

const { useState: useS, useEffect: useE, useRef: useR } = React;

const NAV = [
  { id: "portfolio",  label: "Portfólio",   icon: "▦",  group: "overview" },
  { id: "saas",       label: "SaaS",        icon: "◇",  group: "overview" },
  { id: "pipeline",   label: "Pipeline",    icon: "≡",  group: "sales" },
  { id: "forms",      label: "Forms",       icon: "▤",  group: "sales" },
  { id: "proposals",  label: "Propostas",   icon: "▥",  group: "sales" },
  { id: "marketing",  label: "Marketing",   icon: "◬",  group: "sales" },
  { id: "customers",  label: "Clientes",   icon: "○",  group: "customer" },
  { id: "subscriptions", label: "Assinaturas", icon: "◈", group: "customer" },
  { id: "nps",        label: "NPS",         icon: "☷",  group: "customer" },
  { id: "tasks",      label: "Tarefas",     icon: "▣",  group: "team" },
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
          </div>
        )}
      </div>
    </nav>
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

function TopBar({ title, subtitle, trailing, breadcrumb }) {
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
        <UserMenu />
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

// Menu da conta — usuário REAL logado (gravado no login). Trocar senha + sair.
// Quem entra por API key não tem usuário: mostra "API key", só com sair.
function UserMenu() {
  const [open, setOpen] = useS(false);
  const [pwOpen, setPwOpen] = useS(false);
  const ref = useR(null);
  useE(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  let user = null;
  try { user = JSON.parse(localStorage.getItem("cockpit_user") || "null"); } catch { /* ignore */ }

  async function logout() {
    try { await api.logout(); } catch { /* sessão já pode estar morta */ }
    clearKey();
    try { localStorage.removeItem("cockpit_user"); } catch { /* ignore */ }
    location.reload();
  }

  const name = user?.name || "API key";
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
        <UserDot name={name} />
        <span style={{ fontSize: 13, color: "var(--fg-2)", fontWeight: 450 }}>{name}</span>
        <span className="dim" style={{ fontSize: 10 }}>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 5px)", right: 0,
          width: 220,
          border: "1px solid var(--line-2)",
          background: "var(--bg-1)",
          borderRadius: "var(--r-3)",
          boxShadow: "var(--shadow-pop)",
          padding: 5,
          zIndex: 80,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 8px" }}>
            <UserDot name={name} />
            <div>
              <div style={{ fontSize: 13, color: "var(--fg-1)" }}>{name}</div>
              <div className="mono dim" style={{ fontSize: 10 }}>{user ? (user.role || "admin") : "acesso por chave"}</div>
            </div>
          </div>
          <div style={{ borderTop: "1px solid var(--line-1)", marginTop: 2, paddingTop: 2 }}>
            {user && (
              <button onClick={() => { setOpen(false); setPwOpen(true); }} style={menuItemStyle}>Trocar senha…</button>
            )}
            <button onClick={logout} style={{ ...menuItemStyle, color: "var(--neg)" }}>Sair</button>
          </div>
        </div>
      )}
      {pwOpen && <PasswordModal onClose={() => setPwOpen(false)} />}
    </div>
  );
}

const menuItemStyle = {
  display: "block", width: "100%", padding: "8px 8px",
  borderRadius: "var(--r-2)", fontSize: 13, textAlign: "left", color: "var(--fg-1)",
};

function PasswordModal({ onClose }) {
  const [current, setCurrent] = useS("");
  const [next, setNext] = useS("");
  const [busy, setBusy] = useS(false);
  const [msg, setMsg] = useS(null); // { ok, text }
  const inputStyle = { width: "100%", height: 30, padding: "0 8px", background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", color: "var(--fg-1)", fontSize: 13 };
  const labelStyle = { fontSize: 10, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "var(--mono)" };

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      await api.changePassword(current, next);
      setMsg({ ok: true, text: "senha alterada" });
      setTimeout(onClose, 900);
    } catch (err) {
      setBusy(false);
      setMsg({ ok: false, text: err.status === 401 ? "senha atual incorreta" : (err.message || String(err)) });
    }
  }
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "oklch(0 0 0 / 0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 90 }}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} style={{ width: 320, background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-pop)", padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 500 }}>Trocar senha</div>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={labelStyle}>Senha atual</span>
          <input type="password" value={current} autoFocus autoComplete="current-password" onChange={(e) => setCurrent(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={labelStyle}>Nova senha (4+ caracteres)</span>
          <input type="password" value={next} autoComplete="new-password" onChange={(e) => setNext(e.target.value)} style={inputStyle} />
        </label>
        {msg && <div className="mono" style={{ fontSize: 11, color: msg.ok ? "var(--pos)" : "var(--neg)" }}>{msg.text}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" disabled={busy || next.length < 4} style={{ flex: 1, padding: "8px 12px", background: "var(--accent)", color: "var(--accent-fg)", borderRadius: "var(--r-2)", fontSize: 13, fontWeight: 500, opacity: busy || next.length < 4 ? 0.6 : 1 }}>
            {busy ? "Salvando…" : "Salvar"}
          </button>
          <button type="button" onClick={onClose} style={{ padding: "8px 14px", background: "var(--bg-2)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", fontSize: 13 }}>Cancelar</button>
        </div>
      </form>
    </div>
  );
}

function UserDot({ name }) {
  return (
    <span style={{
      width: 24, height: 24, borderRadius: "var(--r-1)",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      background: "oklch(from var(--accent) l c h / 0.16)",
      border: "1px solid var(--accent)",
      color: "var(--accent)",
      fontSize: 12,
      fontWeight: 600,
    }}>{(name || "?")[0].toUpperCase()}</span>
  );
}

Object.assign(window, { NavRail, TopBar, NAV });

export { NavRail, TopBar, NAV };
