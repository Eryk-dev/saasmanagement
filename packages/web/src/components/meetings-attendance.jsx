// Comparecimento às calls por closer (Lever CRM, Fase 2), na tela de Calls:
// marcadas, realizadas e no-show dos últimos 30 dias, com a taxa de
// comparecimento (realizadas ÷ realizadas + no-show). Lê GET /api/meetings/report,
// que conta as calls como registro (crm/meetings.js).

import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { AnalysisCard, AnalysisBar } from "./call-analysis.jsx";
import { displayName } from "../lib/users.js";

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

export function MeetingsAttendance({ saas }) {
  const [r, setR] = useState(null);
  useEffect(() => {
    let alive = true;
    const now = Date.now();
    api.meetingsReport({ from: isoDay(now - 30 * 86_400_000), to: isoDay(now + 86_400_000), saas })
      .then((x) => alive && setR(x || { closers: [], total: 0 })).catch(() => alive && setR({ closers: [], total: 0 }));
    return () => { alive = false; };
  }, [saas]);
  if (!r) return null;
  return <AnalysisCard title="Comparecimento às calls" hint="últimos 30 dias · realizadas ÷ (realizadas + no-show), por closer" tone="var(--accent)">
    <div className="call-analysis-bars">
      {!r.closers.length && <p className="call-analysis-note">Nenhuma call marcada no período.</p>}
      {r.closers.map((c) => <AnalysisBar key={c.closer || "sem"} label={c.closer ? displayName(c.closer) : "sem closer"}
        value={c.comparecimento ?? 0} max={100} tone={c.comparecimento != null && c.comparecimento < 70 ? "var(--warn)" : "var(--accent)"}
        sub={`${c.comparecimento == null ? "—" : `${c.comparecimento}%`} · ${c.realizada} feitas · ${c.no_show} no-show · ${c.agendada} por vir`} />)}
    </div>
  </AnalysisCard>;
}
