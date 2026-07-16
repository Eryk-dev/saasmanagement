import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { usersByRole, currentUser, displayName } from "../lib/users.js";
import { PageHead, Segmented } from "../components/viz.jsx";

// Tela Agenda — o closer (ou o CS) trava horários pra compromissos externos, pra
// que NÃO caia call/integração em cima. Os bloqueios entram na mesma "agenda
// ocupada" (busyView em today.jsx) que a SlotGrid consulta em todo lugar que
// marca call — Meu dia, remarcação, card do pipeline e drawer. Aqui é o CRUD
// visual: grade da semana × horas, clica pra travar/destravar. Pontual (uma data)
// ou recorrente (todo aquele dia da semana); por hora ou dia inteiro.

const { useState: useS, useEffect: useE, useMemo: useM } = React;

const H0 = 7, H1 = 21;                 // 07:00…20:00 — mesma faixa da agenda de call
const WD = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const keyOf = (dateStr, h) => `${dateStr}-${pad(h)}`;

// Segunda a sexta da semana que contém `ref`.
function weekDays(ref) {
  const d = new Date(ref); d.setHours(0, 0, 0, 0);
  const monday = new Date(d); monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return Array.from({ length: 5 }, (_, i) => { const x = new Date(monday); x.setDate(monday.getDate() + i); return x; });
}

