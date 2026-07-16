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
  // Recurso legado mantido por URL, mas fora da navegação do handoff.
  { id: "consultas",  label: "Consultas",      icon: "❋",  group: "comercial", hidden: true },
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
  { id: "analise",       label: "Análise do pipeline", icon: "◒", group: "analises" },
  { id: "funcionarios",  label: "Funcionários", icon: "◓", group: "analises" },

  { id: "tasks",      label: "Tarefas",        icon: "▣",  group: "geral" },
  { id: "mindmaps",   label: "Mapas mentais",  icon: "⌬",  group: "geral" },
  { id: "metas",      label: "Metas",          icon: "◎",  group: "geral" },
  { id: "expenses",   label: "Custos",         icon: "◫",  group: "geral" },
  { id: "settings",   label: "Configurações",  icon: "✦",  group: "geral" },
];

// Ícones SVG do NAV (traço 1.8, currentColor) — substituem os caracteres
// unicode, cujo peso variava com a fonte do sistema. Chaveados pelo id do item.
const NavSvg = ({ children }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const ICONS = {
  overview: <NavSvg><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></NavSvg>,
  training: <NavSvg><path d="M2.5 5h6a3 3 0 0 1 3 3v12a2.5 2.5 0 0 0-2.5-2h-6.5z" /><path d="M21.5 5h-6a3 3 0 0 0-3 3v12a2.5 2.5 0 0 1 2.5-2h6.5z" /></NavSvg>,
  today: <NavSvg><circle cx="12" cy="12" r="8.7" /><path d="M12 7.2V12l3.2 2" /></NavSvg>,
  pipeline: <NavSvg><rect x="3" y="4" width="4.6" height="11" rx="1.4" /><rect x="9.7" y="4" width="4.6" height="16" rx="1.4" /><rect x="16.4" y="4" width="4.6" height="8" rx="1.4" /></NavSvg>,
  customers: <NavSvg><circle cx="9" cy="8" r="3.4" /><path d="M2.7 19.5a6.4 6.4 0 0 1 12.6 0" /><path d="M15.8 4.9a3.4 3.4 0 0 1 0 6.2" /><path d="M17.4 14.3a6.4 6.4 0 0 1 3.9 5.2" /></NavSvg>,
  consultas: <NavSvg><rect x="3.4" y="4.6" width="17.2" height="16.4" rx="2" /><path d="M3.4 9.6h17.2" /><path d="M8.2 2.6v4M15.8 2.6v4" /><path d="M8.8 15.2l2.2 2.2 4.2-4.6" /></NavSvg>,
  proposals: <NavSvg><path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" /><path d="M13.5 3v5.5H19" /><path d="M9 13.5h6M9 17h6" /></NavSvg>,
  offers: <NavSvg><rect x="2.6" y="5" width="18.8" height="14" rx="2" /><path d="M2.6 10h18.8" /><path d="M6.2 15h4" /></NavSvg>,
  agenda: <NavSvg><rect x="3.4" y="4.6" width="17.2" height="16.4" rx="2" /><path d="M3.4 9.6h17.2" /><path d="M8.2 2.6v4M15.8 2.6v4" /></NavSvg>,
  whatsapp: <NavSvg><path d="M5.2 3.2h3.6l1.6 4.3-2.2 1.9a12.6 12.6 0 0 0 6.4 6.4l1.9-2.2 4.3 1.6v3.6a2 2 0 0 1-2.1 2A16.3 16.3 0 0 1 3.2 5.3a2 2 0 0 1 2-2.1z" /></NavSvg>,
  social: <NavSvg><circle cx="6" cy="12" r="2.7" /><circle cx="17.6" cy="5.6" r="2.7" /><circle cx="17.6" cy="18.4" r="2.7" /><path d="M8.5 10.8l6.7-3.9M8.5 13.2l6.7 3.9" /></NavSvg>,
  metrics: <NavSvg><path d="M3 17.6l5.8-5.9 3.9 3.9L20.5 7.5" /><path d="M14.8 7.2h5.7V13" /></NavSvg>,
  forms: <NavSvg><rect x="4.6" y="4.2" width="14.8" height="17" rx="2" /><path d="M9.2 2.6h5.6v3.2H9.2z" /><path d="M9 11.4h6M9 15.2h6" /></NavSvg>,
  creative: <NavSvg><path d="M12 3a9 9 0 1 0 0 18c1.5 0 2.3-.9 2.3-1.9 0-1.6-1.3-1.9-1.3-3 0-1.3 1.1-2 2.5-2h2a4 4 0 0 0 3.2-6.4A9 9 0 0 0 12 3z" /><circle cx="8" cy="9" r="0.4" /><circle cx="13.5" cy="7" r="0.4" /><circle cx="6.8" cy="14" r="0.4" /></NavSvg>,
  disparos: <NavSvg><path d="M21.3 2.7L11 13" /><path d="M21.3 2.7l-6.5 18.2-3.8-7.9-7.9-3.8z" /></NavSvg>,
  aquisicao: <NavSvg><path d="M3.2 4h17.6l-6.8 8.2v6.3l-4 2.3v-8.6z" /></NavSvg>,
  calls: <NavSvg><rect x="9" y="2.6" width="6" height="11" rx="3" /><path d="M5.6 11a6.4 6.4 0 0 0 12.8 0" /><path d="M12 17.4V21" /></NavSvg>,
  integrations: <NavSvg><path d="M10 13.4a4 4 0 0 0 6 .4l2.9-2.9a4 4 0 0 0-5.7-5.7l-1.5 1.5" /><path d="M14 10.6a4 4 0 0 0-6-.4l-2.9 2.9a4 4 0 0 0 5.7 5.7l1.5-1.5" /></NavSvg>,
  analise: <NavSvg><path d="M5.4 20v-8" /><path d="M12 20V4.6" /><path d="M18.6 20v-5" /></NavSvg>,
  funcionarios: <NavSvg><rect x="6" y="3" width="12" height="18" rx="2" /><circle cx="12" cy="10" r="2.1" /><path d="M8.9 16.4a3.4 3.4 0 0 1 6.2 0" /><path d="M10.2 3.4h3.6" /></NavSvg>,
  tasks: <NavSvg><rect x="3.6" y="3.6" width="16.8" height="16.8" rx="2.4" /><path d="M8.4 12.4l2.6 2.6 4.9-5.5" /></NavSvg>,
  mindmaps: <NavSvg><circle cx="12" cy="5.2" r="2.4" /><circle cx="5.4" cy="18.2" r="2.4" /><circle cx="18.6" cy="18.2" r="2.4" /><path d="M12 7.6v3.6M12 11.2l-5.2 5M12 11.2l5.2 5" /></NavSvg>,
  metas: <NavSvg><circle cx="12" cy="12" r="8.6" /><circle cx="12" cy="12" r="4.9" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /></NavSvg>,
  expenses: <NavSvg><rect x="2.8" y="5.4" width="18.4" height="13.6" rx="2" /><path d="M21.2 10.2h-4.7a1.9 1.9 0 0 0 0 3.8h4.7" /></NavSvg>,
  settings: <NavSvg><path d="M4 6.4h8.6M16.9 6.4H20M4 12h2.8M11.1 12H20M4 17.6h8.6M16.9 17.6H20" /><circle cx="14.8" cy="6.4" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="14.8" cy="17.6" r="2" /></NavSvg>,
};

// Grupo "main" não leva rótulo (é a espinha do app); os demais levam.
const GROUP_LABELS = {
  main: null,
  comercial: "comercial",
  marketing: "marketing",
  analises: "análises",
  geral: "geral",
};

function NavRail({ current, onNav, collapsed }) {
  const w = collapsed ? 56 : 228;
  const [product] = useActiveSaas();
  const brand = BRANDS[product?.id] || { label: product?.name || "Cockpit", Icon: GenericMark };
  // Aba do navegador acompanha a marca do workspace ativo.
  useE(() => { document.title = `${brand.label} · Cockpit`; }, [brand.label]);
  // Build grouped list — só as telas permitidas pro usuário (user.screens);
  // grupo sem tela permitida some inteiro. A API tem o guard de verdade.
  const groups = [];
  NAV.filter((item) => !item.hidden && canSeeScreen(item.id)).forEach(item => {
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
      <div style={{ padding: "0 16px", display: "flex", alignItems: "center", gap: 10, height: 58, flexShrink: 0, borderBottom: "1px solid var(--line-faint)" }}>
        <brand.Icon />
        {!collapsed && (
          <div style={{ lineHeight: 1.1, minWidth: 0 }}>
            <div style={{ fontFamily: "var(--display)", fontSize: 15, fontWeight: 700, color: "var(--fg-1)", letterSpacing: "-0.01em" }}>{brand.label}</div>
          </div>
        )}
      </div>

      <div style={{ flex: 1, padding: 10, overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column", gap: 4 }}>
        {groups.map(g => (
          <div key={g.key} style={{ marginBottom: 10 }}>
            {!collapsed && GROUP_LABELS[g.key] && (
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg-4)", padding: "10px 10px 6px" }}>
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
                    borderRadius: "var(--r-2)",
                    background: active ? "var(--accent-soft)" : "transparent",
                    color: active ? "var(--fg-1)" : "var(--fg-2)",
                    fontSize: 13.5,
                    fontWeight: active ? 600 : 500,
                    marginBottom: 1,
                    textAlign: "left",
                  }}>
                  <span style={{ width: 16, height: 16, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: active ? "var(--accent)" : "var(--fg-4)" }}>{ICONS[item.id] || item.icon}</span>
                  {!collapsed && <span>{item.label}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div style={{ padding: 12, borderTop: "1px solid var(--line-1)" }}>
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
          padding: "8px 10px", border: "1px solid " + (open ? "var(--accent-line)" : "var(--line-1)"),
          borderRadius: "var(--r-3)", background: "var(--bg-inset)",
          cursor: single ? "default" : "pointer",
        }}>
        <span className="dot" style={{ color: "var(--accent)", width: 7, height: 7, flexShrink: 0 }} />
        <span style={{ fontSize: 12.5, color: "var(--fg-2)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{product.name}</span>
        {!single && (
          <span style={{
            marginLeft: "auto", flexShrink: 0, minWidth: 18, height: 18, padding: "0 5px",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            borderRadius: 999, background: "var(--accent-soft)", color: "var(--accent)",
            fontSize: 11, fontWeight: 600, fontFamily: "var(--mono)",
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
    <svg width="28" height="28" viewBox="0 0 30 30" style={{ flexShrink: 0 }} aria-label="UniqueKids">
      <rect x="3" y="12" width="12.5" height="12.5" rx="3.5" fill="#FFD71E" transform="rotate(-9 9 18)" />
      <circle cx="20.5" cy="9.5" r="5" fill="#EF5D2B" />
      <path d="M18 17.5 L26.5 15 L24.5 23.5 Z" fill="#00B800" />
    </svg>
  );
}

function GenericMark() {
  return (
    <span style={{
      width: 28, height: 28, borderRadius: "var(--r-1)", flexShrink: 0,
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      background: "var(--accent-soft)", border: "1px solid var(--accent-line)",
      color: "var(--accent)", fontSize: 14, fontWeight: 700, fontFamily: "var(--display)",
    }}>◆</span>
  );
}

// Ícone oficial da LeverAds (mesmo asset do copylever: lever/logo-icon-color.svg).
function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 1453.13 1493.95" style={{ flexShrink: 0 }} aria-label="LeverAds">
      <path fill="var(--fg-1)" d="M519.22,843.75l-45.1,15.11c53.94,77.43,143.68,128.2,245.06,128.2,4.38,0,8.76-.08,13.07-.3l-14.13-45.02c-80.76-.3-152.75-38.68-198.9-97.98ZM719.19,390.03c-164.61,0-298.55,133.94-298.55,298.55,0,29.46,4.31,58.02,12.31,84.91l39.13-29.31c-4-17.9-6.12-36.49-6.12-55.6,0-139.6,113.62-253.22,253.22-253.22s253.15,113.62,253.15,253.22c0,99.49-57.71,185.84-141.42,227.16v49.63c109.39-44.27,186.74-151.69,186.74-276.79,0-164.61-133.86-298.55-298.47-298.55Z" />
      <polygon fill="#23D8D3" points="800.7 535.53 800.7 1103.92 763 983.8 749.25 939.91 691.16 754.61 501.54 817.84 457.65 832.42 362.47 864.14 443.6 803.33 481.22 775.08 800.7 535.53" />
    </svg>
  );
}

function TopBar({ title, leading, breadcrumb, onSearch }) {
  return (
    <header style={{
      height: 58,
      flexShrink: 0,
      borderBottom: "1px solid var(--line-1)",
      background: "var(--bg-topbar, var(--bg-0))",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 min(24px, var(--pad-x))",
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
                <span style={{ fontSize: 13, fontWeight: last ? 600 : 450, color: last ? "var(--fg-1)" : "var(--fg-4)", whiteSpace: "nowrap" }}>{b}</span>
              </React.Fragment>
            );
          })}
          {!breadcrumb && title && <h1 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{title}</h1>}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
      height: 32, minWidth: 184, padding: "0 8px 0 11px",
      border: "1px solid var(--line-1)",
      background: "var(--bg-inset)",
      borderRadius: "var(--r-2)",
      color: "var(--fg-4)",
      fontSize: 13,
      whiteSpace: "nowrap",
      cursor: "pointer",
    }}>
      <span>Buscar lead…</span>
      <span className="kbd" style={{ marginLeft: "auto" }}>⌘K</span>
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
          height: 34, padding: "0 4px",
          borderRadius: "var(--r-2)",
          background: open ? "var(--hover)" : "transparent",
        }}>
        <UserDot name={name} />
        <span className="hide-mobile" style={{ fontSize: 13, color: "var(--fg-2)", fontWeight: 500 }}>{name}</span>
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
          <button type="submit" disabled={busy || next.length < 4} style={{ flex: 1, padding: "8px 12px", background: "var(--btn-bg, var(--accent))", color: "var(--btn-fg, var(--accent-fg))", borderRadius: "var(--r-2)", fontSize: 13, fontWeight: 500, opacity: busy || next.length < 4 ? 0.6 : 1 }}>
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
      width: 30, height: 30, borderRadius: 999,
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      background: "var(--fg-1)",
      color: "var(--bg-1)",
      fontSize: 12,
      fontWeight: 600,
    }}>{(name || "?")[0].toUpperCase()}</span>
  );
}

Object.assign(window, { NavRail, TopBar, NAV });

export { NavRail, TopBar, NAV };
