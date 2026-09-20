import React from "react";
import "./analise.css";
import { EmptyState } from "../atoms.jsx";
import { AnaliseView } from "./pipeline.jsx";
import { useData } from "../data.jsx";
import { useActiveSaas } from "../lib/workspace.js";

// Análise de Pace — tela própria (saiu da aba do Pipeline pro menu Análises).
// Reusa o AnaliseView do pipeline: pace da meta + forecast + funil, do produto
// ativo. Só leitura (dashboards), não abre lead.
function AnaliseScreen() {
  const { version } = useData();
  const [product] = useActiveSaas();
  const s = (window.SEED?.SAAS || []).find((x) => x.id === product?.id) || product;
  const leads = React.useMemo(
    () => (window.SEED?.LEADS || []).filter((l) => l.saas === product?.id),
    [product?.id, version],
  );
  if (!s) return <EmptyState title="Sem produto ativo" hint="Escolha um produto no seletor da barra lateral." />;
  return (
    <div className="pace-page">
      <header className="pace-head"><h1>Análise de Pace</h1><span>Mês corrente</span></header>
      <AnaliseView key={s.id} s={s} leads={leads} />
    </div>
  );
}

export { AnaliseScreen };
