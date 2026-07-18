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
// Horas fracionadas (7.5 = 07:30) viram rótulo HH:MM.
const fmtH = (v) => `${pad(Math.floor(v))}:${v % 1 ? "30" : "00"}`;
// Passos de 30 min de `from` até `to` (inclusive).
const halfHours = (from, to) => Array.from({ length: Math.round((to - from) * 2) + 1 }, (_, i) => from + i * 0.5);
// Call já encerrada não ocupa agenda: follow-up (SDR marca por cima) e lead
// fechado/perdido (o callAt vira história).
const DEAD_CALL_KINDS = new Set(["followup", "ganho", "integracao", "posvenda", "perdido", "desqualificado"]);
const WD_LABEL = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export function AgendaScreen({ onOpenLead }) {
  const { version } = useData();
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
    return m;
  }, [leads]);
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
  // Devolve string de erro pra mostrar no próprio modal, ou null quando deu certo.
  function saveItem(form, existing) {
    const { kind, text, usersSel, date, from, to, recur } = form;
    if (!usersSel.length) return "Escolha pelo menos uma pessoa.";
    if (!(to > from)) return "O fim precisa ser depois do início.";
    if (recur === "once" && !date) return "Escolha a data.";
    if (kind === "event" && !text.trim()) return "Dê um título pro compromisso.";
    if (recur === "once") {
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
    const wd = date ? new Date(`${date}T12:00:00`).getDay() : Number(existing?.weekday) || 1;
    if (existing) {
      updateBlock(existing.id, recur === "weekly"
        ? { ...base, recur: "weekly", weekday: wd, date: "" }
        : { ...base, recur: "once", date, weekday: 0 });
    } else if (recur === "weekdays") {
      for (let w = 1; w <= 5; w++) addBlock({ ...base, recur: "weekly", weekday: w });
      flash(`${kind === "event" ? "Compromisso" : "Bloqueio"} criado de segunda a sexta, ${fmtH(from)} às ${fmtH(to)}.`);
    } else if (recur === "weekly") {
      addBlock({ ...base, recur: "weekly", weekday: wd });
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
        {/* Filtro por pessoa: calls/integrações + compromissos/bloqueios dela */}
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

        <AgendaView leads={leads} onOpenLead={onOpenLead} person={person || null} blocking={{ blocksFor, onSlot, onBlock }} />

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

// Modal de criar/editar compromisso ou bloqueio: tipo, título/motivo, pessoa,
// data, de/até em passos de 30 min e recorrência (pontual · toda semana ·
// seg a sex). Excluir mora aqui também.
function AgendaItemModal({ init, people, defaultUser, onSave, onDelete, onClose }) {
  const b = init.block;
  const [kind, setKind] = useS(b ? (b.kind === "event" ? "event" : "block") : "event");
  const [text, setText] = useS(b ? (b.title || b.reason || "") : "");
  // Participantes: mais de uma pessoa = o compromisso aparece (e ocupa) a
  // agenda de todas. A primeira selecionada dá a cor do evento.
  const [sel, setSel] = useS(() => {
    const init0 = b ? [...new Set([b.user, ...(Array.isArray(b.users) ? b.users : [])].filter(Boolean))] : [defaultUser].filter(Boolean);
    return init0;
  });
  const toggleSel = (id) => setSel((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const [date, setDate] = useS(init.date || ymd(new Date()));
  const [from, setFrom] = useS(() => Number(b?.fromHour ?? init.fromHour ?? 9));
  const [to, setTo] = useS(() => Number(b?.toHour ?? ((b?.fromHour ?? init.fromHour ?? 9) + 1)));
  const [recur, setRecur] = useS(b ? (b.recur === "weekly" ? "weekly" : "once") : "once");
  const [err, setErr] = useS("");
  useE(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const weekdayLabel = WD_LABEL[date ? new Date(`${date}T12:00:00`).getDay() : Number(b?.weekday) || 1];
  const field = { height: 34, padding: "0 9px", borderRadius: "var(--r-2)", border: "1px solid var(--line-2)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 13, minWidth: 0 };
  const label = { fontSize: 10.5, fontFamily: "var(--mono)", color: "var(--fg-3)", letterSpacing: "0.06em", textTransform: "uppercase", display: "block", marginBottom: 4 };
  const submit = () => {
    const e = onSave({ kind, text, usersSel: sel, date, from, to, recur }, b || null);
    if (e) setErr(e); else onClose();
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 90, background: "color-mix(in srgb, var(--bg-0) 62%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(440px, 100%)", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-2)", padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
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

        <div>
          <span style={label}>Pessoas (a agenda de cada uma fica ocupada)</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {people.map((p) => {
              const on = sel.includes(p.id);
              return (
                <button key={p.id} onClick={() => toggleSel(p.id)}
                  style={{ height: 30, padding: "0 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                    background: on ? "var(--accent-soft)" : "var(--bg-1)", color: on ? "var(--accent)" : "var(--fg-2)",
                    border: "1px solid " + (on ? "var(--accent-line)" : "var(--line-2)") }}>
                  {on ? "✓ " : ""}{p.name || p.id}
                </button>
              );
            })}
            {sel.filter((id) => !people.some((p) => p.id === id)).map((id) => (
              <button key={id} onClick={() => toggleSel(id)}
                style={{ height: 30, padding: "0 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                  background: "var(--accent-soft)", color: "var(--accent)", border: "1px solid var(--accent-line)" }}>
                ✓ {displayName(id)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span style={label}>Data</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...field, width: "100%" }} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <span style={label}>Das</span>
            <select value={from} onChange={(e) => { const v = Number(e.target.value); setFrom(v); if (to <= v) setTo(v + 0.5); }} style={{ ...field, width: "100%" }}>
              {halfHours(7, 20.5).map((h) => <option key={h} value={h}>{fmtH(h)}</option>)}
            </select>
          </div>
          <div>
            <span style={label}>Às</span>
            <select value={to} onChange={(e) => setTo(Number(e.target.value))} style={{ ...field, width: "100%" }}>
              {halfHours(from + 0.5, 21).map((h) => <option key={h} value={h}>{fmtH(h)}</option>)}
            </select>
          </div>
        </div>

        <div>
          <span style={label}>Repete</span>
          <select value={recur} onChange={(e) => setRecur(e.target.value)} style={{ ...field, width: "100%" }}>
            <option value="once">não repete (só {date ? date.slice(8, 10) + "/" + date.slice(5, 7) : "essa data"})</option>
            <option value="weekly">toda {weekdayLabel}</option>
            {!b && <option value="weekdays">segunda a sexta, toda semana</option>}
          </select>
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
