import React from "react";
import { PageHead } from "../components/viz.jsx";
import { EmptyState } from "../atoms.jsx";
import { AnaliseView } from "./pipeline.jsx";
import { useData } from "../data.jsx";
import { useActiveSaas } from "../lib/workspace.js";

// Análise do pipeline — tela própria (saiu da aba do Pipeline pro menu Análises).
// Reusa o AnaliseView do pipeline: pace de caixa + forecast + funil, do produto
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
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <PageHead title="Análise do pipeline" sub="pace de caixa · forecast · funil do produto ativo" />
      <AnaliseView s={s} leads={leads} />
    </div>
  );
}

export { AnaliseScreen };
