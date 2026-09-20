import React from "react";
import { createRoot } from "react-dom/client";
import { AppStartup } from "../src/components/screen-loading.jsx";
import { fmt } from "../src/lib/format.js";
import { LEADS_FAKE, CLIENTES_FAKE } from "./api-mock.js";
import "../src/tokens.css";
import "../src/capsule.css";
import { setupInboxPreview } from "./inbox-mock.js";
import { setupTeamPreview } from "./team-mock.js";

// Preview de tela (14/09): monta UMA tela do cockpit com dado falso, pra
// conferir o desenho contra a prancha do protótipo sem subir a API. O
// vite.preview.config.js troca lib/api.js pelo dublê. Fora do build de produção.
window.fmt = fmt;
const DIA = 86400000;
const hoje = new Date();
const iso = (n, h = 9) => { const d = new Date(hoje.getTime() + n * DIA); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const params = new URLSearchParams(location.search);
const marketingPreview = params.has("marketing");
const previewShell = params.has("shell");

window.SEED = {
  SAAS: [{
    id: "leverads", name: "LeverAds", mrr: 54013, arr: 648150, customers: 88,
    funnel: [
      { stage: "Novo lead", kind: "novo" },
      { stage: "Qualificação", kind: "qualificacao" },
      { stage: "Call marcada", kind: "call" },
      { stage: "Proposta", kind: "proposta" },
      { stage: "Ganho", kind: "ganho" },
      { stage: "Perdido", kind: "perdido" },
    ],
    leadQuestions: [],
    icp: { headline: "Operações com várias contas em marketplaces", pill: "2+ contas · 500+ anúncios", profile: ["2+ contas em marketplaces", "500+ anúncios ativos"] },
  }],
  USERS: [
    { id: "leo", name: "Leonardo", roles: ["sdr", "admin"], saas: "" },
    { id: "lucas", name: "Lucas", roles: ["closer"], saas: "" },
    { id: "tiago", name: "Tiago", roles: ["closer"], saas: "" },
  ],
  LEADS: LEADS_FAKE, CUSTOMERS: CLIENTES_FAKE, PORTFOLIO: {}, ATTENTION: [], PEOPLE: {},
  NPS: [], LEADERBOARD_MONTH: [], LEADERBOARD_ALL: [], GOALS: [],
  AGENDA_BLOCKS: [], CONSULTATION_SLOTS: [],
  CONFIG: { ai: { configured: marketingPreview }, meta: { configured: false }, mp: { configured: false }, proposals: { nativeSaas: [] } },
  ME: { id: "leo", name: "Leonardo", roles: ["sdr", "admin"] },
  COUNTERS: { leverads: { tasks: 3, tasksLate: 1, inbox: 2, tickets: 3, ticketsBreached: 1 } },
};
if (params.has("inbox")) setupInboxPreview(window.SEED, params);
if (params.has("team")) setupTeamPreview(window.SEED);
if (previewShell) {
  window.SEED.SAAS.push({ id: "elo", name: "Elo", accent: 55, funnel: [], leadQuestions: [] });
  // A moldura usa o App real, com API falsa e sem conexão SSE/banco.
  window.EventSource = class { close() {} };
}
try {
  localStorage.setItem("cockpit_user", JSON.stringify(window.SEED.ME));
  localStorage.setItem("cockpit_pipeline_view", "kanban");
  localStorage.setItem("cockpit_pipeline_phase", "all");
  localStorage.setItem("cockpit_today_person", "leo");
  // Suporte: `&ticketsView=list` abre a fila direto na Lista.
  localStorage.setItem("cockpit_tickets_view", params.get("ticketsView") === "list" ? "list" : "kanban");
  localStorage.setItem("cockpit_active_saas", marketingPreview && params.get("product") === "elo" ? "elo" : "leverads");
} catch { /* ignore */ }

const TELAS = {
  today: () => import("../src/screens/today.jsx").then((m) => m.TodayScreen),
  pipeline: () => import("../src/screens/pipeline.jsx").then((m) => m.PipelineScreen),
  overview: () => import("../src/screens/overview.jsx").then((m) => m.OverviewScreen),
  customers: () => import("../src/screens/customers.jsx").then((m) => m.CustomersScreen),
};

function App() {
  const id = (location.hash.replace("#", "") || "today");
  const [Tela, setTela] = React.useState(null);
  React.useEffect(() => { (TELAS[id] || TELAS.today)().then((c) => setTela(() => c)); }, [id]);
  if (!Tela) return <div className="mono dim" style={{ padding: 24 }}>carregando a tela…</div>;
  return (
    <div style={{ display: "flex", height: "100vh", background: "var(--bg-0)" }}>
      {/* Moldura mínima: a barra lateral real não importa pro desenho da tela. */}
      <div style={{ width: 220, flexShrink: 0, background: "var(--btn-bg)", color: "var(--btn-fg)", padding: 16, fontSize: 12.5 }}>
        <div style={{ fontWeight: 700 }}>LeverAds</div>
        <div style={{ opacity: 0.5, fontSize: 11 }}>preview de tela</div>
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <Tela onOpenLead={() => {}} onOpenWhatsapp={() => {}} onNav={() => {}} />
      </div>
    </div>
  );
}

function PreviewTheme({ children }) {
  React.useEffect(() => {
    if (marketingPreview || params.has("inbox") || params.has("team") || params.has("finance") || params.has("splash")) {
      const dark = params.get("theme") === "dark" || params.has("dark");
      document.body.dataset.theme = dark ? "dark" : "light";
      if (dark) ["--accent", "--accent-hover", "--accent-soft", "--accent-line"].forEach((name) => document.body.style.removeProperty(name));
    }
  }, []);
  return children;
}

const root = createRoot(document.getElementById("root"));
if (previewShell) {
  const loadCockpit = async () => {
    if (params.has("splash")) await new Promise((resolve) => setTimeout(resolve, Number(params.get("delay")) || 0));
    const { App: Cockpit } = await import("../src/app.jsx");
    return function PreviewCockpit(props) { return <PreviewTheme><Cockpit {...props} /></PreviewTheme>; };
  };
  root.render(params.has("splash")
    ? <PreviewTheme><AppStartup loadApp={loadCockpit} renderError={(error) => <div role="alert">{error.message}</div>} /></PreviewTheme>
    : <PreviewTheme>{React.createElement(await loadCockpit())}</PreviewTheme>);
} else {
  root.render(<App />);
  window.addEventListener("hashchange", () => location.reload());
}

// A troca dos mocks pode reexecutar a entrada no HMR. Libera a raiz anterior.
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
