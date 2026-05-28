import React from "react";
import { useTweaks, TweaksPanel, TweakSection, TweakSelect, TweakRadio, TweakColor, TweakToggle, TweakButton } from "./tweaks-panel.jsx";
import { NavRail, TopBar, PERSONAS } from "./chrome.jsx";
import { chromeBtnStyleSmall } from "./lib/ui.js";
import { PortfolioScreen } from "./screens/portfolio.jsx";
import { SaasDashboardScreen } from "./screens/saas_dashboard.jsx";
import { PipelineScreen } from "./screens/pipeline.jsx";
import { LeadsScreen } from "./screens/leads.jsx";
import { CustomersScreen } from "./screens/customers.jsx";
import { NPSScreen } from "./screens/nps.jsx";
import { GoalsScreen } from "./screens/goals.jsx";
import { LeaderboardScreen } from "./screens/leaderboard.jsx";
import { SettingsScreen } from "./screens/settings.jsx";
import { DealDetail } from "./screens/deal.jsx";
// Main app — routing, persona switching, tweaks integration.

const { useState: useStA, useEffect: useEA } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "persona": "founder",
  "theme": "dark",
  "typeSystem": "balanced",
  "accentHue": 277,
  "density": "regular",
  "showTrajectoryAnnotation": true
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // Sync persona <-> tweak (so the tweak panel switches the role too)
  const persona = t.persona;
  const personaObj = PERSONAS.find(p => p.id === persona) || PERSONAS[0];

  const [screen, setScreen] = useStA(personaObj.home);
  const [params, setParams] = useStA(personaObj.saas ? { saas: personaObj.saas } : {});
  const [dealSel, setDealSel] = useStA(null);
  const [collapsed, setCollapsed] = useStA(false);

  // When persona changes, route to that persona's home
  useEA(() => {
    const p = PERSONAS.find(x => x.id === persona);
    if (!p) return;
    setScreen(p.home);
    setParams(p.saas ? { saas: p.saas } : (p.id === "cs" ? { csFilter: "red" } : {}));
  }, [persona]);

  // Apply theme/density/typeSystem to body
  useEA(() => {
    document.body.dataset.theme = t.theme;
    document.body.dataset.density = t.density;
    document.body.dataset.type = t.typeSystem === "mono" ? "mono" : "default";
    // Only the accent HUE is themed here; lightness/chroma come from tokens per theme.
    document.documentElement.style.setProperty("--accent-h", String(t.accentHue));
  }, [t.theme, t.density, t.typeSystem, t.accentHue]);

  function nav(id, p = {}) {
    setScreen(id);
    setParams(prev => ({ ...prev, ...p }));
  }
  function jump(link) {
    if (!link) return;
    if (link.type === "saas")      nav("saas", { saas: link.id });
    else if (link.type === "pipeline")  nav("pipeline", { saas: link.id, stage: link.stage });
    else if (link.type === "customers") nav("customers", { csFilter: link.filter });
    else if (link.type === "nps")       nav("nps");
    else if (link.type === "rep")       nav("leaderboard");
    else if (link.type === "attention") nav("portfolio");
  }

  function openDeal(d) { setDealSel(d); }

  // Breadcrumb per screen
  const crumbsFor = {
    portfolio:   ["Portfólio"],
    saas:        ["Portfólio", window.SEED.SAAS.find(s => s.id === params.saas)?.name || "LeverAds"],
    pipeline:    ["Vendas", "Pipeline · " + (window.SEED.SAAS.find(s => s.id === params.saas)?.name || "LeverAds")],
    leads:       ["Vendas", "Leads"],
    customers:   ["Cliente", "Clientes"],
    nps:         ["Cliente", "NPS"],
    goals:       ["Time", "Metas"],
    leaderboard: ["Time", "Ranking"],
    settings:    ["Sistema", "Ajustes · " + (window.SEED.SAAS.find(s => s.id === params.saas)?.name || "LeverAds")],
  };

  return (
    <div style={{ height: "100vh", display: "flex", overflow: "hidden", background: "var(--bg-0)" }}>
      <NavRail current={screen} onNav={(id) => nav(id)} collapsed={collapsed} />

      <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <TopBar
          breadcrumb={crumbsFor[screen]}
          subtitle={subtitleFor(screen, params)}
          persona={persona}
          onPersona={(p) => setTweak("persona", p)}
          trailing={
            <button onClick={() => setCollapsed(c => !c)} style={chromeBtnStyleSmall} title="Alternar barra lateral">
              <span className="mono" style={{ fontSize: 12 }}>{collapsed ? "▶" : "◀"}</span>
            </button>
          }
        />

        {screen === "portfolio"   && <PortfolioScreen onNav={nav} onJump={jump} />}
        {screen === "saas"        && <SaasDashboardScreen saasId={params.saas} onNav={nav} onJump={jump} />}
        {screen === "pipeline"    && <PipelineScreen saasId={params.saas} onJump={jump} jumpFilter={params} onOpenDeal={openDeal} />}
        {screen === "leads"       && <LeadsScreen persona={persona} />}
        {screen === "customers"   && <CustomersScreen csFilter={params.csFilter} />}
        {screen === "nps"         && <NPSScreen />}
        {screen === "goals"       && <GoalsScreen />}
        {screen === "leaderboard" && <LeaderboardScreen />}
        {screen === "settings"    && <SettingsScreen saasId={params.saas} />}
      </main>

      {dealSel && <DealDetail deal={dealSel} onClose={() => setDealSel(null)} />}

      <TweaksPanel title="Personalizar">
        <TweakSection label="Papel" />
        <TweakSelect label="Persona" value={t.persona}
          options={PERSONAS.map(p => ({ value: p.id, label: `${p.name} · ${p.subtitle}` }))}
          onChange={(v) => setTweak("persona", v)} />

        <TweakSection label="Superfície" />
        <TweakRadio label="Tema" value={t.theme} options={[{value:"light",label:"claro"},{value:"dark",label:"escuro"}]}
          onChange={(v) => setTweak("theme", v)} />
        <TweakRadio label="Densidade" value={t.density} options={[{value:"compact",label:"compacto"},{value:"regular",label:"regular"}]}
          onChange={(v) => setTweak("density", v)} />
        <TweakRadio label="Tipografia" value={t.typeSystem} options={[{value:"balanced",label:"equilibrada"},{value:"mono",label:"mono"}]}
          onChange={(v) => setTweak("typeSystem", v)} />
        <TweakColor label="Acento" value={`oklch(0.56 0.155 ${t.accentHue})`}
          options={[
            "oklch(0.56 0.155 277)",  // indigo (Linear default)
            "oklch(0.56 0.150 300)",  // violet
            "oklch(0.58 0.130 240)",  // blue
            "oklch(0.62 0.130 165)",  // teal
          ]}
          onChange={(v) => {
            const m = /oklch\([^\s]+\s+[^\s]+\s+(\d+)/.exec(v);
            if (m) setTweak("accentHue", parseInt(m[1], 10));
          }} />

        <TweakSection label="Mais" />
        <TweakToggle label="Anotações no gráfico" value={t.showTrajectoryAnnotation}
          onChange={(v) => setTweak("showTrajectoryAnnotation", v)} />
        <TweakButton label="Ir pra Quill (crítico)" onClick={() => { setTweak("persona","manager"); }} />
        <TweakButton label="Ir pra um deal travado" onClick={() => { setScreen("pipeline"); setParams({ saas: "leverads", stage: "Discovery" }); }} />
      </TweaksPanel>
    </div>
  );
}

function subtitleFor(screen, params) {
  const map = {
    portfolio:   "28 mai 2026",
    saas:        "28 mai 2026",
    pipeline:    `${params.stage ? "estágio: " + params.stage + " · " : ""}arraste para mover`,
    leads:       "fila round-robin",
    customers:   params.csFilter === "red" ? "filtrado: crítico" : "ordenado por saúde",
    nps:         "últimos 90 dias",
    goals:       "dia 12 / 31",
    leaderboard: "múltiplas categorias",
    settings:    "configuração por SaaS",
  };
  return map[screen] || "";
}

export { App };
