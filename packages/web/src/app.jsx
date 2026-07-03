import React from "react";
import { useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakColor, TweakToggle } from "./tweaks-panel.jsx";
import { NavRail, TopBar } from "./chrome.jsx";
import { chromeBtnStyleSmall } from "./lib/ui.js";
import { OverviewScreen } from "./screens/overview.jsx";
import { MetricsScreen } from "./screens/metrics.jsx";
import { PipelineScreen } from "./screens/pipeline.jsx";
import { FormsScreen } from "./screens/forms.jsx";
import { ProposalsScreen } from "./screens/proposals.jsx";
import { CustomersScreen } from "./screens/customers.jsx";
import { SubscriptionsScreen } from "./screens/subscriptions.jsx";
import { TasksScreen } from "./screens/tasks.jsx";
import { SettingsScreen } from "./screens/settings.jsx";
import { LeadDetail } from "./screens/deal.jsx";
import { DataContext, loadSeed } from "./data.jsx";
import { EntityForm } from "./components/EntityForm.jsx";
import { ConfirmDelete } from "./components/ConfirmDelete.jsx";
// Main app — routing, persona switching, tweaks integration.

const { useState: useStA, useEffect: useEA, useCallback: useCbA } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "typeSystem": "balanced",
  "accentHue": 183,
  "density": "regular",
  "showTrajectoryAnnotation": true
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  const [screen, setScreen] = useStA("overview");
  const [params, setParams] = useStA({});
  const [leadSel, setLeadSel] = useStA(null);
  const [collapsed, setCollapsed] = useStA(false);

  // CRUD plumbing — modals live above the keyed screen so a post-write refresh
  // never unmounts the form mid-callback. Screens trigger via the DataContext.
  const [dataVersion, setDataVersion] = useStA(0);
  const [editor, setEditor] = useStA(null);   // { entityKey, record }
  const [confirm, setConfirm] = useStA(null);  // { entityKey, record }
  const refresh = useCbA(async () => { await loadSeed(); setDataVersion(v => v + 1); }, []);
  const openForm = useCbA((entityKey, record = null) => setEditor({ entityKey, record }), []);
  const openDelete = useCbA((entityKey, record) => setConfirm({ entityKey, record }), []);
  const dataCtx = React.useMemo(() => ({ version: dataVersion, refresh, openForm, openDelete }), [dataVersion, refresh, openForm, openDelete]);

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
    if (link.type === "saas")      nav("overview");
    else if (link.type === "pipeline")  nav("pipeline", { saas: link.id, stage: link.stage });
    else if (link.type === "customers") nav("customers", { csFilter: link.filter });
    else if (link.type === "attention") nav("overview");
  }

  function openLead(l) { setLeadSel(l); }

  // Breadcrumb per screen
  const crumbsFor = {
    overview:    ["Visão geral"],
    pipeline:    ["Pipeline"],
    customers:   ["Clientes"],
    metrics:     ["Métricas"],
    forms:       ["Ferramentas", "Formulários"],
    proposals:   ["Ferramentas", "Propostas"],
    subscriptions: ["Ferramentas", "Assinaturas"],
    tasks:       ["Ferramentas", "Tarefas"],
    settings:    ["Ajustes"],
  };

  return (
    <DataContext.Provider value={dataCtx}>
    <div style={{ height: "100vh", display: "flex", overflow: "hidden", background: "var(--bg-0)" }}>
      <NavRail current={screen} onNav={(id) => nav(id)} collapsed={collapsed} />

      <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <TopBar
          breadcrumb={crumbsFor[screen]}
          subtitle={subtitleFor(screen, params)}
          trailing={
            <button onClick={() => setCollapsed(c => !c)} style={chromeBtnStyleSmall} title="Alternar barra lateral">
              <span className="mono" style={{ fontSize: 12 }}>{collapsed ? "▶" : "◀"}</span>
            </button>
          }
        />

        <div key={dataVersion} style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {screen === "overview"    && <OverviewScreen onNav={nav} onOpenLead={openLead} />}
          {screen === "pipeline"    && <PipelineScreen saasId={params.saas} onJump={jump} jumpFilter={params} onOpenLead={openLead} />}
          {screen === "customers"   && <CustomersScreen />}
          {screen === "metrics"     && <MetricsScreen />}
          {screen === "forms"       && <FormsScreen saasId={params.saas} />}
          {screen === "proposals"   && <ProposalsScreen saasId={params.saas} />}
          {screen === "subscriptions" && <SubscriptionsScreen saasId={params.saas} />}
          {screen === "tasks"       && <TasksScreen />}
          {screen === "settings"    && <SettingsScreen saasId={params.saas} />}
        </div>
      </main>

      {leadSel && <LeadDetail lead={leadSel} onClose={() => setLeadSel(null)} />}

      {editor && (
        <EntityForm
          entityKey={editor.entityKey}
          record={editor.record}
          onClose={() => setEditor(null)}
          onSaved={async () => { setEditor(null); await refresh(); }}
        />
      )}
      {confirm && (
        <ConfirmDelete
          entityKey={confirm.entityKey}
          record={confirm.record}
          onClose={() => setConfirm(null)}
          onDeleted={async () => { setConfirm(null); await refresh(); }}
        />
      )}

      <TweaksPanel title="Personalizar">
        <TweakSection label="Superfície" />
        <TweakRadio label="Tema" value={t.theme} options={[{value:"light",label:"claro"},{value:"dark",label:"escuro"}]}
          onChange={(v) => setTweak("theme", v)} />
        <TweakRadio label="Densidade" value={t.density} options={[{value:"compact",label:"compacto"},{value:"regular",label:"regular"}]}
          onChange={(v) => setTweak("density", v)} />
        <TweakRadio label="Tipografia" value={t.typeSystem} options={[{value:"balanced",label:"equilibrada"},{value:"mono",label:"mono"}]}
          onChange={(v) => setTweak("typeSystem", v)} />
        <TweakColor label="Acento" value={`oklch(0.56 0.105 ${t.accentHue})`}
          options={[
            "oklch(0.56 0.105 183)",  // teal Lever (padrão)
            "oklch(0.56 0.155 277)",  // indigo
            "oklch(0.58 0.130 240)",  // azul
            "oklch(0.56 0.150 300)",  // violeta
          ]}
          onChange={(v) => {
            const m = /oklch\([^\s]+\s+[^\s]+\s+(\d+)/.exec(v);
            if (m) setTweak("accentHue", parseInt(m[1], 10));
          }} />

        <TweakSection label="Mais" />
        <TweakToggle label="Anotações no gráfico" value={t.showTrajectoryAnnotation}
          onChange={(v) => setTweak("showTrajectoryAnnotation", v)} />
      </TweaksPanel>
    </div>
    </DataContext.Provider>
  );
}

function subtitleFor(screen, params) {
  const map = {
    overview:    "",
    pipeline:    `${params.stage ? "estágio: " + params.stage + " · " : ""}arraste para mover`,
    customers:   "",
    metrics:     "",
    forms:       "formulários de captação",
    proposals:   "templates por marca",
    subscriptions: "a receita do cliente deriva daqui",
    tasks:       "kanban do time · arraste para mover",
    settings:    "funil, campos e integrações",
  };
  return map[screen] || "";
}

export { App };
