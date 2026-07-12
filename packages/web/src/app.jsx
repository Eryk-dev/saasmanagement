import React from "react";
import { useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakColor } from "./tweaks-panel.jsx";
import { NavRail, TopBar, NAV } from "./chrome.jsx";
import { eventsUrl } from "./lib/api.js";
import { chromeBtnStyleSmall } from "./lib/ui.js";
import { OverviewScreen } from "./screens/overview.jsx";
import { TodayScreen } from "./screens/today.jsx";
import { MetricsScreen } from "./screens/metrics.jsx";
import { ExpensesScreen } from "./screens/expenses.jsx";
import { PipelineScreen } from "./screens/pipeline.jsx";
import { FormsScreen } from "./screens/forms.jsx";
import { ProposalsScreen } from "./screens/proposals.jsx";
import { CustomersScreen } from "./screens/customers.jsx";
import { TasksScreen } from "./screens/tasks.jsx";
import { SettingsScreen } from "./screens/settings.jsx";
import { LeadDetail } from "./screens/deal.jsx";
import { DataContext, loadSeed } from "./data.jsx";
import { useActiveSaas } from "./lib/workspace.js";
import { canSeeScreen } from "./lib/users.js";
import { EntityForm } from "./components/EntityForm.jsx";
import { ConfirmDelete } from "./components/ConfirmDelete.jsx";
import { useIsMobile } from "./lib/responsive.js";
// Main app — routing, persona switching, tweaks integration.

