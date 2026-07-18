import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { usersByRole, currentUser, displayName } from "../lib/users.js";
import { PageHead, Segmented } from "../components/viz.jsx";
import { AgendaView } from "./pipeline.jsx";
import { stageKind } from "../lib/funnel.js";

// Tela Agenda — a MESMA visão semanal do pipeline (calls + integrações do time,
// cores por responsável, clique abre o lead) + o travar horários por cima:
// clica num horário vazio pra bloquear a agenda da pessoa selecionada (pontual
// ou toda semana); clica no bloqueio pra liberar. Os bloqueios entram na
// "agenda ocupada" (busyView em today.jsx) que a SlotGrid consulta em todo
// lugar que marca call/integração.
// Regra de conflito: só compromisso PRÓPRIO e VIVO da pessoa impede o bloqueio
// (call dela como closer fora de follow-up/fechado; integração dela como
// integrador). Evento dos outros no mesmo horário não trava a SUA agenda.

const { useState: useS, useEffect: useE, useMemo: useM } = React;

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const keyOf = (dateStr, h) => `${dateStr}-${pad(h)}`;
// Call já encerrada não ocupa agenda: follow-up (SDR marca por cima) e lead
// fechado/perdido (o callAt vira história; o horário pode ser de outra pessoa,
// ex. a integração do CS no mesmo slot).
const DEAD_CALL_KINDS = new Set(["followup", "ganho", "integracao", "posvenda", "perdido", "desqualificado"]);

export function AgendaScreen({ onOpenLead }) {
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

  const [reason, setReason] = useS("");
  const [recur, setRecur] = useS("once"); // "once" | "weekly"
  const [notice, setNotice] = useS("");
  const noticeT = React.useRef(null);
  const flash = (msg) => { setNotice(msg); clearTimeout(noticeT.current); noticeT.current = setTimeout(() => setNotice(""), 4000); };

  const [blocks, setBlocks] = useS(() => (window.SEED?.AGENDA_BLOCKS || []).map((b) => ({ ...b })));
  useE(() => { setBlocks((window.SEED?.AGENDA_BLOCKS || []).map((b) => ({ ...b }))); }, [version]);
  const [leads, setLeads] = useS(() => (window.SEED?.LEADS || []));
  useE(() => { setLeads(window.SEED?.LEADS || []); }, [version]);

  const myBlocks = useM(() => blocks.filter((b) => b.user === user), [blocks, user]);
  const blocksFor = (day) => {
    const ds = ymd(day), wd = day.getDay();
    return myBlocks.filter((b) => (b.recur === "weekly" ? Number(b.weekday) === wd : b.date === ds));
  };

  // Compromissos vivos da PRÓPRIA pessoa selecionada, por (dia, hora).
  const ownBusy = useM(() => {
    const m = new Map();
    const saasCfgOf = (l) => (window.SEED?.SAAS || []).find((x) => x.id === l.saas);
    for (const l of leads) {
      if (l.closer === user && l.callAt && !DEAD_CALL_KINDS.has(stageKind(saasCfgOf(l), l.stage))) {
        const d = new Date(l.callAt);
        if (Number.isFinite(d.getTime())) m.set(keyOf(ymd(d), d.getHours()), `call com ${l.name || "lead"}`);
      }
      if (l.integrator === user && l.integrationAt) {
        const d = new Date(l.integrationAt);
        if (Number.isFinite(d.getTime())) m.set(keyOf(ymd(d), d.getHours()), `integração com ${l.name || "lead"}`);
      }
    }
    return m;
  }, [leads, user]);

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

  function onSlot(day, hour) {
    const ds = ymd(day);
    const cov = blocksFor(day).filter((b) => b.allDay || (hour >= Number(b.fromHour) && hour < Number(b.toHour)));
    if (cov.length) return removeBlocks(cov);
    const own = ownBusy.get(keyOf(ds, hour));
    if (own) return flash(`${pad(hour)}:00 tem ${own} na agenda de ${displayName(user)}. Remarque antes de travar.`);
    const cell = new Date(day); cell.setHours(hour, 0, 0, 0);
    if (recur === "once" && cell.getTime() < Date.now()) return flash("Esse horário já passou. Use ↻ toda semana pra travar o horário daqui pra frente.");
    addBlock(recur === "weekly"
      ? { saas: "", user, recur: "weekly", weekday: day.getDay(), allDay: false, fromHour: hour, toHour: hour + 1, reason: reason.trim() }
      : { saas: "", user, recur: "once", date: ds, allDay: false, fromHour: hour, toHour: hour + 1, reason: reason.trim() });
  }

  const personChip = (on) => ({ height: 34, padding: "0 13px", borderRadius: "var(--r-2)", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
    background: on ? "var(--accent-soft)" : "var(--bg-1)", color: on ? "var(--accent)" : "var(--fg-2)", border: "1px solid " + (on ? "var(--accent-line)" : "var(--line-2)") });

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <PageHead title="Agenda" sub="a semana do time (calls + integrações) · clique num horário vazio pra travar a agenda da pessoa selecionada" />
      <div style={{ flex: 1, overflow: "auto", padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 14 }}>

        {/* Controles do travamento: pessoa · motivo · pontual/recorrente */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span className="mono" style={{ fontSize: 10.5, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Travar horários de</span>
          {people.length === 0 && <span className="dim" style={{ fontSize: 12.5 }}>sem closers/CS</span>}
          {people.map((p) => <button key={p.id} onClick={() => setUser(p.id)} style={personChip(user === p.id)}>{displayName(p.id)}</button>)}

          <span style={{ width: 1, height: 18, background: "var(--line-1)", margin: "0 4px" }} />

          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="motivo (opcional): reunião, folga…"
            style={{ height: 38, width: 240, padding: "0 12px", borderRadius: "var(--r-2)", background: "var(--bg-1)", color: "var(--fg-1)", border: "1px solid var(--line-2)", fontSize: 13 }} />

          <div title="Pontual = só nessa data. Recorrente = todo aquele dia da semana.">
            <Segmented value={recur} onChange={setRecur} options={[{ value: "once", label: "só esse dia" }, { value: "weekly", label: "↻ toda semana" }]} />
          </div>

          {notice && (
            <span style={{ padding: "7px 12px", borderRadius: "var(--r-2)", background: "var(--warn-soft)", color: "var(--warn)", fontSize: 12.5, fontWeight: 500 }}>{notice}</span>
          )}
        </div>

        <AgendaView leads={leads} onOpenLead={onOpenLead} blocking={{ blocksFor, onSlot, onBlock: (b) => removeBlocks([b]) }} />

        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center", fontSize: 12.5, color: "var(--fg-3)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: "color-mix(in srgb, var(--neg) 8%, var(--bg-1))", border: "1px dashed var(--neg)" }} />
            bloqueado de {displayName(user) || "—"} · ↻ = toda semana · clique pra liberar
          </span>
          <span>evento de outra pessoa no mesmo horário não impede o seu bloqueio</span>
          <span style={{ marginLeft: "auto" }}>{myBlocks.length} bloqueio{myBlocks.length === 1 ? "" : "s"} de {displayName(user) || "—"}</span>
        </div>
      </div>
    </div>
  );
}
