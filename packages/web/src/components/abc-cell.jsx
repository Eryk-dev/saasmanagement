import React from "react";
import { GRADE_STYLE } from "../lib/ui.js";

export const GRADES = ["S", "A", "B", "C", "D", "E"];

// Clientes A/B/C numa célula só, uma linha por grade ("2 A · R$ 43,00 cada") —
// o MESMO formato da coluna Clientes ABC da tabela de anúncios da Publicidade
// e do teste A/B dos Formulários. Módulo próprio pra Formulários não arrastar
// a Publicidade inteira (128 KB) por causa de uma célula.
// `mentoria` (opcional, Leo 18/11) fecha a lista DEPOIS das notas: quem caiu na
// saída lateral da Mentoria não tem nota (nem entra em Leads/CPL), então vem
// sem "R$ cada" e em cinza — é o resto do envio, não mais uma classificação.
export function AbcCell({ abc, abcCost, money, mentoria }) {
  const graded = abc ? GRADES.filter((g) => abc[g] > 0) : [];
  const m = Number(mentoria) || 0;
  return (
    <span className="tnum" style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 1, fontSize: 11.5 }}>
      {graded.map((g) => (
        <span key={g} style={{ whiteSpace: "nowrap", color: "var(--fg-3)" }}>
          <span style={{ fontWeight: 700, color: GRADE_STYLE[g].ink }}>{abc[g]} {g}</span>
          {abcCost?.[g] != null ? ` · ${money(abcCost[g])} cada` : ""}
        </span>
      ))}
      {m > 0 && (
        <span style={{ whiteSpace: "nowrap", color: "var(--fg-4)" }}
          title="envios sem CNPJ: foram pro fluxo da Mentoria, sem nota e fora de Leads/CPL">
          <span style={{ fontWeight: 700 }}>{m}</span> Mentoria
        </span>
      )}
      {!graded.length && !m && <span style={{ color: "var(--fg-4)", fontSize: 13.5 }}>—</span>}
    </span>
  );
}
