import React from "react";
import { api, clearKey } from "./lib/api.js";
import { useActiveSaas } from "./lib/workspace.js";
import { canSeeScreen } from "./lib/users.js";
// App chrome v3 "Operations Terminal" — grouped nav rail + topbar with live clock.
// A sidebar veste a MARCA do produto ativo (workspace): logo + nome no topo,
// seletor de produto no pé (a "bolinha" com o contador abre o menu de troca).

const { useState: useS, useEffect: useE, useRef: useR } = React;

// Menu organizado por área do negócio: topo sem rótulo (o dia a dia), depois
// Comercial, Marketing e Geral. A ORDEM dos grupos segue a 1ª aparição no array.
const NAV = [
  { id: "overview",   label: "Visão geral",       icon: "◈",  group: "main" },
  { id: "training",   label: "Treinamentos",      icon: "✎",  group: "main" },
  { id: "today",      label: "Minhas atividades", icon: "◷",  group: "main" },

  { id: "pipeline",   label: "Pipeline",       icon: "≡",  group: "comercial" },
  { id: "customers",  label: "Clientes",       icon: "○",  group: "comercial" },
  { id: "consultas",  label: "Consultas",      icon: "❋",  group: "comercial" },
  { id: "proposals",  label: "Propostas",      icon: "▥",  group: "comercial" },
  { id: "offers",     label: "Link pagamento", icon: "◇",  group: "comercial" },
  { id: "agenda",     label: "Agenda",         icon: "▦",  group: "comercial" },
  // Inbox de WhatsApp escondido do menu por ora (Leo não vai usar). Tela e rotas
  // seguem no código; pra reativar, basta devolver esta entrada:
  // { id: "whatsapp",   label: "WhatsApp",       icon: "✆",  group: "comercial" },

  { id: "social",     label: "Redes sociais",  icon: "◍",  group: "marketing" },
  { id: "metrics",    label: "Publicidade",    icon: "∿",  group: "marketing" },
  { id: "forms",      label: "Formulários",    icon: "▤",  group: "marketing" },
  { id: "creative",   label: "Canvas",         icon: "◨",  group: "marketing" },
  { id: "disparos",   label: "Disparos",       icon: "➤",  group: "marketing" },

  { id: "aquisicao",     label: "Aquisição",  icon: "◔", group: "analises" },
  { id: "calls",         label: "Pitch",      icon: "◐", group: "analises" },
  { id: "integrations",  label: "Integração", icon: "◑", group: "analises" },
  { id: "analise",       label: "Pipeline",   icon: "◒", group: "analises" },
  { id: "funcionarios",  label: "Funcionários", icon: "◓", group: "analises" },

  { id: "tasks",      label: "Tarefas",        icon: "▣",  group: "geral" },
  { id: "mindmaps",   label: "Mapas mentais",  icon: "⌬",  group: "geral" },
  { id: "metas",      label: "Metas",          icon: "◎",  group: "geral" },
  { id: "expenses",   label: "Custos",         icon: "◫",  group: "geral" },
  { id: "settings",   label: "Configurações",  icon: "✦",  group: "geral" },
];

// Grupo "main" não leva rótulo (é a espinha do app); os demais levam.
const GROUP_LABELS = {
  main: null,
  comercial: "comercial",
  marketing: "marketing",
  analises: "análises",
  geral: "geral",
};

