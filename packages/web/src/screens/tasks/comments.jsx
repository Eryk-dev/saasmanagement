import React from "react";
import { Avatar, SecondaryButton } from "../../atoms.jsx";
import { api } from "../../lib/api.js";
import { displayName } from "../../lib/users.js";
import { Popover } from "../../components/popover.jsx";
import { assigneesOf, fmtDue } from "../../lib/tasks.js";
import { Icon } from "./icons.jsx";

const { useState, useEffect, useRef, useMemo } = React;

export function when(iso) {
  if (!iso) return "";
  const d = new Date(iso); if (!Number.isFinite(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "agora";
  if (diff < 3_600_000) return `há ${Math.round(diff / 60_000)} min`;
  const hhmm = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const today = new Date(); const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return `hoje ${hhmm}`;
  if (d.toDateString() === y.toDateString()) return `ontem ${hhmm}`;
  return `${d.toLocaleDateString("pt-BR", { day: "numeric", month: "short" }).replace(".", "")} ${hhmm}`;
}

// @menção em destaque no texto do comentário (ids/nomes conhecidos).
function RichText({ text, users }) {
  const parts = useMemo(() => {
    const names = users.flatMap((u) => [u.name, u.id]).filter(Boolean).sort((a, b) => b.length - a.length);
    if (!names.length) return [{ t: text }];
    const re = new RegExp(`@(${names.map((n) => n.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")).join("|")})`, "gi");
    const out = []; let last = 0;
    for (const m of String(text || "").matchAll(re)) {
      if (m.index > last) out.push({ t: text.slice(last, m.index) });
      out.push({ t: m[0], m: true }); last = m.index + m[0].length;
    }
    if (last < String(text || "").length) out.push({ t: text.slice(last) });
    return out;
  }, [text, users]);
  return <>{parts.map((p, i) => (p.m ? <span key={i} style={{ color: "var(--accent)", fontWeight: 600 }}>{p.t}</span> : <span key={i}>{p.t}</span>))}</>;
}

// Composer: autosize, @ abre a lista de pessoas, ⌘/Ctrl+Enter envia, rascunho
// por tarefa sobrevive a fechar o painel (Map de módulo).
const drafts = new Map();
export function Composer({ task, users, me, onSent, autoFocus }) {
  const ref = useRef(null);
  const [text, setText] = useState(() => drafts.get(task.id) || "");
  const [busy, setBusy] = useState(false);
  const [mention, setMention] = useState(null); // { q, start }
  const [active, setActive] = useState(0);
  useEffect(() => { setText(drafts.get(task.id) || ""); }, [task.id]);
  useEffect(() => { drafts.set(task.id, text); }, [task.id, text]);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  const fit = (el) => { if (!el) return; el.style.height = "auto"; el.style.height = Math.min(220, el.scrollHeight) + "px"; };
  useEffect(() => { fit(ref.current); }, [text]);

  const candidates = useMemo(() => {
    if (!mention) return [];
    const k = mention.q.toLowerCase();
    return users.filter((u) => !k || u.name.toLowerCase().includes(k) || u.id.toLowerCase().includes(k)).slice(0, 8);
  }, [mention, users]);
  const mentioned = useMemo(() => users.filter((u) => new RegExp(`@(${[u.name, u.id].map((n) => n.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")).join("|")})(?![\\p{L}\\p{N}])`, "iu").test(text)).map((u) => u.id), [text, users]);
  const notified = useMemo(() => new Set([...(task.followers || []), ...assigneesOf(task), ...mentioned].filter((u) => u && u !== me)), [task, mentioned, me]);

  const detect = (el) => {
    const upto = el.value.slice(0, el.selectionStart);
    const m = /(^|\s)@([^\s@]*)$/.exec(upto);
    if (m) setMention({ q: m[2], start: upto.length - m[2].length - 1 }); else setMention(null);
  };
  const insert = (u) => {
    const el = ref.current; if (!el || !mention) return;
    const before = text.slice(0, mention.start);
    const after = text.slice(el.selectionStart);
    const next = `${before}@${u.name} ${after}`;
    setText(next); setMention(null);
    requestAnimationFrame(() => { el.focus(); const pos = before.length + u.name.length + 2; el.setSelectionRange(pos, pos); });
  };
  const send = async () => {
    const body = text.trim(); if (!body || busy) return;
    setBusy(true);
    try {
      const r = await api.taskComment(task.id, body);
      setText(""); drafts.delete(task.id);
      onSent(r.task);
    } catch (err) { window.toast && window.toast(`O comentário não foi enviado · ${err.message || "tente de novo"}`, "neg"); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <Avatar id={me} name={displayName(me)} size={26} />
        <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
          <textarea ref={ref} value={text} rows={1} placeholder="Escreva um comentário… @ menciona alguém" disabled={busy}
            onChange={(e) => { setText(e.target.value); detect(e.target); setActive(0); }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (mention && candidates.length) {
                if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % candidates.length); return; }
                if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + candidates.length) % candidates.length); return; }
                if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insert(candidates[active]); return; }
                if (e.key === "Escape") { e.preventDefault(); setMention(null); return; }
              }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
            }}
            onClick={(e) => detect(e.target)}
            className="inp" style={{ width: "100%", height: "auto", minHeight: 38, padding: "8px 10px", fontSize: 13, lineHeight: 1.45, resize: "none", fontFamily: "inherit", boxSizing: "border-box" }} />
          {mention && candidates.length > 0 && (
            <Popover anchor={ref} onClose={() => setMention(null)} width={260}>
              {candidates.map((u, i) => (
                <button key={u.id} type="button" onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); insert(u); }}
                  className={"tk-menu-item" + (active === i ? " is-active" : "")} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 8px", borderRadius: 6, textAlign: "left", fontSize: 13 }}>
                  <Avatar id={u.id} name={u.name} size={20} /><span>{u.name}</span>
                </button>
              ))}
            </Popover>
          )}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 34 }}>
        <span className="dim" style={{ fontSize: 11, flex: 1 }}>{notified.size ? `${notified.size} ${notified.size === 1 ? "pessoa será notificada" : "pessoas serão notificadas"}` : "ninguém será notificado"} · ⌘Enter envia</span>
        <SecondaryButton size="sm" onClick={send} disabled={!text.trim() || busy}>{busy ? "Enviando…" : "Comentar"}</SecondaryButton>
      </div>
    </div>
  );
}

