import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { currentUser, isAdminUser } from "../lib/users.js";
import { PrimaryButton } from "../atoms.jsx";

// ── Portão do treino diário ──────────────────────────────────────────────────
// Quem tem vaga operacional (etiqueta sdr/closer/integrator/social) só começa a
// trabalhar depois de zerar a fila do dia: qualquer tela fora dos Treinamentos
// fica atrás deste overlay enquanto houver card pendente. A cada revisão o SSE
// atualiza a contagem; zerou, o cockpit libera sozinho. Falha da API nunca
// tranca a tela (fail-open).
// ADMIN NUNCA É TRAVADO, mesmo tendo vaga: Leo e Jonathan fecham venda e o Eryk
// integra, mas o treinamento é opcional pra quem toca o negócio. Sem esta
// exceção o portão prendia justamente quem precisa entrar no cockpit pra
// trabalhar.
// Mora em módulo próprio (e não em screens/training.jsx) porque o app monta o
// portão em TODA tela: dentro do training.jsx ele arrastava os 110 KB do
// baralho pro shell, e a tela de Treinamentos passou a carregar sob demanda.
const GATE_ROLES = ["sdr", "closer", "integrator", "social"];

export function TrainingGate({ saasId, active }) {
  const { version } = useData();
  const [pending, setPending] = React.useState(null); // null = sem dado (não trava)
  const me = currentUser();
  const gated = !!me && !isAdminUser(me) && (me.roles || []).some((r) => GATE_ROLES.includes(r));
  React.useEffect(() => {
    if (!saasId || !gated) { setPending(null); return; }
    let alive = true;
    api.trainingQueue(saasId)
      .then((q) => { if (alive) setPending((q.decks || []).reduce((a, d) => a + d.counts.new + d.counts.learning + d.counts.review, 0)); })
      .catch(() => alive && setPending(null));
    return () => { alive = false; };
  }, [saasId, gated, version]);

  if (!active || !gated || !pending) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: "var(--z-alarme)", background: "color-mix(in srgb, var(--bg-0) 88%, transparent)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "min(440px, 100%)", background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-2)", padding: 26, textAlign: "center" }}>
        <div style={{ fontSize: 34 }}>🧠</div>
        <div style={{ fontFamily: "var(--display)", fontSize: 19, fontWeight: 700, marginTop: 8 }}>Treino do dia primeiro</div>
        <div style={{ fontSize: 13.5, color: "var(--fg-2)", lineHeight: 1.55, marginTop: 8 }}>
          Você tem <b>{pending} {pending === 1 ? "card" : "cards"}</b> na sua fila de hoje.
          Zerou a fila, o cockpit libera sozinho.
        </div>
        <div style={{ marginTop: 16 }}>
          <PrimaryButton onClick={() => { try { location.hash = "#training"; } catch { /* ignore */ } }}>Começar o treino →</PrimaryButton>
        </div>
        <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-4)", marginTop: 12 }}>uns minutos por dia · repetição espaçada é o que fixa</div>
      </div>
    </div>
  );
}
