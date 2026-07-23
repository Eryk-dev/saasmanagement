import React from "react";
import { PageHead } from "../components/viz.jsx";
import { EmptyState } from "../atoms.jsx";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { useActiveSaas } from "../lib/workspace.js";
import { usePeriod } from "../components/period-picker.jsx";
import { buildPeople, TeamCards, topPerformer, asRate } from "../components/team-cards.jsx";

// Funcionários — desempenho por pessoa. Reusa os cartões do time (TeamCards, os
// mesmos da Visão geral) mas como tela dedicada no menu Análises, com o próprio
// seletor de período e uma fila de coaching embaixo. Clicar num nome abre o
// pipeline daquela pessoa.
const { useState, useEffect, useMemo } = React;

function FuncionariosScreen({ onNav }) {
  const { version } = useData();
  const [product] = useActiveSaas();
  // Janela GLOBAL do cockpit (a mesma da Visão geral e da Aquisição).
  const { period, custom, win } = usePeriod(); // seletor no topo; aqui só lemos a janela
  const [score, setScore] = useState(null);

  useEffect(() => {
    if (!product?.id) return;
    let alive = true; setScore(null);
    api.scoreboard(product.id, win).then((s) => alive && setScore(s)).catch(() => alive && setScore(null));
    return () => { alive = false; };
  }, [product?.id, period, custom.since, custom.until, version]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clicar num nome abre o pipeline filtrado por aquela pessoa (o pipeline lê a
  // pessoa do localStorage) — mesmo comportamento da Visão geral.
  const openPerson = (userId) => {
    try { localStorage.setItem("cockpit_pipeline_person", userId); } catch { /* ignore */ }
    onNav && onNav("pipeline", { saas: product.id });
  };

  if (!product) return <EmptyState title="Sem produto ativo" hint="Escolha um produto no seletor da barra lateral." />;

  const people = buildPeople(score);
  const highlight = topPerformer(people);
  const coaching = people.flatMap((p) => {
    const checks = [
      // Fechamento do closer = calls que ACONTECERAM (o furo é do comparecimento,
      // cobrado na linha do SDR abaixo) — senão o mesmo número vira dois alertas.
      p.closer && { label: "Conversão na call", value: p.closer.conversaoCall, target: p.closer.goals?.conversaoCall?.target || 33, advice: "revisar ancoragem de preço nas calls" },
      p.sdr && { label: "Calls → ganho", value: p.sdr.callWinRate, target: p.sdr.goals?.callWinRate?.target || 25, advice: "apertar o follow-up pós-call" },
      p.sdr && { label: "Taxa de agendamento", value: p.sdr.bookingRate, target: p.sdr.goals?.bookingRate?.target || 30, advice: "revisar a abordagem de qualificação" },
      p.cs && { label: "Retenção", value: p.cs.retentionRate, target: p.cs.goals?.retentionRate?.target || 95, advice: "revisar os pontos de risco do onboarding" },
    ].filter(Boolean).filter((c) => c.value != null && c.value < c.target);
    return checks.map((c) => ({ ...c, person: p, gap: c.target - c.value }));
  }).sort((a, b) => b.gap - a.gap).slice(0, 3);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}>
      <PageHead title="Análise de Equipe" sub="desempenho por pessoa · placar por papel (SDR · closer · CS)" />
      <div style={{ padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 16 }}>
        {score == null && <div className="dim" style={{ fontSize: 12.5 }}>carregando…</div>}
        {score != null && !people.length && <EmptyState title="Sem atividade no período" hint="O desempenho por pessoa aparece quando o time movimenta leads e clientes." />}
        {people.length > 0 && <TeamCards people={people} bizDays={win.businessDays} onPerson={openPerson} highlight={highlight} />}

        {people.length > 0 && (
          <section style={{ background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", boxShadow: "var(--shadow-card)", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "20px 24px 14px" }}>
              <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 600, letterSpacing: "-.01em" }}>Fila de coaching</h3>
              <span style={{ fontSize: 12.5, color: "var(--fg-4)" }}>onde cada pessoa está mais longe da meta</span>
            </div>
            {!coaching.length && <div style={{ borderTop: "1px solid var(--line-faint)", padding: "18px 24px", fontSize: 13, color: "var(--fg-3)" }}>Ninguém abaixo das metas principais neste período.</div>}
            {coaching.map((item) => (
              <div key={`${item.person.user}-${item.label}`} style={{ display: "flex", gap: 12, alignItems: "center", padding: "13px var(--inset-x)", borderTop: "1px solid var(--line-faint)", flexWrap: "wrap" }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, width: 120, flexShrink: 0 }}>{item.person.name}</span>
                <span style={{ fontSize: 13, color: "var(--fg-2)", flex: 1, minWidth: "min(220px, 100%)" }}>{item.label} {asRate(item.value)} vs. meta {asRate(item.target)} · {item.advice}</span>
                <button onClick={() => openPerson(item.person.user)} style={{ height: 30, padding: "0 12px", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", background: "var(--bg-1)", boxShadow: "var(--shadow-1)", fontSize: 12.5, fontWeight: 600 }}>Abrir pipeline</button>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

export { FuncionariosScreen };