export function AgendaScreen() {
  const { version } = useData();
  // Pessoas com agenda que recebe marcação: closers e integradores (CS).
  const people = useM(() => {
    const seen = new Set(); const out = [];
    for (const u of [...usersByRole("closer"), ...usersByRole("integrator")]) {
      if (!seen.has(u.id)) { seen.add(u.id); out.push(u); }
    }
    return out;
  }, [version]);

  const meId = currentUser()?.id || "";
  const [user, setUser] = useS(() => (people.some((p) => p.id === meId) ? meId : (people[0]?.id || "")));
  useE(() => { if (!people.some((p) => p.id === user)) setUser(people[0]?.id || ""); }, [people]); // eslint-disable-line react-hooks/exhaustive-deps

  const [weekRef, setWeekRef] = useS(() => new Date());
  const [reason, setReason] = useS("");
  const [recur, setRecur] = useS("once"); // "once" | "weekly"

  const [blocks, setBlocks] = useS(() => (window.SEED?.AGENDA_BLOCKS || []).map((b) => ({ ...b })));
  useE(() => { setBlocks((window.SEED?.AGENDA_BLOCKS || []).map((b) => ({ ...b }))); }, [version]);
  const [leads, setLeads] = useS(() => (window.SEED?.LEADS || []));
  useE(() => { setLeads(window.SEED?.LEADS || []); }, [version]);

  const days = useM(() => weekDays(weekRef), [weekRef]);
  const myBlocks = useM(() => blocks.filter((b) => b.user === user), [blocks, user]);

  // Calls/integrações já marcadas do dono (contexto read-only na grade).
  const busyCalls = useM(() => {
    const m = new Map();
    for (const l of leads) {
      if (l.closer === user && l.callAt) { const d = new Date(l.callAt); if (Number.isFinite(d.getTime())) m.set(keyOf(ymd(d), d.getHours()), { name: l.name || "call", kind: "call" }); }
      if (l.integrator === user && l.integrationAt) { const d = new Date(l.integrationAt); if (Number.isFinite(d.getTime())) m.set(keyOf(ymd(d), d.getHours()), { name: l.name || "integração", kind: "integ" }); }
    }
    return m;
  }, [leads, user]);

  // Bloqueios que cobrem (dia, hora) do dono selecionado.
  function covering(day, h) {
    const ds = ymd(day), wd = day.getDay();
    return myBlocks.filter((b) => {
      const hit = b.allDay || (h >= Number(b.fromHour) && h < Number(b.toHour));
      if (!hit) return false;
      return b.recur === "weekly" ? Number(b.weekday) === wd : b.date === ds;
    });
  }
  function addBlock(obj) {
    const tmp = { ...obj, id: `tmp_${Date.now()}_${Math.round(Math.random() * 1e6)}` };
    setBlocks((prev) => [...prev, tmp]);
    api.create("agenda_blocks", obj).catch((err) => { console.warn("bloqueio não salvo:", err.message); setBlocks((prev) => prev.filter((b) => b.id !== tmp.id)); });
  }
  function removeBlocks(list) {
    if (!list.length) return;
    if (list.some((b) => b.recur === "weekly") && !window.confirm("Bloqueio recorrente (toda semana). Remover de todas as semanas?")) return;
    const ids = new Set(list.map((b) => b.id));
    setBlocks((prev) => prev.filter((b) => !ids.has(b.id)));
    for (const b of list) if (!String(b.id).startsWith("tmp_")) api.remove("agenda_blocks", b.id).catch((err) => console.warn("não removido:", err.message));
  }

  function toggleCell(day, h) {
    const ds = ymd(day);
    if (busyCalls.has(keyOf(ds, h))) return;            // tem call/integração: não bloqueia por cima
    const cov = covering(day, h);
    if (cov.length) return removeBlocks(cov);
    const cell = new Date(day); cell.setHours(h, 0, 0, 0);
    if (recur === "once" && cell.getTime() < Date.now()) return; // não trava passado pontual
    addBlock(recur === "weekly"
      ? { saas: "", user, recur: "weekly", weekday: day.getDay(), allDay: false, fromHour: h, toHour: h + 1, reason: reason.trim() }
      : { saas: "", user, recur: "once", date: ds, allDay: false, fromHour: h, toHour: h + 1, reason: reason.trim() });
  }
  const weekLabel = `${days[0].toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} – ${days[4].toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`;
  const shiftWeek = (n) => setWeekRef((r) => { const x = new Date(r); x.setDate(x.getDate() + n * 7); return x; });
  const personChip = (on) => ({ height: 34, padding: "0 13px", borderRadius: "var(--r-2)", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
    background: on ? "var(--accent-soft)" : "var(--bg-1)", color: on ? "var(--accent)" : "var(--fg-2)", border: "1px solid " + (on ? "var(--accent-line)" : "var(--line-2)") });

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <PageHead title="Agenda" sub="trave horários pra compromissos externos — nenhuma call cai num horário travado" />
      <div style={{ flex: 1, overflow: "auto", padding: "16px var(--pad-x) 56px", maxWidth: 1080, width: "100%", display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Controles: pessoa · motivo · pontual/recorrente · semana */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        {people.length === 0 && <span className="dim" style={{ fontSize: 12.5 }}>sem closers/CS</span>}
        {people.map((p) => <button key={p.id} onClick={() => setUser(p.id)} style={personChip(user === p.id)}>{displayName(p.id)}</button>)}

        <span style={{ width: 1, height: 18, background: "var(--line-1)", margin: "0 4px" }} />

        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="motivo (opcional): reunião, folga…"
          style={{ height: 38, width: 240, padding: "0 12px", borderRadius: "var(--r-2)", background: "var(--bg-1)", color: "var(--fg-1)", border: "1px solid var(--line-2)", fontSize: 13 }} />

        <div title="Pontual = só nessa data. Recorrente = todo aquele dia da semana.">
          <Segmented value={recur} onChange={setRecur} options={[{ value: "once", label: "só esse dia" }, { value: "weekly", label: "↻ toda semana" }]} />
        </div>

        <span style={{ flex: 1 }} />
        <button onClick={() => shiftWeek(-1)} style={navBtn}>‹</button>
        <button onClick={() => setWeekRef(new Date())} style={{ ...navBtn, width: "auto", padding: "0 12px", fontSize: 12.5 }}>hoje</button>
        <button onClick={() => shiftWeek(1)} style={navBtn}>›</button>
        <span className="mono tnum" style={{ fontSize: 12.5, color: "var(--fg-3)", marginLeft: 4 }}>{weekLabel}</span>
      </div>

      {/* Grade: coluna de horas + 5 dias úteis */}
      <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-4)", overflow: "hidden", background: "var(--bg-1)", boxShadow: "var(--shadow-card)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "56px repeat(5, 1fr)" }}>
          {/* header */}
          <div style={{ background: "var(--bg-inset)", borderBottom: "1px solid var(--line-1)" }} />
          {days.map((d, i) => {
            const isToday = ymd(d) === ymd(new Date());
            return (
              <div key={i} style={{ padding: "10px 8px", textAlign: "center", background: "var(--bg-inset)", borderBottom: "1px solid var(--line-1)", borderLeft: "1px solid var(--line-faint)" }}>
                <div style={{ fontSize: 12.5, fontWeight: isToday ? 700 : 600, color: isToday ? "var(--accent)" : "var(--fg-2)" }}>
                  {WD[d.getDay()]} {d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                </div>
              </div>
            );
          })}

          {/* linhas de hora */}
          {Array.from({ length: H1 - H0 }, (_, i) => H0 + i).map((h) => (
            <React.Fragment key={h}>
              <div className="mono tnum" style={{ fontSize: 11, color: "var(--fg-4)", textAlign: "right", padding: "0 10px", height: 34, display: "flex", alignItems: "center", justifyContent: "flex-end", borderBottom: "1px solid var(--line-faint)" }}>
                {pad(h)}:00
              </div>
              {days.map((d, di) => {
                const ds = ymd(d);
                const call = busyCalls.get(keyOf(ds, h));
                const cov = covering(d, h);
                const blocked = cov.length > 0;
                const weekly = blocked && cov.some((b) => b.recur === "weekly");
                const cell = new Date(d); cell.setHours(h, 0, 0, 0);
                const past = cell.getTime() < Date.now();
                const rsn = blocked ? (cov.find((b) => b.reason)?.reason || "") : "";
                const clickable = !call;
                let bg = "var(--bg-1)", color = "var(--fg-3)", label = "";
                if (call) { bg = "var(--accent-soft)"; color = "var(--accent)"; label = call.kind === "integ" ? "● integração" : "● call"; }
                else if (blocked) { bg = "var(--neg-soft)"; color = "var(--neg)"; label = `bloqueado${weekly ? " ↻" : ""}${rsn ? ` · ${rsn}` : ""}`; }
                return (
                  <div key={di}
                    onClick={clickable ? () => toggleCell(d, h) : undefined}
                    title={call ? `${call.name} (já marcado)` : blocked ? `bloqueado${rsn ? ": " + rsn : ""}${weekly ? " · toda semana" : ""} — clique pra liberar` : past ? "horário já passou" : "clique pra travar"}
                    style={{
                      height: 34, borderBottom: "1px solid var(--line-faint)", borderLeft: "1px solid var(--line-faint)",
                      display: "flex", alignItems: "center", padding: "0 10px", gap: 4,
                      fontSize: 11.5, fontWeight: blocked || call ? 600 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      background: bg, color, cursor: clickable ? "pointer" : "default",
                      opacity: past && !blocked && !call ? 0.5 : 1,
                    }}
                    onMouseEnter={(e) => { if (clickable && !blocked) e.currentTarget.style.background = blocked ? bg : "var(--hover)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = bg; }}>
                    {label}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Legenda + resumo */}
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center", fontSize: 12.5, color: "var(--fg-3)" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--accent)" }} />call já marcada (não dá pra travar por cima)</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--neg)" }} />bloqueado · ↻ = recorrente</span>
        <span style={{ marginLeft: "auto" }}>{myBlocks.length} bloqueio{myBlocks.length === 1 ? "" : "s"} de {displayName(user) || "—"}</span>
      </div>
      </div>
    </div>
  );
}

const navBtn = { minWidth: 32, height: 32, borderRadius: "var(--r-2)", background: "var(--bg-1)", color: "var(--fg-2)", border: "1px solid var(--line-2)", boxShadow: "var(--shadow-1)", fontSize: 14, cursor: "pointer" };