export function CommentsList({ task, users, usersById, me, onTaskChange }) {
  const [editing, setEditing] = useState(null); // comment id
  const comments = task.comments || [];
  const nameOf = (id) => usersById.get(id)?.name || (id === "api" ? "API" : displayName(id) || id);
  const act = async (fn, failMsg) => { try { const r = await fn(); if (r?.task) onTaskChange(r.task); else if (r?.likes && r.task) onTaskChange(r.task); } catch (err) { window.toast && window.toast(`${failMsg} · ${err.message || "tente de novo"}`, "neg"); } };
  if (!comments.length) return <div className="mono dim" style={{ fontSize: 12, padding: "6px 0 10px" }}>sem comentários ainda</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {comments.map((c) => {
        const mine = c.author === me;
        const liked = (c.likes || []).includes(me);
        return (
          <div key={c.id} className="tk-row" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <Avatar id={c.author} name={nameOf(c.author)} size={26} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{nameOf(c.author)}</span>
                <span className="mono dim" style={{ fontSize: 10.5 }}>{when(c.at)}{c.editedAt ? " · editado" : ""}</span>
                <span className="tk-hover" style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
                  {mine && <button type="button" onClick={() => setEditing(c.id)} style={{ fontSize: 11, color: "var(--fg-4)" }}>Editar</button>}
                  {mine && <button type="button" onClick={() => { if (window.confirm("Excluir este comentário?")) act(() => api.taskCommentDelete(task.id, c.id), "Não deu pra excluir"); }} style={{ fontSize: 11, color: "var(--neg)" }}>Excluir</button>}
                </span>
              </div>
              {editing === c.id ? (
                <EditBox initial={c.text} onCancel={() => setEditing(null)} onSave={(v) => { setEditing(null); if (v.trim() && v !== c.text) act(() => api.taskCommentEdit(task.id, c.id, v.trim()), "Não deu pra editar"); }} />
              ) : (
                <div style={{ fontSize: 13, color: "var(--fg-2)", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.45 }}><RichText text={c.text} users={users} /></div>
              )}
              <button type="button" onClick={() => act(() => api.taskCommentLike(task.id, c.id), "Não deu pra curtir")} title={liked ? "Descurtir" : "Curtir"}
                style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 4, fontSize: 11.5, color: liked ? "var(--accent)" : "var(--fg-4)", fontWeight: liked ? 600 : 500 }}>
                <Icon name="thumb" size={13} />{(c.likes || []).length || ""}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
function EditBox({ initial, onSave, onCancel }) {
  const ref = useRef(null);
  useEffect(() => { const el = ref.current; if (el) { el.focus(); el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } }, []);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
      <textarea ref={ref} defaultValue={initial} className="inp" rows={2} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") onCancel(); if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSave(e.target.value); }}
        onInput={(e) => { e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
        style={{ width: "100%", height: "auto", padding: "6px 8px", fontSize: 13, resize: "none", fontFamily: "inherit", boxSizing: "border-box" }} />
      <div style={{ display: "flex", gap: 6 }}>
        <SecondaryButton size="sm" onClick={() => onSave(ref.current?.value || "")}>Salvar</SecondaryButton>
        <button type="button" onClick={onCancel} style={{ fontSize: 12, color: "var(--fg-3)" }}>Cancelar</button>
      </div>
    </div>
  );
}

// Frases da atividade (eventos do servidor + comentários) em pt-BR.
function sentence(ev, { usersById, columns }) {
  const name = (id) => usersById.get(id)?.name || (id === "api" ? "API" : displayName(id) || id);
  const col = (k) => columns.find((c) => c.key === k)?.name || k || "coluna";
  const d = ev.data || {};
  switch (ev.type) {
    case "created": return "criou esta tarefa";
    case "assigned": return `atribuiu a ${d.users?.map(name).join(", ")}`;
    case "unassigned": return `tirou ${d.users?.map(name).join(", ")}`;
    case "due_changed": return d.to ? `definiu o prazo para ${fmtDue(d.to)}` : "tirou o prazo";
    case "priority_changed": return d.to ? `mudou a prioridade para ${d.to}` : "tirou a prioridade";
    case "moved": return `moveu para ${col(d.to)}`;
    case "completed": return "marcou como concluída";
    case "reopened": return "reabriu";
    case "updated": return `editou ${(d.fields || []).map((f) => ({ title: "o título", description: "a descrição", labels: "as labels", recurrence: "a repetição", cover: "a capa", startDate: "a data de início", parentId: "a tarefa-mãe", saas: "o produto" })[f] || f).join(", ")}`;
    case "comment_edited": return "editou um comentário";
    case "comment_deleted": return "apagou um comentário";
    case "attachment_added": return `anexou ${d.name || "um arquivo"}`;
    case "attachment_removed": return `removeu o anexo ${d.name || ""}`;
    case "blocked_by_added": return "marcou uma tarefa como bloqueadora";
    case "blocked_by_removed": return "tirou um bloqueio";
    case "follower_added": return `${name(d.user)} passou a seguir`;
    case "follower_removed": return `${name(d.user)} deixou de seguir`;
    case "liked": return "curtiu";
    case "comment_liked": return "curtiu um comentário";
    case "subtask_added": return `adicionou a subtarefa "${d.title || ""}"`;
    case "subtask_removed": return `removeu a subtarefa "${d.title || ""}"`;
    case "converted": return d.to === "subtask" ? "converteu em subtarefa" : "converteu em tarefa do quadro";
    case "duplicated": return "duplicou esta tarefa";
    case "followup_created": return `criou a tarefa de acompanhamento "${d.title || ""}"`;
    case "unblocked": return `"${d.blockerTitle || "bloqueadora"}" foi concluída: desbloqueada`;
    case "recurrence_created": return "gerou a próxima ocorrência";
    case "bulk": return "editou em massa";
    default: return ev.type;
  }
}
export function ActivityTab({ taskId, usersById, users, columns, version }) {
  const [items, setItems] = useState(null);
  useEffect(() => {
    let alive = true;
    // o evento "comment" é o próprio comentário (que já entra na lista): some.
    api.taskActivity(taskId).then((list) => { if (alive) setItems((list || []).filter((ev) => !(ev.kind === "event" && ev.type === "comment"))); }).catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [taskId, version]);
  if (!items) return <div className="mono dim" style={{ fontSize: 12 }}>carregando…</div>;
  if (!items.length) return <div className="mono dim" style={{ fontSize: 12 }}>sem atividade registrada</div>;
  const nameOf = (id) => usersById.get(id)?.name || (id === "api" ? "API" : displayName(id) || id);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((ev) => ev.kind === "comment" ? (
        <div key={ev.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <Avatar id={ev.author} name={nameOf(ev.author)} size={22} />
          <div style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>
            <span style={{ fontWeight: 600 }}>{nameOf(ev.author)}</span> <span className="dim">comentou</span> <span className="mono dim" style={{ fontSize: 10.5 }}>{when(ev.at)}</span>
            <div style={{ color: "var(--fg-2)", whiteSpace: "pre-wrap", marginTop: 2 }}><RichText text={ev.text} users={users} /></div>
          </div>
        </div>
      ) : (
        <div key={ev.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5 }}>
          <Avatar id={ev.by} name={nameOf(ev.by)} size={22} />
          <span style={{ flex: 1, minWidth: 0, color: "var(--fg-2)" }}><span style={{ fontWeight: 600, color: "var(--fg-1)" }}>{nameOf(ev.by)}</span> {sentence(ev, { usersById, columns })}</span>
          <span className="mono dim" style={{ fontSize: 10.5, flexShrink: 0 }}>{when(ev.at)}</span>
        </div>
      ))}
    </div>
  );
}
