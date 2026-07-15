import React from "react";
import { PageHead } from "../components/viz.jsx";
import { EmptyState } from "../atoms.jsx";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { useActiveSaas } from "../lib/workspace.js";
import { TeamPerformance, periodWindow, PRESETS, presetBtn } from "./overview.jsx";

// Funcionários — desempenho por pessoa. Reusa o placar por papel (SDR/closer/CS)
// da Visão geral (TeamPerformance + /api/scoreboard), mas como tela dedicada no
// menu Análises, com o próprio seletor de período. Clicar num nome abre o
// pipeline daquela pessoa.
const { useState, useEffect, useMemo } = React;

function FuncionariosScreen({ onNav }) {
  const { version } = useData();
  const [product] = useActiveSaas();
  const [period, setPeriod] = useState(() => { try { return localStorage.getItem("cockpit_func_period") || "30d"; } catch { return "30d"; } });
  const setP = (p) => { setPeriod(p); try { localStorage.setItem("cockpit_func_period", p); } catch { /* ignore */ } };
  const win = useMemo(() => periodWindow(period, {}), [period]);
  const [score, setScore] = useState(null);

  useEffect(() => {
    if (!product?.id) return;
    let alive = true; setScore(null);
    api.scoreboard(product.id, win).then((s) => alive && setScore(s)).catch(() => alive && setScore(null));
    return () => { alive = false; };
  }, [product?.id, period, version]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clicar num nome abre o pipeline filtrado por aquela pessoa (o pipeline lê a
  // pessoa do localStorage) — mesmo comportamento da Visão geral.
  const openPerson = (userId) => {
    try { localStorage.setItem("cockpit_pipeline_person", userId); } catch { /* ignore */ }
    onNav && onNav("pipeline", { saas: product.id });
  };

  if (!product) return <EmptyState title="Sem produto ativo" hint="Escolha um produto no seletor da barra lateral." />;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}>
      <PageHead title="Funcionários" sub="desempenho por pessoa · placar por papel (SDR · closer · CS)">
        <div style={{ display: "flex", alignItems: "center", gap: 3, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {PRESETS.map((p) => (
            <button key={p.key} onClick={() => setP(p.key)} className="mono" style={presetBtn(period === p.key)}>{p.label}</button>
          ))}
        </div>
      </PageHead>
      <div style={{ padding: "12px var(--pad-x) 20px" }}>
        <TeamPerformance score={score} days={win.days} pLabel={win.label} onPerson={openPerson} product={product} />
      </div>
    </div>
  );
}

export { FuncionariosScreen };
