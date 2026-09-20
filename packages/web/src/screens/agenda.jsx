import React from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { usersByRole, currentUser, displayName, userColor } from "../lib/users.js";
import { Segmented } from "../components/viz.jsx";
import { PrimaryButton } from "../atoms.jsx";
import { AgendaView } from "./agenda-grid.jsx";
import { stageKind } from "../lib/funnel.js";
import { isNoShowStage } from "../lib/scripts.js";
import { Drawer } from "../components/overlay.jsx";
import { useActiveSaas } from "../lib/workspace.js";
import "./agenda.css";

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
// As quatro visões da agenda. Dia e Semana já existiam dentro da grade (num
// par de FilterTab perdido no meio dos filtros); Mês e Equipe entram no
// redesign de 12/09.
const VIEW_OPTIONS = [
  { value: "day", label: "Dia" },
  { value: "week", label: "Semana" },
  { value: "month", label: "Mês" },
  { value: "team", label: "Equipe" },
];

export function AgendaScreen({ onOpenLead }) {
  const { version } = useData();
  // Agenda POR PRODUTO: o workspace ativo vê só os seus compromissos. Leads
  // (calls/integrações) e consultas filtram por saas; compromissos/bloqueios
  // nascem carimbados com o produto e a grade só mostra os dele (legado sem
  // saas aparece em todos, pra não sumir os antigos).
  const [product] = useActiveSaas();
  const saasId = product?.id || "";
  const ofSaas = (x) => !saasId || !x?.saas || x.saas === saasId;

  // Consultas 1:1 (mentoria UniqueKids): entram na grade e no conflito de
  // horário da responsável, igual call/integração.
  const [consultas, setConsultas] = useS([]);
  useE(() => {
    let alive = true;
    api.list("consultations").then((rows) => alive && setConsultas((rows || []).filter(ofSaas))).catch(() => {});
    return () => { alive = false; };
  }, [version, saasId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Pessoas com agenda: closers e integradores (Ajustes → Equipe) do produto
  // ativo — pessoa de OUTRO produto (ex.: Ana só UniqueKids) não entra no filtro.
  const people = useM(() => {
    const seen = new Set(); const out = [];
    for (const u of [...usersByRole("closer"), ...usersByRole("integrator")]) {
      if (!seen.has(u.id) && (!u.saas || u.saas === saasId)) { seen.add(u.id); out.push(u); }
    }
    return out;
  }, [version, saasId]);
  const meId = currentUser()?.id || "";
  const defaultUser = people.some((p) => p.id === meId) ? meId : (people[0]?.id || "");

  const [blocks, setBlocks] = useS(() => (window.SEED?.AGENDA_BLOCKS || []).map((b) => ({ ...b })));
  useE(() => { setBlocks((window.SEED?.AGENDA_BLOCKS || []).map((b) => ({ ...b }))); }, [version]);
  const [leads, setLeads] = useS(() => (window.SEED?.LEADS || []).filter(ofSaas));
  useE(() => { setLeads((window.SEED?.LEADS || []).filter(ofSaas)); }, [version, saasId]); // eslint-disable-line react-hooks/exhaustive-deps

  const [editor, setEditor] = useS(null); // { block? , date, fromHour } → modal
  const [notice, setNotice] = useS("");
  const noticeT = React.useRef(null);
  const flash = (msg) => { setNotice(msg); clearTimeout(noticeT.current); noticeT.current = setTimeout(() => setNotice(""), 4000); };

  // VISÃO: dia · semana · mês · equipe. Mora aqui (e não dentro da grade)
  // porque o alternador é do cabeçalho da tela, ao lado de "+ compromisso" —
  // a grade continua guardando a escolha no mesmo localStorage.
  const [view, setViewState] = useS(() => { try { return localStorage.getItem("cockpit_agenda_view") || "day"; } catch { return "day"; } });
  const setView = (v) => { setViewState(v); try { localStorage.setItem("cockpit_agenda_view", v); } catch { /* ignore */ } };

  // Filtro por pessoa: mostra só os eventos/itens dela ("" = time inteiro).
  const [person, setPersonState] = useS(() => { try { return localStorage.getItem("cockpit_agenda_person") || ""; } catch { return ""; } });
  const setPerson = (id) => { setPersonState(id); try { localStorage.setItem("cockpit_agenda_person", id); } catch { /* ignore */ } };

  // ── Os avisos da semana (protótipo, 14/09) ──────────────────────────────
  // A tela abria direto na grade: quem furou, quem não confirmou e quem passou
  // do horário sem remarcar só apareciam pra quem cruzasse o calendário com o
  // olho. São as três perguntas com PRAZO que a agenda responde, então sobem
  // pro topo com a ação do lado (regra 2 do handoff).
  //
  // Cada número sai dos MESMOS leads que a grade desenha, não de literal.
  const avisos = useM(() => {
    const saasCfg = (window.SEED?.SAAS || []).find((x) => x.id === saasId) || null;
    const agora = Date.now();
    const hoje0 = new Date(); hoje0.setHours(0, 0, 0, 0);
    const fimHoje = new Date(); fimHoje.setHours(23, 59, 59, 999);
    const semana0 = new Date(hoje0); semana0.setDate(semana0.getDate() - ((semana0.getDay() + 6) % 7));

    const furaram = [];      // call marcada que passou e o lead caiu em no-show
    const semConfirmar = []; // call de HOJE que o lead ainda não confirmou
    const semRemarcar = [];  // passou do horário e não há novo compromisso
    for (const l of leads) {
      const t = l.callAt ? new Date(l.callAt).getTime() : NaN;
      if (!Number.isFinite(t)) continue;
      const kind = stageKind(saasCfg, l.stage);
      if (isNoShowStage(saasCfg, l.stage) && t >= semana0.getTime() && t <= agora) { furaram.push(l); continue; }
      if (DEAD_CALL_KINDS.has(kind)) continue;
      if (t >= hoje0.getTime() && t <= fimHoje.getTime() && t > agora && !l.callConfirmed) { semConfirmar.push(l); continue; }
      if (t < agora) {
        const prox = l.nextActionAt ? new Date(l.nextActionAt).getTime() : NaN;
        if (!Number.isFinite(prox) || prox < agora) semRemarcar.push(l);
      }
    }
    return { furaram, semConfirmar, semRemarcar };
  }, [leads, saasId, version]);

  // Participantes do item: dona principal (user) + convidados (users[]).
  const participantsOf = (b) => [...new Set([b.user, ...(Array.isArray(b.users) ? b.users : [])].filter(Boolean))];

  // Todos os itens do time no calendário, com a cara do dono: compromisso na
  // cor da pessoa principal, bloqueio em vermelho.
  const toneOf = (id) => (id ? userColor(id) : "var(--fg-4)");
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
      .filter(ofSaas) // produto ativo (bloqueio legado sem saas aparece em todos)
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

  async function addBlock(obj) {
    const saved = await api.create("agenda_blocks", obj);
    setBlocks((prev) => [...prev.filter((b) => b.id !== saved.id), saved]);
  }
  async function updateBlock(id, patch) {
    await api.update("agenda_blocks", id, patch);
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }
  async function removeBlocks(list) {
    for (const b of list) {
      await api.remove("agenda_blocks", b.id);
      setBlocks((prev) => prev.filter((item) => item.id !== b.id));
    }
    return true;
  }

  // Clique em horário vazio → criar; clique num item → editar.
  // A visão Equipe manda também a PESSOA da coluna: clicar no vão livre do
  // Rafael já abre o modal com ele selecionado.
  const onSlot = (day, hour, user) => setEditor({ block: null, date: ymd(day), fromHour: hour, user: user || "" });
  const onBlock = (b) => setEditor({ block: b, date: b.recur === "once" ? b.date : "", fromHour: Number(b.fromHour) || 9 });

  // Salvar do modal: valida, checa conflito de CADA participante e cria/atualiza.
  // Recorrência abrangente: `weekdaysSel` = dias da semana alvo (null = pontual);
  // cada dia vira um registro weekly. Devolve string de erro ou null quando ok.
  async function saveItem(form, existing) {
    const { kind, text, usersSel, date, weekdaysSel } = form;
    const allDay = !!form.allDay;
    // Dia inteiro: ocupa o dia todo (fromHour/toHour cobrem a grade); o render e o
    // matchBlock já tratam allDay. Sem allDay, usa o intervalo escolhido.
    const from = allDay ? 0 : form.from;
    const to = allDay ? 24 : form.to;
    if (!usersSel.length) return "Escolha pelo menos uma pessoa.";
    if (!allDay && !(to > from)) return "O fim precisa ser depois do início.";
    if (!weekdaysSel && !date) return "Escolha a data.";
    if (weekdaysSel && !weekdaysSel.length) return "Escolha pelo menos um dia da semana.";
    if (kind === "event" && !text.trim()) return "Dê um título pro compromisso.";
    if (!weekdaysSel) {
      for (const u of usersSel) {
        const hit = liveConflict(u, date, from, to);
        if (hit) return `${displayName(u)} já tem ${hit} nesse ${allDay ? "dia" : "horário"}. Remarque antes.`;
      }
    }
    const base = {
      saas: saasId, user: usersSel[0], users: usersSel, kind, allDay, fromHour: from, toHour: to,
      title: kind === "event" ? text.trim() : "",
      reason: kind === "block" ? text.trim() : "",
    };
    const writes = [];
    if (existing) {
      writes.push(updateBlock(existing.id, weekdaysSel
        ? { ...base, recur: "weekly", weekday: weekdaysSel[0], date: "" }
        : { ...base, recur: "once", date, weekday: 0 }));
      if (weekdaysSel && weekdaysSel.length > 1) {
        for (const w of weekdaysSel.slice(1)) writes.push(addBlock({ ...base, recur: "weekly", weekday: w }));
      }
    } else if (weekdaysSel) {
      for (const w of weekdaysSel) writes.push(addBlock({ ...base, recur: "weekly", weekday: w }));
    } else {
      writes.push(addBlock({ ...base, recur: "once", date }));
    }
    const results = await Promise.allSettled(writes);
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length) {
      const saved = results.length - failed.length;
      return { partial: saved > 0, message: saved
        ? `${saved} item(ns) salvo(s), ${failed.length} falharam. Feche e confira a agenda antes de criar os dias restantes.`
        : "Não foi possível salvar. Seus dados continuam aqui; tente novamente." };
    }
    flash(existing ? "Compromisso atualizado." : "Item criado na agenda.");
    return null;
  }

  return (
    <div className="agenda-page">
      <header className="agenda-head"><h1>Agenda</h1>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          {notice && (
            <span style={{ padding: "7px 12px", borderRadius: "var(--r-2)", background: "var(--warn-soft)", color: "var(--warn)", fontSize: 12.5, fontWeight: 500 }}>{notice}</span>
          )}
          {/* A visão desceu pro topo da GRADE (prancha, 14/09): ela manda no
              mesmo eixo que a navegação de período, e as duas ficavam em
              barras diferentes. */}
          <button className="agenda-primary" onClick={() => setEditor({ block: null, date: ymd(new Date()), fromHour: 9 })}>Criar compromisso</button>
        </span>
      </header>
      <div className="agenda-content">
        {/* Os avisos da semana, no máximo dois por vez: o mais urgente é o que
            já furou, depois quem passou do horário sem remarcar, e a
            confirmação de hoje fecha. Três faixas empilhadas empurram a grade
            pra baixo da dobra, que é a lacuna que o próprio protótipo anotou. */}
        {(avisos.furaram.length + avisos.semRemarcar.length + avisos.semConfirmar.length > 0) && <section className="agenda-notices-card">
        <div className="agenda-notices">
        {[
          avisos.furaram.length > 0 && {
            key: "furou", tom: "neg",
            titulo: `${avisos.furaram.length} ${avisos.furaram.length === 1 ? "compromisso furou" : "compromissos furaram"} nesta semana`,
            nota: avisos.furaram.slice(0, 3).map((l) => l.name).join(" · ") + (avisos.furaram.length > 3 ? ` +${avisos.furaram.length - 3}` : ""),
            acao: { label: avisos.furaram.length === 1 ? "abrir o lead" : "abrir o primeiro", onClick: () => onOpenLead && onOpenLead(avisos.furaram[0]) },
          },
          avisos.semRemarcar.length > 0 && {
            key: "remarcar", tom: "neg",
            titulo: `${avisos.semRemarcar.length} ${avisos.semRemarcar.length === 1 ? "lead passou do horário" : "leads passaram do horário"} e não têm novo compromisso`,
            nota: "sem próximo toque marcado, o card para de aparecer na fila do dia",
            acao: { label: "abrir a fila", href: "#today" },
          },
          avisos.semConfirmar.length > 0 && {
            key: "confirmar", tom: "warn",
            titulo: `${avisos.semConfirmar.length} ${avisos.semConfirmar.length === 1 ? "call de hoje sem confirmação" : "calls de hoje sem confirmação"} do lead`,
            nota: "silêncio na confirmação é o maior sinal de furo",
            acao: { label: "cobrar confirmação", href: "#today" },
          },
        ].filter(Boolean).slice(0, 2).map((a) => (
          <div key={a.key} className="agenda-notice" style={{ "--notice-tone": `var(--${a.tom})` }}>
            <span className="agenda-notice-bar" />
            <div><strong>{a.titulo}</strong><span>{a.nota}</span></div>
            {a.acao.href ? <a className="agenda-primary" href={a.acao.href}>{a.acao.label}</a>
              : <button className="agenda-primary" onClick={a.acao.onClick}>{a.acao.label}</button>}
          </div>
        ))}
        </div>
        </section>}
        <AgendaView leads={leads} consultations={consultas} onOpenLead={onOpenLead}
          person={person || null} people={people} onPerson={setPerson}
          view={view} onView={setView}
          blocking={{ blocksFor, onSlot, onBlock }} />
      </div>

      {editor && (
        <AgendaItemModal
          init={editor}
          people={people}
          defaultUser={defaultUser}
          onSave={saveItem}
          conflictOf={liveConflict}
          onDelete={(b) => removeBlocks([b])}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}

// Modal de criar/editar compromisso ou bloqueio: tipo, título/motivo, pessoas
// (lista dropdown multi-seleção), data, início em passos de 15 min + DURAÇÃO
// (15 min a 6h) e recorrência abrangente (não repete · toda semana · seg a sex ·
// todos os dias · dias escolhidos). Excluir mora aqui também.
//
// A escada vai de meia em meia hora até 4h e de hora em hora até 6h (Leo,
// 21/08): reunião longa, treinamento e dia de integração não cabiam em 2h, e
// meia hora de granularidade num bloco de 5h não muda nada na prática.
const DUR_OPTIONS = [15, 30, 45, 60, 90, 120, 150, 180, 210, 240, 300, 360];
const durLabel = (m) => (m < 60 ? `${m} min` : m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h${m % 60}`);
const WD_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

// Data de referência do formulário. Item SEMANAL não guarda data (só o dia da
// semana), e o formulário deriva do campo DATA tanto o rótulo ("toda quarta")
// quanto o `weekday` que SALVA. Cair no dia de hoje quando não há data foi um
// bug de perder dado: abrir um compromisso de quinta numa quarta mostrava "toda
// quarta" e salvar MOVIA o compromisso pro dia em que a pessoa mexeu nele.
// Agora a referência sai do weekday GRAVADO: a próxima data que cai nesse dia.
export function formDateFor(init, now = new Date()) {
  if (init?.date) return ymd(init.date instanceof Date ? init.date : new Date(`${init.date}T12:00:00`));
  const b = init?.block;
  const d = new Date(now); d.setHours(12, 0, 0, 0);
  if (b?.recur === "weekly" && Number.isFinite(Number(b.weekday))) {
    d.setDate(d.getDate() + ((Number(b.weekday) - d.getDay() + 7) % 7));
  } else if (b?.date) {
    return b.date;
  }
  return ymd(d);
}

export function AgendaItemModal({ init, people, defaultUser, onSave, onDelete, onClose, conflictOf }) {
  const b = init.block;
  const [kind, setKind] = useS(b ? (b.kind === "event" ? "event" : "block") : "event");
  const [text, setText] = useS(b ? (b.title || b.reason || "") : "");
  // Participantes: mais de uma pessoa = o compromisso aparece (e ocupa) a
  // agenda de todas. A primeira selecionada dá a cor do evento.
  const [sel, setSel] = useS(() => (b
    ? [...new Set([b.user, ...(Array.isArray(b.users) ? b.users : [])].filter(Boolean))]
    : [init.user || defaultUser].filter(Boolean)));
  const toggleSel = (id) => setSel((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const [date, setDate] = useS(() => formDateFor(init));
  const [from, setFrom] = useS(() => Number(b?.fromHour ?? init.fromHour ?? 9));
  const [dur, setDur] = useS(() => {
    const d = b ? Math.round((Number(b.toHour) - Number(b.fromHour)) * 60) : 60;
    return d > 0 ? d : 60;
  });
  const [allDay, setAllDay] = useS(!!b?.allDay);
  const [durOpen, setDurOpen] = useS(false); // "outra ▾": a escada inteira de duração
  // Recorrência: "once" | "weekly" (dia da data) | "weekdays" | "daily" | "custom".
  const [recur, setRecur] = useS(b ? (b.recur === "weekly" ? "weekly" : "once") : "once");
  const [customWds, setCustomWds] = useS(() => (b?.recur === "weekly" ? [Number(b.weekday)] : [1, 3, 5]));
  const [err, setErr] = useS("");
  const [busy, setBusy] = useS(false);
  const pending = React.useRef(false);
  const [partial, setPartial] = useS(false);
  const formState = JSON.stringify({ kind, text, sel, date, from, dur, allDay, recur, customWds });
  const initialState = React.useRef(formState);
  const close = () => {
    if (pending.current) return;
    if (!partial && formState !== initialState.current && !window.confirm("Descartar as alterações deste compromisso?")) return;
    onClose();
  };
  const remove = async () => {
    if (pending.current || !window.confirm(b.recur === "weekly" ? "Excluir este item de todas as semanas?" : "Excluir este item da agenda?")) return;
    pending.current = true; setBusy(true); setErr("");
    try { if (await onDelete(b)) onClose(); }
    catch { setErr("Não foi possível excluir. O item continua na agenda; tente novamente."); }
    finally { pending.current = false; setBusy(false); }
  };

  const to = from + dur / 60;
  // CONFLITO VIVO (12/09): o mesmo liveConflict que o saveItem chama, agora
  // consultado a cada render. Antes você montava o compromisso inteiro pra
  // descobrir no submit que o Rafael já tinha call nesse horário. Item
  // recorrente não é checado (nem no salvar), então aqui também não avisa.
  const conflitos = (recur === "once" && conflictOf && date)
    ? sel.map((u) => ({ u, hit: conflictOf(u, date, allDay ? 0 : from, allDay ? 24 : to) })).filter((x) => x.hit)
    : [];
  // Sem data não tem como derivar: cai no weekday gravado (0 = domingo é dia
  // válido, então nada de `|| 1`, que engolia domingo virando segunda).
  const weekdayLabel = WD_LABEL[date ? new Date(`${date}T12:00:00`).getDay() : (Number(b?.weekday) || 0)];
  const field = { height: 38, padding: "0 14px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-1)", fontSize: 13, minWidth: 0 };
  const label = { display: "block", marginBottom: 4 };
  const submit = async () => {
    if (pending.current || partial) return;
    pending.current = true; setBusy(true); setErr("");
    const wd = date ? new Date(`${date}T12:00:00`).getDay() : (Number(b?.weekday) || 0);
    const weekdaysSel = recur === "once" ? null
      : recur === "weekly" ? [wd]
      : recur === "weekdays" ? [1, 2, 3, 4, 5]
      : recur === "daily" ? [0, 1, 2, 3, 4, 5, 6]
      : [...customWds].sort();
    try {
      const e = await onSave({ kind, text, usersSel: sel, date, from, to, weekdaysSel, allDay }, b || null);
      if (e) { setErr(typeof e === "string" ? e : e.message); setPartial(!!e.partial); } else onClose();
    } catch { setErr("Não foi possível salvar. Seus dados continuam aqui; tente novamente."); }
    finally { pending.current = false; setBusy(false); }
  };

  const panel = (
    <Drawer onClose={close} fechavel={!busy} label="compromisso" largura={400}
      painelStyle={{ position: "fixed", right: 26, top: 90, bottom: 26, height: "auto", maxWidth: "calc(100% - 28px)", overflow: "hidden" }}>
      <div className="agenda-editor-head">
        <div><span>{b ? "Editar compromisso" : "Agenda do time"}</span><h2>{b ? "Editar item da agenda" : "Novo compromisso"}</h2></div>
        <button onClick={close} disabled={busy} aria-label="Fechar">✕</button>
      </div>
      <fieldset className="agenda-editor" disabled={busy || partial}>

        <Segmented value={kind} onChange={setKind} options={[{ value: "event", label: "Compromisso" }, { value: "block", label: "Bloqueio" }]} />

        <div>
          <label htmlFor="agenda-title" className="kicker" style={label}>{kind === "event" ? "Título" : "Motivo (opcional)"}</label>
          <input id="agenda-title" autoFocus value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder={kind === "event" ? "reunião com fornecedor, dentista…" : "almoço, folga, compromisso externo…"}
            style={{ ...field, width: "100%" }} />
        </div>

        {/* Pessoas: chips com a cor de cada um (a agenda de todas as
            selecionadas fica ocupada). Era um campo que abria lista com
            checkbox: dois cliques e nenhuma cor pra confirmar quem entrou. */}
        <div>
          <span className="kicker" style={label}>Pessoas</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {people.map((p) => {
              const on = sel.includes(p.id);
              return (
                <button key={p.id} aria-pressed={on} onClick={() => toggleSel(p.id)}
                  style={{ height: 30, padding: "0 11px 0 8px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                    display: "inline-flex", alignItems: "center", gap: 6,
                    background: on ? "color-mix(in srgb, " + userColor(p.id) + " 16%, var(--bg-1))" : "var(--bg-1)",
                    color: on ? "var(--fg-1)" : "var(--fg-3)",
                    border: "1px solid " + (on ? userColor(p.id) : "var(--line-2)") }}>
                  <span style={{ width: 8, height: 11, borderRadius: 2, background: userColor(p.id), opacity: on ? 1 : 0.45 }} />
                  {p.name || p.id}
                </button>
              );
            })}
            {/* Quem já está no item mas não tem papel de agenda hoje (mudou de
                função, saiu do time): continua clicável pra poder sair. */}
            {sel.filter((id) => !people.some((p) => p.id === id)).map((id) => (
              <button key={id} onClick={() => toggleSel(id)} title="não está mais na lista de agenda deste produto"
                style={{ height: 30, padding: "0 11px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                  background: "var(--bg-2)", color: "var(--fg-2)", border: "1px dashed var(--line-2)" }}>
                {displayName(id)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="agenda-date" className="kicker" style={label}>Data</label>
          <input id="agenda-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...field, width: "100%" }} />
        </div>

        {/* Dia inteiro: bloqueia/ocupa o dia todo — esconde início/duração. */}
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: "var(--fg-2)" }}>
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} style={{ accentColor: "var(--accent)", width: 15, height: 15, cursor: "pointer" }} />
          Dia inteiro
          <span className="mono dim" style={{ fontSize: 10.5 }}>ocupa a grade toda: nenhuma call cai nesse dia</span>
        </label>
        {!allDay && (<>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label htmlFor="agenda-hour" className="kicker" style={label}>Começa às</label>
            <select id="agenda-hour" value={from} onChange={(e) => setFrom(Number(e.target.value))} style={{ ...field, width: "100%" }}>
              {quarterHours(7, 20.75).map((h) => <option key={h} value={h}>{fmtH(h)}</option>)}
            </select>
          </div>
          {/* Duração: três chips resolvem quase tudo (a escada de doze opções
              continua atrás do "outra"). A escada em si não muda. */}
          <div>
            <span className="kicker" style={label}>Duração</span>
            <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
              {[30, 60, 120].map((m) => (
                <button key={m} onClick={() => { setDur(m); setDurOpen(false); }}
                  style={{ height: 34, padding: "0 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                    background: dur === m ? "var(--accent-soft)" : "var(--bg-1)", color: dur === m ? "var(--accent)" : "var(--fg-2)",
                    border: "1px solid " + (dur === m ? "var(--accent-line)" : "var(--line-2)") }}>
                  {durLabel(m)}
                </button>
              ))}
              {(durOpen || ![30, 60, 120].includes(dur)) ? (
                <select value={dur} autoFocus={durOpen} onChange={(e) => setDur(Number(e.target.value))} style={{ ...field, flex: 1, minWidth: 96 }}>
                  {DUR_OPTIONS.filter((m) => from + m / 60 <= 24).map((m) => <option key={m} value={m}>{durLabel(m)}</option>)}
                  {!DUR_OPTIONS.includes(dur) && <option value={dur}>{durLabel(dur)}</option>}
                </select>
              ) : (
                <button onClick={() => setDurOpen(true)} className="mono" style={{ height: 34, padding: "0 10px", fontSize: 11.5, color: "var(--fg-3)", cursor: "pointer" }}>outra ▾</button>
              )}
            </div>
          </div>
        </div>
        <div className="mono dim" style={{ fontSize: 11, marginTop: -6 }}>termina às {fmtH(to)}</div>
        </>)}

        <div className="agenda-recurrence">
          <span className="kicker" style={label}>Repete</span>
          {/* Segmented no lugar do select: as quatro opções cabem à vista.
              "Todos os dias" saiu da lista porque é "dias escolhidos" com os
              sete marcados, e cada dia continua virando um registro weekly. */}
          <Segmented value={recur} onChange={setRecur} options={[
            { value: "once", label: "Não repete" },
            { value: "weekly", label: "Toda semana" },
            { value: "weekdays", label: "Seg a sex" },
            { value: "custom", label: "Dias escolhidos" },
          ]} />
          <div className="mono dim" style={{ fontSize: 10.5, marginTop: 6 }}>
            {recur === "once" ? `só ${date ? date.slice(8, 10) + "/" + date.slice(5, 7) : "essa data"}`
              : recur === "weekly" ? `toda ${weekdayLabel}`
              : recur === "weekdays" ? "segunda a sexta, toda semana"
              : "marque os dias, cada um vira um item semanal"}
          </div>
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

        {conflitos.length > 0 && (
          <div style={{ padding: "9px 11px", borderRadius: "var(--r-2)", background: "var(--neg-soft)", border: "1px solid color-mix(in srgb, var(--neg) 30%, transparent)", color: "var(--neg)", fontSize: 12.5, lineHeight: 1.5 }}>
            {conflitos.map(({ u, hit }) => (
              <div key={u}><strong>{displayName(u)}</strong>{` já tem ${hit} nesse ${allDay ? "dia" : "horário"}`}</div>
            ))}
            <div style={{ fontSize: 11.5, opacity: 0.85, marginTop: 2 }}>
              remarque uma das duas ou tire {conflitos.length === 1 ? "essa pessoa" : "essas pessoas"} deste compromisso
            </div>
          </div>
        )}
      </fieldset>
        {err && <div role="alert" className="agenda-editor-error" style={{ padding: "8px 10px", borderRadius: "var(--r-2)", background: "var(--warn-soft)", color: "var(--warn)", fontSize: 12.5 }}>{err}</div>}

        <div className="agenda-editor-footer">
          {b && (
            <button disabled={busy || partial} onClick={remove}
              style={{ height: 36, padding: "0 14px", borderRadius: 999, border: "1px solid color-mix(in srgb, var(--neg) 40%, transparent)", background: "var(--neg-soft)", color: "var(--neg)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              Excluir
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button disabled={busy} onClick={close} style={{ height: 36, padding: "0 14px", borderRadius: 999, border: "1px solid var(--line-1)", background: "var(--bg-1)", color: "var(--fg-2)", fontSize: 13, cursor: "pointer" }}>Cancelar</button>
          <PrimaryButton disabled={busy || partial} onClick={submit}>{busy ? "Salvando…" : b ? "Salvar" : "Criar"}</PrimaryButton>
        </div>
    </Drawer>
  );
  return typeof document !== "undefined" && document.body?.nodeType === 1 ? createPortal(panel, document.body) : panel;
}