function NavRail({ current, onNav, collapsed }) {
  const w = collapsed ? 52 : 220;
  const [product] = useActiveSaas();
  const brand = BRANDS[product?.id] || { label: product?.name || "Cockpit", Icon: GenericMark };
  // Aba do navegador acompanha a marca do workspace ativo.
  useE(() => { document.title = `${brand.label} · Cockpit`; }, [brand.label]);
  // Build grouped list — só as telas permitidas pro usuário (user.screens);
  // grupo sem tela permitida some inteiro. A API tem o guard de verdade.
  const groups = [];
  NAV.filter((item) => canSeeScreen(item.id)).forEach(item => {
    let g = groups.find(x => x.key === item.group);
    if (!g) { g = { key: item.group, items: [] }; groups.push(g); }
    g.items.push(item);
  });

  return (
    <nav style={{
      width: w,
      flexShrink: 0,
      borderRight: "1px solid var(--line-1)",
      background: "var(--bg-rail, var(--bg-0))",
      display: "flex",
      flexDirection: "column",
      transition: "width 180ms ease",
      overflow: "hidden",
    }}>
      <div style={{ padding: "0 14px", display: "flex", alignItems: "center", gap: 10, height: 56 }}>
        <brand.Icon />
        {!collapsed && (
          <div style={{ lineHeight: 1.1, minWidth: 0 }}>
            <div style={{ fontFamily: "var(--display)", fontSize: 14.5, fontWeight: 700, color: "var(--fg-1)", letterSpacing: "-0.01em" }}>{brand.label}</div>
          </div>
        )}
      </div>

      <div style={{ flex: 1, padding: "6px 8px", overflowY: "auto", overflowX: "hidden" }}>
        {groups.map(g => (
          <div key={g.key} style={{ marginBottom: 12 }}>
            {!collapsed && GROUP_LABELS[g.key] && (
              <div className="mono" style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg-4)", padding: "8px 10px 6px" }}>
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
                    width: "100%", padding: "7px 10px",
                    borderRadius: "var(--r-1)",
                    background: active ? "var(--accent-soft)" : "transparent",
                    color: active ? "var(--fg-1)" : "var(--fg-2)",
                    fontSize: 13.5,
                    fontWeight: active ? 600 : 500,
                    marginBottom: 1,
                    textAlign: "left",
                  }}>
                  <span style={{ fontSize: 13, width: 16, textAlign: "center", color: active ? "var(--accent)" : "var(--fg-4)" }}>{item.icon}</span>
                  {!collapsed && <span>{item.label}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div style={{ padding: "10px 12px", borderTop: "1px solid var(--line-1)" }}>
        {!collapsed && <WorkspaceSwitcher />}
      </div>
    </nav>
  );
}

// Seletor de produto (workspace) no pé da sidebar. Com 1 produto é um chip
// informativo; com 2+ vira o alternador: a bolinha mostra o contador e o clique
// abre o menu — o cockpit INTEIRO troca de contexto (telas + cor da marca).
function WorkspaceSwitcher() {
  const [product, setProduct] = useActiveSaas();
  const saas = (window.SEED?.SAAS || []);
  const [open, setOpen] = useS(false);
  const ref = useR(null);
  useE(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  if (!product) return null;
  const single = saas.length <= 1;
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => !single && setOpen((o) => !o)}
        title={single ? undefined : "Trocar de produto"}
        style={{
          display: "flex", alignItems: "center", gap: 8, width: "100%",
          padding: "7px 10px", border: "1px solid " + (open ? "var(--accent-line)" : "var(--line-1)"),
          borderRadius: "var(--r-2)", background: "var(--bg-1)",
          cursor: single ? "default" : "pointer",
        }}>
        <span className="dot" style={{ color: "var(--accent)", width: 7, height: 7, flexShrink: 0 }} />
        <span style={{ fontSize: 12.5, color: "var(--fg-2)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{product.name}</span>
        {!single && (
          <span style={{
            marginLeft: "auto", flexShrink: 0, minWidth: 16, height: 16, padding: "0 4px",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            borderRadius: 99, background: "var(--accent-soft)", color: "var(--accent)",
            fontSize: 10, fontWeight: 700, fontFamily: "var(--mono)",
          }}>{saas.length}</span>
        )}
        {!single && <span className="dim" style={{ fontSize: 9, flexShrink: 0 }}>{open ? "▾" : "▴"}</span>}
        {single && <span className="mono" style={{ fontSize: 10, color: "var(--fg-4)", marginLeft: "auto", flexShrink: 0 }}>1 SaaS</span>}
      </button>
      {open && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 6px)", left: 0, right: 0,
          border: "1px solid var(--line-2)", background: "var(--bg-1)",
          borderRadius: "var(--r-3)", boxShadow: "var(--shadow-pop)", padding: 5, zIndex: 80,
        }}>
          <div className="mono" style={{ fontSize: 10, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--fg-4)", padding: "6px 8px 4px" }}>Produtos</div>
          {saas.map((s) => {
            const isActive = s.id === product.id;
            return (
              <button key={s.id} onClick={() => { setProduct(s.id); setOpen(false); }}
                style={{ ...menuItemStyle, display: "flex", alignItems: "center", gap: 8, fontWeight: isActive ? 600 : 450 }}>
                <span style={{ width: 7, height: 7, borderRadius: 2, background: window.productTone ? window.productTone(s) : "var(--accent)", flexShrink: 0 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                {isActive && <span style={{ marginLeft: "auto", color: "var(--accent)", fontSize: 11 }}>✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Marcas conhecidas do portfólio — logo + nome oficiais na sidebar. Produto
// sem marca registrada aqui cai no mark genérico com o nome do cadastro.
const BRANDS = {
  leverads: { label: "LeverAds", Icon: Logo },
  uniquekids: { label: "UniqueKids", Icon: UniqueKidsMark },
};

// Símbolo da UniqueKids (manual de marca): quadrado amarelo, círculo laranja e
// triângulo verde — as formas geométricas do logo, sem o wordmark.
function UniqueKidsMark() {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" style={{ flexShrink: 0 }} aria-label="UniqueKids">
      <rect x="3" y="12" width="12.5" height="12.5" rx="3.5" fill="#FFD71E" transform="rotate(-9 9 18)" />
      <circle cx="20.5" cy="9.5" r="5" fill="#EF5D2B" />
      <path d="M18 17.5 L26.5 15 L24.5 23.5 Z" fill="#00B800" />
    </svg>
  );
}

function GenericMark() {
  return (
    <span style={{
      width: 30, height: 30, borderRadius: "var(--r-1)", flexShrink: 0,
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      background: "var(--accent-soft)", border: "1px solid var(--accent-line)",
      color: "var(--accent)", fontSize: 14, fontWeight: 700, fontFamily: "var(--display)",
    }}>◆</span>
  );
}

// Ícone oficial da LeverAds (mesmo asset do copylever: lever/logo-icon-color.svg).
function Logo() {
  return (
    <svg width="30" height="30" viewBox="0 0 1453.13 1493.95" style={{ flexShrink: 0 }} aria-label="LeverAds">
      <path fill="#051C2C" d="M519.22,843.75l-45.1,15.11c53.94,77.43,143.68,128.2,245.06,128.2,4.38,0,8.76-.08,13.07-.3l-14.13-45.02c-80.76-.3-152.75-38.68-198.9-97.98ZM719.19,390.03c-164.61,0-298.55,133.94-298.55,298.55,0,29.46,4.31,58.02,12.31,84.91l39.13-29.31c-4-17.9-6.12-36.49-6.12-55.6,0-139.6,113.62-253.22,253.22-253.22s253.15,113.62,253.15,253.22c0,99.49-57.71,185.84-141.42,227.16v49.63c109.39-44.27,186.74-151.69,186.74-276.79,0-164.61-133.86-298.55-298.47-298.55Z" />
      <polygon fill="#23D8D3" points="800.7 535.53 800.7 1103.92 763 983.8 749.25 939.91 691.16 754.61 501.54 817.84 457.65 832.42 362.47 864.14 443.6 803.33 481.22 775.08 800.7 535.53" />
    </svg>
  );
}

function TopBar({ title, subtitle, leading, trailing, breadcrumb, onSearch }) {
  return (
    <header style={{
      height: 56,
      flexShrink: 0,
      borderBottom: "1px solid var(--line-1)",
      background: "var(--bg-topbar, var(--bg-0))",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 16px",
      gap: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        {leading}
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
        {subtitle && <span className="hide-mobile" style={{ fontSize: 12, color: "var(--fg-5)", whiteSpace: "nowrap" }}>{subtitle}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {trailing}
        <span className="hide-mobile" style={{ display: "inline-flex" }}><CmdK onClick={onSearch} /></span>
        <UserMenu />
      </div>
    </header>
  );
}

function CmdK({ onClick }) {
  return (
    <button onClick={onClick} title="Buscar lead (⌘K / Ctrl+K)" style={{
      display: "inline-flex", alignItems: "center", gap: 8,
      height: 28, padding: "0 8px 0 10px",
      border: "1px solid var(--line-2)",
      background: "var(--bg-3)",
      borderRadius: "var(--r-1)",
      color: "var(--fg-4)",
      fontSize: 13,
      whiteSpace: "nowrap",
      boxShadow: "var(--shadow-1)",
      cursor: "pointer",
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
        <span className="hide-mobile" style={{ fontSize: 13, color: "var(--fg-2)", fontWeight: 450 }}>{name}</span>
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
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} style={{ width: "min(320px, calc(100vw - 24px))", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-pop)", padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
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
