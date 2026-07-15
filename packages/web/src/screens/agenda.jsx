import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { usersByRole, currentUser, displayName } from "../lib/users.js";

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
  function allDayBlocks(day) {
    const ds = ymd(day), wd = day.getDay();
    return myBlocks.filter((b) => b.allDay && (b.recur === "weekly" ? Number(b.weekday) === wd : b.date === ds));
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
  function toggleDay(day) {
    const existing = allDayBlocks(day);
    if (existing.length) return removeBlocks(existing);
    const ds = ymd(day);
    addBlock(recur === "weekly"
      ? { saas: "", user, recur: "weekly", weekday: day.getDay(), allDay: true, fromHour: 0, toHour: 0, reason: reason.trim() }
      : { saas: "", user, recur: "once", date: ds, allDay: true, fromHour: 0, toHour: 0, reason: reason.trim() });
  }

  const weekLabel = `${days[0].toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} – ${days[4].toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`;
  const shiftWeek = (n) => setWeekRef((r) => { const x = new Date(r); x.setDate(x.getDate() + n * 7); return x; });
  const chip = (on) => ({ padding: "6px 12px", borderRadius: "var(--r-2)", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
    background: on ? "var(--accent)" : "var(--bg-1)", color: on ? "var(--accent-fg)" : "var(--fg-2)", border: "1px solid " + (on ? "var(--accent)" : "var(--line-2)") });

  return (
    <div style={{ padding: "18px 22px", maxWidth: 1040 }}>
      <div style={{ marginBottom: 6 }}>
        <h1 style={{ fontFamily: "var(--display)", fontSize: 22, fontWeight: 700, color: "var(--fg-1)", margin: 0 }}>Agenda</h1>
        <p style={{ fontSize: 13, color: "var(--fg-3)", margin: "4px 0 0" }}>
          Trave horários pra compromissos externos — nenhuma call ou integração é marcada num horário travado.
        </p>
      </div>

      {/* Controles: pessoa · motivo · pontual/recorrente · semana */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", margin: "14px 0 6px" }}>
        <select value={user} onChange={(e) => setUser(e.target.value)}
          style={{ height: 34, padding: "0 10px", borderRadius: "var(--r-2)", background: "var(--bg-1)", color: "var(--fg-1)", border: "1px solid var(--line-2)", fontSize: 13 }}>
          {people.length === 0 && <option value="">sem closers/CS</option>}
          {people.map((p) => <option key={p.id} value={p.id}>{displayName(p.id)}</option>)}
        </select>

        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="motivo (opcional): reunião, folga…"
          style={{ height: 34, flex: "1 1 200px", minWidth: 160, padding: "0 12px", borderRadius: "var(--r-2)", background: "var(--bg-1)", color: "var(--fg-1)", border: "1px solid var(--line-2)", fontSize: 13 }} />

        <div style={{ display: "flex", gap: 6, alignItems: "center" }} title="Pontual = só nessa data. Recorrente = todo aquele dia da semana.">
          <button onClick={() => setRecur("once")} style={chip(recur === "once")}>só esse dia</button>
          <button onClick={() => setRecur("weekly")} style={chip(recur === "weekly")}>↻ toda semana</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <button onClick={() => shiftWeek(-1)} style={navBtn}>‹</button>
        <button onClick={() => setWeekRef(new Date())} style={{ ...navBtn, width: "auto", padding: "0 12px", fontSize: 12.5 }}>hoje</button>
        <button onClick={() => shiftWeek(1)} style={navBtn}>›</button>
        <span className="mono" style={{ fontSize: 12.5, color: "var(--fg-3)", marginLeft: 4 }}>{weekLabel}</span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--fg-4)" }}>
          clique num horário livre pra travar · clique num 🔒 pra liberar
        </span>
      </div>

      {/* Grade: coluna de horas + 5 dias úteis */}
      <div style={{ border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "52px repeat(5, 1fr)" }}>
          {/* header */}
          <div style={{ background: "var(--bg-inset)", borderBottom: "1px solid var(--line-1)" }} />
          {days.map((d, i) => {
            const isToday = ymd(d) === ymd(new Date());
            const dayBlocked = allDayBlocks(d).length > 0;
            return (
              <div key={i} style={{ padding: "8px 6px", textAlign: "center", background: "var(--bg-inset)", borderBottom: "1px solid var(--line-1)", borderLeft: "1px solid var(--line-1)" }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: isToday ? "var(--accent)" : "var(--fg-2)" }}>
                  {WD[d.getDay()]} {d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                </div>
                <button onClick={() => toggleDay(d)} title={dayBlocked ? "liberar o dia inteiro" : "travar o dia inteiro"}
                  style={{ marginTop: 4, fontSize: 10.5, fontWeight: 600, padding: "2px 8px", borderRadius: 999, cursor: "pointer",
                    background: dayBlocked ? "var(--neg-soft)" : "transparent", color: dayBlocked ? "var(--neg)" : "var(--fg-4)",
                    border: "1px solid " + (dayBlocked ? "color-mix(in srgb, var(--neg) 30%, var(--line-2))" : "var(--line-2)") }}>
                  {dayBlocked ? "🔒 dia todo" : "dia inteiro"}
                </button>
              </div>
            );
          })}

          {/* linhas de hora */}
          {Array.from({ length: H1 - H0 }, (_, i) => H0 + i).map((h) => (
            <React.Fragment key={h}>
              <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-4)", textAlign: "right", padding: "0 8px", height: 30, display: "flex", alignItems: "center", justifyContent: "flex-end", borderBottom: "1px solid var(--line-1)" }}>
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
                let bg = "var(--bg-0)", color = "var(--fg-3)", label = "";
                if (call) { bg = "color-mix(in srgb, var(--accent) 12%, var(--bg-0))"; color = "var(--accent)"; label = call.kind === "integ" ? "◑ integr." : "● call"; }
                else if (blocked) { bg = "var(--neg-soft)"; color = "var(--neg)"; label = (weekly ? "🔒↻" : "🔒") + (rsn ? " " + rsn : ""); }
                return (
                  <div key={di}
                    onClick={clickable ? () => toggleCell(d, h) : undefined}
                    title={call ? `${call.name} (já marcado)` : blocked ? `bloqueado${rsn ? ": " + rsn : ""}${weekly ? " · toda semana" : ""} — clique pra liberar` : past ? "horário já passou" : "clique pra travar"}
                    style={{
                      height: 30, borderBottom: "1px solid var(--line-1)", borderLeft: "1px solid var(--line-1)",
                      display: "flex", alignItems: "center", padding: "0 8px", gap: 4,
                      fontSize: 11, fontWeight: blocked || call ? 600 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
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
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", marginTop: 12, fontSize: 12, color: "var(--fg-4)" }}>
        <span><span style={{ color: "var(--accent)" }}>● call</span> = já marcada (não dá pra travar por cima)</span>
        <span><span style={{ color: "var(--neg)" }}>🔒</span> = bloqueado · <span style={{ color: "var(--neg)" }}>🔒↻</span> = recorrente</span>
        <span style={{ marginLeft: "auto" }}>{myBlocks.length} bloqueio{myBlocks.length === 1 ? "" : "s"} de {displayName(user) || "—"}</span>
      </div>
    </div>
  );
}

const navBtn = { width: 32, height: 30, borderRadius: "var(--r-2)", background: "var(--bg-1)", color: "var(--fg-2)", border: "1px solid var(--line-2)", fontSize: 14, cursor: "pointer" };