const { useState: useStA, useEffect: useEA, useCallback: useCbA } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "typeSystem": "balanced",
  "accentHue": 183,
  "density": "regular"
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  // Workspace: o produto ativo tinge o cockpit com a cor da marca dele
  // (product.accent = hue oklch; Lever teal 183 · UniqueKids azul 250).
  const [activeProduct] = useActiveSaas();

  // Tela ativa vive no hash da URL (#pipeline): sobrevive ao refresh e ao
  // back/forward do navegador. Hash inválido/vazio cai na visão geral.
  const [screen, setScreen] = useStA(() => screenFromHash());
  const [params, setParams] = useStA({});
  const [leadSel, setLeadSel] = useStA(null);
  const [collapsed, setCollapsed] = useStA(false);
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useStA(false); // drawer da nav no mobile

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
    // A marca do produto ativo VENCE o acento do Personalizar (workspace com a
    // cara do produto); produto sem accent cadastrado cai na preferência do usuário.
    const hue = Number(activeProduct?.accent) || t.accentHue;
    document.documentElement.style.setProperty("--accent-h", String(hue));
  }, [t.theme, t.density, t.typeSystem, t.accentHue, activeProduct?.accent]);

  // Tempo real: qualquer escrita na API (deste ou de outro usuário) emite um
  // tick no /api/events; recarregamos o SEED com debounce. O primeiro evento é
  // só a baseline do rev. EventSource reconecta sozinho se a conexão cair.
  useEA(() => {
    let last = null, t = null;
    const es = new EventSource(eventsUrl());
    es.onmessage = (m) => {
      let rev, collection;
      try { ({ rev, collection } = JSON.parse(m.data)); } catch { return; }
      // Timeline (activities) fica FORA do bootstrap — o drawer refetch sozinho.
      // Recarregar o SEED inteiro a cada toque registrado seria desperdício; se o
      // toque também mexeu no lead (denorm), o update do lead emite outro evento
      // e aí sim recarregamos.
      if (last != null && rev !== last && collection !== "activities") {
        clearTimeout(t);
        t = setTimeout(refresh, 350);
      }
      last = rev;
    };
    return () => { clearTimeout(t); es.close(); };
  }, [refresh]);

  // Back/forward do navegador troca a tela junto com o hash.
  useEA(() => {
    const onHash = () => setScreen(screenFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function nav(id, p = {}) {
    setScreen(id);
    setParams(prev => ({ ...prev, ...p }));
    try { history.replaceState(null, "", "#" + id); } catch { /* ignore */ }
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
    today:       ["Meu dia"],
    pipeline:    ["Pipeline"],
    customers:   ["Clientes"],
    metrics:     ["Publicidade"],
    expenses:    ["Custos"],
    forms:       ["Ferramentas", "Formulários"],
    proposals:   ["Ferramentas", "Propostas"],
    subscriptions: ["Clientes", "Assinaturas"], // rota antiga → aba dentro de Clientes
    tasks:       ["Ferramentas", "Tarefas"],
    settings:    ["Ajustes"],
  };

  // Restrição de telas (user.screens): hash/navegação pra tela proibida cai na
  // primeira permitida do NAV. "subscriptions" é alias da aba dentro de
  // Clientes. O corte de verdade é no servidor (screens.js) — aqui é UX.
  const allowedNav = NAV.filter((n) => canSeeScreen(n.id));
  const neededScreen = screen === "subscriptions" ? "customers" : screen;
  const scr = canSeeScreen(neededScreen) ? screen : (allowedNav[0]?.id || "pipeline");

  return (
    <DataContext.Provider value={dataCtx}>
    <div className="app-shell" style={{ display: "flex", overflow: "hidden", background: "var(--bg-0)" }}>
      {!isMobile && <NavRail current={scr} onNav={(id) => nav(id)} collapsed={collapsed} />}
      {isMobile && menuOpen && (
        <div onClick={() => setMenuOpen(false)}
          style={{ position: "fixed", inset: 0, background: "oklch(0 0 0 / 0.4)", zIndex: 100, display: "flex" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ height: "100%", display: "flex", boxShadow: "var(--shadow-pop)" }}>
            <NavRail current={scr} onNav={(id) => { nav(id); setMenuOpen(false); }} collapsed={false} />
          </div>
        </div>
      )}

      <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <TopBar
          breadcrumb={crumbsFor[scr]}
          subtitle={subtitleFor(scr, params)}
          leading={isMobile && (
            <button onClick={() => setMenuOpen(true)} style={chromeBtnStyleSmall} title="Abrir menu">
              <span className="mono" style={{ fontSize: 14 }}>☰</span>
            </button>
          )}
          trailing={!isMobile && (
            <button onClick={() => setCollapsed(c => !c)} style={chromeBtnStyleSmall} title="Alternar barra lateral">
              <span className="mono" style={{ fontSize: 12 }}>{collapsed ? "▶" : "◀"}</span>
            </button>
          )}
        />

        {/* SEM key={dataVersion}: remontar a árvore a cada escrita fazia o app
            inteiro "piscar" (scroll, foco e estado locais perdidos). As telas
            se ressincronizam pelo `version` do contexto, em re-render normal. */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {scr === "overview"    && <OverviewScreen onNav={nav} onOpenLead={openLead} />}
          {scr === "today"       && <TodayScreen onOpenLead={openLead} />}
          {scr === "pipeline"    && <PipelineScreen saasId={params.saas} onJump={jump} jumpFilter={params} onOpenLead={openLead} />}
          {scr === "customers"   && <CustomersScreen />}
          {scr === "metrics"     && <MetricsScreen />}
          {scr === "expenses"    && <ExpensesScreen />}
          {scr === "forms"       && <FormsScreen saasId={params.saas} />}
          {scr === "proposals"   && <ProposalsScreen saasId={params.saas} />}
          {scr === "subscriptions" && <CustomersScreen initialTab="billing" />}
          {scr === "tasks"       && <TasksScreen />}
          {scr === "settings"    && <SettingsScreen saasId={params.saas} />}
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
      </TweaksPanel>
    </div>
    </DataContext.Provider>
  );
}

function screenFromHash() {
  const h = (typeof location !== "undefined" ? location.hash : "").replace(/^#\/?/, "");
  return NAV.some(n => n.id === h) ? h : "overview";
}

function subtitleFor(screen, params) {
  const map = {
    overview:    "",
    today:       "hoje em ordem de execução · amanhã e próximos dias à vista",
    pipeline:    `${params.stage ? "estágio: " + params.stage + " · " : ""}arraste para mover`,
    customers:   "",
    metrics:     "",
    expenses:    "",
    forms:       "formulários de captação",
    proposals:   "templates por marca",
    subscriptions: "a receita do cliente deriva daqui",
    tasks:       "kanban do time · arraste para mover",
    settings:    "funil, campos e integrações",
  };
  return map[screen] || "";
}

export { App };
