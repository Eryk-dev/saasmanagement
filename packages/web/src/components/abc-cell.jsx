import React from "react";
import { GRADE_STYLE } from "../lib/ui.js";

export const GRADES = ["S", "A", "B", "C", "D", "E"];

// Clientes A/B/C numa célula só, uma linha por grade ("2 A · R$ 43,00 cada") —
// o MESMO formato da coluna Clientes ABC da tabela de anúncios da Publicidade
// e do teste A/B dos Formulários. Módulo próprio pra Formulários não arrastar
// a Publicidade inteira (128 KB) por causa de uma célula.
export function AbcCell({ abc, abcCost, money }) {
  return (
    <span className="tnum" style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 1, fontSize: 11.5 }}>
      {abc && GRADES.some((g) => abc[g] > 0)
        ? GRADES.filter((g) => abc[g] > 0).map((g) => (
          <span key={g} style={{ whiteSpace: "nowrap", color: "var(--fg-3)" }}>
            <span style={{ fontWeight: 700, color: GRADE_STYLE[g].ink }}>{abc[g]} {g}</span>
            {abcCost?.[g] != null ? ` · ${money(abcCost[g])} cada` : ""}
          </span>
        ))
        : <span style={{ color: "var(--fg-4)", fontSize: 13.5 }}>—</span>}
    </span>
  );
}
