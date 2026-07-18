import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { usersByRole, currentUser, displayName, userTone } from "../lib/users.js";
import { PageHead, Segmented } from "../components/viz.jsx";
import { PrimaryButton } from "../atoms.jsx";
import { AgendaView } from "./pipeline.jsx";
import { stageKind } from "../lib/funnel.js";

// Tela Agenda — a agenda DE VERDADE do time, tudo num calendário só:
//   · calls (lead.callAt) e integrações (integrationAt), cores por responsável,
//     clique abre o lead (vem do AgendaView do pipeline);
//   · COMPROMISSOS (kind "event"): título, dono, horário em passos de 30 min,
//     pontual ou recorrente — aparecem na cor da pessoa;
//   · BLOQUEIOS (kind "block"): mesmo registro, tracejado vermelho.
// Clique num horário vazio abre o modal de criar; clique num compromisso ou
// bloqueio abre pra editar/excluir. Ambos entram na "agenda ocupada" (busyView
// em today.jsx) que a SlotGrid consulta em todo lugar que marca call/integração.
// Conflito: só compromisso PRÓPRIO e VIVO da pessoa (call dela como closer fora
// de follow-up/fechado; integração dela como integrador) impede salvar por cima.

const { useState: useS, useEffect: useE, useMemo: useM } = React;

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// Horas fracionadas (7.5 = 07:30, 7.25 = 07:15) viram rótulo HH:MM.
const fmtH = (v) => `${pad(Math.floor(v))}:${pad(Math.round((v % 1) * 60))}`;
// Passos de 15 min de `from` até `to` (inclusive) — o início do compromisso
// acompanha a duração fina (15/45 min).
const quarterHours = (from, to) => Array.from({ length: Math.round((to - from) * 4) + 1 }, (_, i) => from + i * 0.25);
// Call já encerrada não ocupa agenda: follow-up (SDR marca por cima) e lead
// fechado/perdido (o callAt vira história).
const DEAD_CALL_KINDS = new Set(["followup", "ganho", "integracao", "posvenda", "perdido", "desqualificado"]);
const WD_LABEL = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export function AgendaScreen({ onOpenLead }) {
  const { version } = useData();
  // Consultas 1:1 (mentoria UniqueKids): entram na grade e no conflito de
  // horário da responsável, igual call/integração.
  const [consultas, setConsultas] = useS([]);
  useE(() => {
    let alive = true;
    api.list("consultations").then((rows) => alive && setConsultas(rows || [])).catch(() => {});
    return () => { alive = false; };
  }, [version]);
  // Pessoas com agenda: closers e integradores (Ajustes → Equipe).
  const people = useM(() => {
    const seen = new Set(); const out = [];
    for (const u of [...usersByRole("closer"), ...usersByRole("integrator")]) {
      if (!seen.has(u.id)) { seen.add(u.id); out.push(u); }
    }
    return out;
  }, [version]);
  const meId = currentUser()?.id || "";
  const defaultUser = people.some((p) => p.id === meId) ? meId : (people[0]?.id || "");

  const [blocks, setBlocks] = useS(() => (window.SEED?.AGENDA_BLOCKS || []).map((b) => ({ ...b })));
  useE(() => { setBlocks((window.SEED?.AGENDA_BLOCKS || []).map((b) => ({ ...b }))); }, [version]);
  const [leads, setLeads] = useS(() => (window.SEED?.LEADS || []));
  useE(() => { setLeads(window.SEED?.LEADS || []); }, [version]);

  const [editor, setEditor] = useS(null); // { block? , date, fromHour } → modal
  const [notice, setNotice] = useS("");
  const noticeT = React.useRef(null);
  const flash = (msg) => { setNotice(msg); clearTimeout(noticeT.current); noticeT.current = setTimeout(() => setNotice(""), 4000); };

  // Filtro por pessoa: mostra só os eventos/itens dela ("" = time inteiro).
  const [person, setPersonState] = useS(() => { try { return localStorage.getItem("cockpit_agenda_person") || ""; } catch { return ""; } });
  const setPerson = (id) => { setPersonState(id); try { localStorage.setItem("cockpit_agenda_person", id); } catch { /* ignore */ } };

  // Participantes do item: dona principal (user) + convidados (users[]).
  const participantsOf = (b) => [...new Set([b.user, ...(Array.isArray(b.users) ? b.users : [])].filter(Boolean))];

  // Todos os itens do time no calendário, com a cara do dono: compromisso na
  // cor da pessoa principal, bloqueio em vermelho.
  const toneOf = (id) => (id ? `oklch(0.55 0.13 ${userTone(id)})` : "var(--fg-4)");
  const decorate = (b) => {
    const parts = participantsOf(b);
    return {
      ...b,
      _tone: b.kind === "event" ? toneOf(b.user) : null,
      _label: b.kind === "event"
        ? `${b.recur === "weekly" ? "↻ " : ""}${b.title || b.reason || "compromisso"}${parts.length > 1 ? ` · ${parts.length} pessoas` : ""}`
        : `bloqueado${b.recur === "weekly" ? " ↻" : ""}${b.reason ? ` · ${b.reason}` : ""}`,
      _who: parts.map((id) => displayName(id)).join(", "),
    };
  };
  const blocksFor = (day) => {
    const ds = ymd(day), wd = day.getDay();
    return blocks
      .filter((b) => (b.recur === "weekly" ? Number(b.weekday) === wd : b.date === ds))
      .filter((b) => !person || participantsOf(b).includes(person))
      .map(decorate);
  };

  // Compromissos vivos da pessoa nos leads (call como closer, integração como
  // integrador), por (dia, hora) — pro aviso de conflito ao salvar por cima.
  const liveBusy = useM(() => {
    const m = new Map(); // `${user}|${date}|${hour}` -> descrição
    const saasCfgOf = (l) => (window.SEED?.SAAS || []).find((x) => x.id === l.saas);
    const put = (user, at, what) => {
      const d = new Date(at);
      if (Number.isFinite(d.getTime())) m.set(`${user}|${ymd(d)}|${d.getHours()}`, what);
    };
    for (const l of leads) {
      if (l.closer && l.callAt && !DEAD_CALL_KINDS.has(stageKind(saasCfgOf(l), l.stage))) put(l.closer, l.callAt, `call com ${l.name || "lead"}`);
      if (l.integrator && l.integrationAt) put(l.integrator, l.integrationAt, `integração com ${l.name || "lead"}`);
    }
    for (const c of consultas) {
      if (c.owner && c.at && c.status !== "canceled") put(c.owner, c.at, `consulta com ${c.clientName || "cliente"}`);
    }
    return m;
  }, [leads, consultas]);
  // Conflito com a agenda viva da pessoa no intervalo [from, to) da data.
  const liveConflict = (user, date, from, to) => {
    for (let h = Math.floor(from); h < to; h++) {
      const hit = liveBusy.get(`${user}|${date}|${h}`);
      if (hit && from < h + 1 && to > h) return hit;
    }
    return null;
  };

  function addBlock(obj) {
    const tmp = { ...obj, id: `tmp_${Date.now()}_${Math.round(Math.random() * 1e6)}` };
    setBlocks((prev) => [...prev, tmp]);
    api.create("agenda_blocks", obj).catch((err) => { console.warn("item não salvo:", err.message); setBlocks((prev) => prev.filter((b) => b.id !== tmp.id)); });
  }
  function updateBlock(id, patch) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    if (!String(id).startsWith("tmp_")) api.update("agenda_blocks", id, patch).catch((err) => console.warn("item não atualizado:", err.message));
  }
  function removeBlocks(list, { confirmWeekly = true } = {}) {
    if (!list.length) return false;
    if (confirmWeekly && list.some((b) => b.recur === "weekly") && !window.confirm("Item recorrente (toda semana). Remover de todas as semanas?")) return false;
    const ids = new Set(list.map((b) => b.id));
    setBlocks((prev) => prev.filter((b) => !ids.has(b.id)));
    for (const b of list) if (!String(b.id).startsWith("tmp_")) api.remove("agenda_blocks", b.id).catch((err) => console.warn("não removido:", err.message));
    return true;
  }

  // Clique em horário vazio → criar; clique num item → editar.
  const onSlot = (day, hour) => setEditor({ block: null, date: ymd(day), fromHour: hour });
  const onBlock = (b) => setEditor({ block: b, date: b.recur === "once" ? b.date : "", fromHour: Number(b.fromHour) || 9 });

  // Salvar do modal: valida, checa conflito de CADA participante e cria/atualiza.
  // Recorrência abrangente: `weekdaysSel` = dias da semana alvo (null = pontual);
  // cada dia vira um registro weekly. Devolve string de erro ou null quando ok.
  function saveItem(form, existing) {
    const { kind, text, usersSel, date, from, to, weekdaysSel } = form;
    if (!usersSel.length) return "Escolha pelo menos uma pessoa.";
    if (!(to > from)) return "O fim precisa ser depois do início.";
    if (!weekdaysSel && !date) return "Escolha a data.";
    if (weekdaysSel && !weekdaysSel.length) return "Escolha pelo menos um dia da semana.";
    if (kind === "event" && !text.trim()) return "Dê um título pro compromisso.";
    if (!weekdaysSel) {
      for (const u of usersSel) {
        const hit = liveConflict(u, date, from, to);
        if (hit) return `${displayName(u)} já tem ${hit} nesse horário. Remarque antes.`;
      }
    }
    const base = {
      saas: "", user: usersSel[0], users: usersSel, kind, allDay: false, fromHour: from, toHour: to,
      title: kind === "event" ? text.trim() : "",
      reason: kind === "block" ? text.trim() : "",
    };
    if (existing) {
      updateBlock(existing.id, weekdaysSel
        ? { ...base, recur: "weekly", weekday: weekdaysSel[0], date: "" }
        : { ...base, recur: "once", date, weekday: 0 });
      if (weekdaysSel && weekdaysSel.length > 1) {
        for (const w of weekdaysSel.slice(1)) addBlock({ ...base, recur: "weekly", weekday: w });
      }
    } else if (weekdaysSel) {
      for (const w of weekdaysSel) addBlock({ ...base, recur: "weekly", weekday: w });
      if (weekdaysSel.length > 1) {
        flash(`${kind === "event" ? "Compromisso" : "Bloqueio"} criado ${fmtH(from)} às ${fmtH(to)} em ${weekdaysSel.length} dias da semana.`);
      }
    } else {
      addBlock({ ...base, recur: "once", date });
    }
    return null;
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <PageHead title="Agenda" sub="calls, integrações, compromissos e bloqueios do time · clique num horário vazio pra criar">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          {notice && (
            <span style={{ padding: "7px 12px", borderRadius: "var(--r-2)", background: "var(--warn-soft)", color: "var(--warn)", fontSize: 12.5, fontWeight: 500 }}>{notice}</span>
          )}
          <PrimaryButton onClick={() => setEditor({ block: null, date: ymd(new Date()), fromHour: 9 })}>+ compromisso</PrimaryButton>
        </span>
      </PageHead>
      <div style={{ flex: 1, overflow: "auto", padding: "16px var(--pad-x) 56px", display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Filtro por pessoa: calls/integrações/consultas + compromissos/bloqueios dela */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span className="mono" style={{ fontSize: 10.5, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Agenda de</span>
          {[{ id: "", name: "todos" }, ...people].map((p) => {
            const on = person === p.id;
            return (
              <button key={p.id || "all"} onClick={() => setPerson(p.id)}
                style={{ height: 32, padding: "0 13px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                  background: on ? "var(--accent-soft)" : "var(--bg-1)", color: on ? "var(--accent)" : "var(--fg-2)",
                  border: "1px solid " + (on ? "var(--accent-line)" : "var(--line-2)") }}>
                {p.id ? (p.name || displayName(p.id)) : "todos"}
              </button>
            );
          })}
        </div>

        <AgendaView leads={leads} consultations={consultas} onOpenLead={onOpenLead} person={person || null} blocking={{ blocksFor, onSlot, onBlock }} />

        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center", fontSize: 12.5, color: "var(--fg-3)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: "var(--accent-soft)", border: "1px solid var(--accent)" }} />
            compromisso na cor da pessoa · clique pra editar
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: "color-mix(in srgb, var(--neg) 8%, var(--bg-1))", border: "1px dashed var(--neg)" }} />
            bloqueado · ↻ = toda semana
          </span>
          <span>compromissos e bloqueios ocupam a agenda: nenhuma call cai em cima</span>
        </div>
      </div>

      {editor && (
        <AgendaItemModal
          init={editor}
          people={people}
          defaultUser={defaultUser}
          onSave={saveItem}
          onDelete={(b) => removeBlocks([b])}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}

// Modal de criar/editar compromisso ou bloqueio: tipo, título/motivo, pessoas
// (lista dropdown multi-seleção), data, início em passos de 15 min + DURAÇÃO
// (15/30/45/60/90/120) e recorrência abrangente (não repete · toda semana ·
// seg a sex · todos os dias · dias escolhidos). Excluir mora aqui também.
const DUR_OPTIONS = [15, 30, 45, 60, 90, 120];
const durLabel = (m) => (m < 60 ? `${m} min` : m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h${m % 60}`);
const WD_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function AgendaItemModal({ init, people, defaultUser, onSave, onDelete, onClose }) {
  const b = init.block;
  const [kind, setKind] = useS(b ? (b.kind === "event" ? "event" : "block") : "event");
  const [text, setText] = useS(b ? (b.title || b.reason || "") : "");
  // Participantes: mais de uma pessoa = o compromisso aparece (e ocupa) a
  // agenda de todas. A primeira selecionada dá a cor do evento.
  const [sel, setSel] = useS(() => (b
    ? [...new Set([b.user, ...(Array.isArray(b.users) ? b.users : [])].filter(Boolean))]
    : [defaultUser].filter(Boolean)));
  const [selOpen, setSelOpen] = useS(false);
  const toggleSel = (id) => setSel((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const [date, setDate] = useS(init.date || ymd(new Date()));
  const [from, setFrom] = useS(() => Number(b?.fromHour ?? init.fromHour ?? 9));
  const [dur, setDur] = useS(() => {
    const d = b ? Math.round((Number(b.toHour) - Number(b.fromHour)) * 60) : 60;
    return d > 0 ? d : 60;
  });
  // Recorrência: "once" | "weekly" (dia da data) | "weekdays" | "daily" | "custom".
  const [recur, setRecur] = useS(b ? (b.recur === "weekly" ? "weekly" : "once") : "once");
  const [customWds, setCustomWds] = useS(() => (b?.recur === "weekly" ? [Number(b.weekday)] : [1, 3, 5]));
  const [err, setErr] = useS("");
  useE(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const to = from + dur / 60;
  const weekdayLabel = WD_LABEL[date ? new Date(`${date}T12:00:00`).getDay() : Number(b?.weekday) || 1];
  const field = { height: 34, padding: "0 9px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 13, minWidth: 0 };
  const label = { fontSize: 10.5, fontFamily: "var(--mono)", color: "var(--fg-3)", letterSpacing: "0.06em", textTransform: "uppercase", display: "block", marginBottom: 4 };
  const selNames = sel.map((id) => displayName(id) || id);
  const submit = () => {
    const wd = date ? new Date(`${date}T12:00:00`).getDay() : Number(b?.weekday) || 1;
    const weekdaysSel = recur === "once" ? null
      : recur === "weekly" ? [wd]
      : recur === "weekdays" ? [1, 2, 3, 4, 5]
      : recur === "daily" ? [0, 1, 2, 3, 4, 5, 6]
      : [...customWds].sort();
    const e = onSave({ kind, text, usersSel: sel, date, from, to, weekdaysSel }, b || null);
    if (e) setErr(e); else onClose();
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 90, background: "color-mix(in srgb, var(--bg-0) 62%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(440px, 100%)", maxHeight: "min(92vh, 100%)", overflowY: "auto", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-2)", padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "var(--display)", fontSize: 16, fontWeight: 700, flex: 1 }}>
            {b ? "Editar item da agenda" : "Novo item na agenda"}
          </span>
          <button onClick={onClose} aria-label="Fechar" className="mono dim" style={{ fontSize: 15 }}>✕</button>
        </div>

        <Segmented value={kind} onChange={setKind} options={[{ value: "event", label: "Compromisso" }, { value: "block", label: "Bloqueio" }]} />

        <div>
          <span style={label}>{kind === "event" ? "Título" : "Motivo (opcional)"}</span>
          <input autoFocus value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder={kind === "event" ? "reunião com fornecedor, dentista…" : "almoço, folga, compromisso externo…"}
            style={{ ...field, width: "100%" }} />
        </div>

        {/* Pessoas: campo que abre a lista com checkboxes (a agenda de cada
            selecionada fica ocupada). */}
        <div style={{ position: "relative" }}>
          <span style={label}>Pessoas</span>
          <button onClick={() => setSelOpen((v) => !v)}
            style={{ ...field, width: "100%", display: "flex", alignItems: "center", gap: 8, cursor: "pointer", textAlign: "left" }}>
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: sel.length ? "var(--fg-1)" : "var(--fg-4)" }}>
              {sel.length ? selNames.join(", ") : "selecionar…"}
            </span>
            <span className="dim" style={{ fontSize: 11 }}>{selOpen ? "▲" : "▼"}</span>
          </button>
          {selOpen && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 5, marginTop: 4, background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", boxShadow: "var(--shadow-pop)", padding: 4, maxHeight: 200, overflowY: "auto" }}>
              {people.map((p) => (
                <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 9px", borderRadius: 6, fontSize: 13, cursor: "pointer" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                  <input type="checkbox" checked={sel.includes(p.id)} onChange={() => toggleSel(p.id)}
                    style={{ width: 14, height: 14, accentColor: "var(--accent)", cursor: "pointer" }} />
                  {p.name || p.id}
                </label>
              ))}
              {sel.filter((id) => !people.some((p) => p.id === id)).map((id) => (
                <label key={id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 9px", borderRadius: 6, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked onChange={() => toggleSel(id)}
                    style={{ width: 14, height: 14, accentColor: "var(--accent)", cursor: "pointer" }} />
                  {displayName(id)}
                </label>
              ))}
            </div>
          )}
        </div>

        <div>
          <span style={label}>Data</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...field, width: "100%" }} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <span style={label}>Começa às</span>
            <select value={from} onChange={(e) => setFrom(Number(e.target.value))} style={{ ...field, width: "100%" }}>
              {quarterHours(7, 20.75).map((h) => <option key={h} value={h}>{fmtH(h)}</option>)}
            </select>
          </div>
          <div>
            <span style={label}>Duração</span>
            <select value={dur} onChange={(e) => setDur(Number(e.target.value))} style={{ ...field, width: "100%" }}>
              {DUR_OPTIONS.map((m) => <option key={m} value={m}>{durLabel(m)}</option>)}
              {!DUR_OPTIONS.includes(dur) && <option value={dur}>{durLabel(dur)}</option>}
            </select>
          </div>
        </div>
        <div className="mono dim" style={{ fontSize: 11, marginTop: -6 }}>termina às {fmtH(to)}</div>

        <div>
          <span style={label}>Repete</span>
          <select value={recur} onChange={(e) => setRecur(e.target.value)} style={{ ...field, width: "100%" }}>
            <option value="once">não repete (só {date ? date.slice(8, 10) + "/" + date.slice(5, 7) : "essa data"})</option>
            <option value="weekly">toda {weekdayLabel}</option>
            <option value="weekdays">segunda a sexta, toda semana</option>
            <option value="daily">todos os dias, toda semana</option>
            <option value="custom">dias escolhidos…</option>
          </select>
          {recur === "custom" && (
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 8 }}>
              {WD_SHORT.map((wLabel, w) => {
                const on = customWds.includes(w);
                return (
                  <button key={w} onClick={() => setCustomWds((prev) => (prev.includes(w) ? prev.filter((x) => x !== w) : [...prev, w]))}
                    style={{ height: 30, padding: "0 11px", borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: "pointer",
                      background: on ? "var(--accent-soft)" : "var(--bg-1)", color: on ? "var(--accent)" : "var(--fg-2)",
                      border: "1px solid " + (on ? "var(--accent-line)" : "var(--line-2)") }}>
                    {wLabel}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {err && <div style={{ padding: "8px 10px", borderRadius: "var(--r-2)", background: "var(--warn-soft)", color: "var(--warn)", fontSize: 12.5 }}>{err}</div>}

        <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
          {b && (
            <button onClick={() => { if (onDelete(b)) onClose(); }}
              style={{ height: 36, padding: "0 14px", borderRadius: "var(--r-2)", border: "1px solid color-mix(in srgb, var(--neg) 40%, transparent)", background: "var(--neg-soft)", color: "var(--neg)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              Excluir
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={{ height: 36, padding: "0 14px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 13, cursor: "pointer" }}>Cancelar</button>
          <PrimaryButton onClick={submit}>{b ? "Salvar" : "Criar"}</PrimaryButton>
        </div>
      </div>
    </div>
  );
}
