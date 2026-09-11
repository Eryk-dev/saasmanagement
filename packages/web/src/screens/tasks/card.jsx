import React from "react";
import { Avatar } from "../../atoms.jsx";
import { userColor } from "../../lib/users.js";
import { assetUrl } from "../../lib/api.js";
import { assigneesOf, dueState, priTone, priSoft } from "../../lib/tasks.js";
import { Icon } from "./icons.jsx";
import { useLongPress } from "./dnd.js";

const { memo, useState, useRef, useEffect, useLayoutEffect } = React;

// Círculo de concluir (22px, área de toque 44px). Animação ao marcar.
export function CompleteCircle({ done, onToggle, size = 22, title }) {
  const [pop, setPop] = useState(false);
  return (
    <button type="button" aria-label={title || (done ? "Reabrir" : "Marcar como concluída")} title={title || (done ? "Reabrir" : "Marcar como concluída")}
      onClick={(e) => { e.stopPropagation(); setPop(true); setTimeout(() => setPop(false), 260); onToggle(!done); }}
      onPointerDown={(e) => e.stopPropagation()}
      style={{ width: size + 12, height: size + 12, margin: -6, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: "transparent" }}>
      <span className={pop ? "tk-pop" : ""} style={{
        width: size, height: size, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center",
        border: `1.5px solid ${done ? "var(--pos)" : "var(--line-strong)"}`, background: done ? "var(--pos)" : "transparent", color: done ? "#fff" : "var(--fg-4)",
        transition: "background .15s, border-color .15s",
      }}>
        <Icon name="check" size={size * 0.6} style={{ opacity: done ? 1 : 0.55 }} />
      </span>
    </button>
  );
}

export function PriorityChip({ p, small }) {
  if (!p) return null;
  return <span className="chip" style={{ background: priSoft(p), color: priTone(p), minHeight: small ? 18 : 20, fontSize: small ? 10.5 : 11 }}>{p}</span>;
}
export function LabelChip({ label, color, small, onRemove }) {
  const bg = color ? `color-mix(in srgb, ${color} 16%, var(--bg-1))` : "var(--bg-2)";
  return (
    <span className="chip" style={{ background: bg, color: "var(--fg-1)", minHeight: small ? 18 : 20, fontSize: small ? 10.5 : 11, maxWidth: 140 }}>
      {color && <span style={{ width: 6, height: 6, borderRadius: 999, background: color, flexShrink: 0 }} />}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      {onRemove && <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(); }} aria-label={`Tirar ${label}`} style={{ marginLeft: 2, color: "var(--fg-4)", fontSize: 11, lineHeight: 1 }}>✕</button>}
    </span>
  );
}
export function DueChip({ due, completed, small }) {
  const s = dueState(due, { completed });
  if (!s) return null;
  return (
    <span className="tnum" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: small ? 11 : 11.5, fontWeight: s.overdue || s.today ? 600 : 500, color: s.tone }}>
      <Icon name="calendar" size={12} />{s.label}
    </span>
  );
}
export function AvatarStack({ ids, usersById, size = 22, max = 3 }) {
  const list = (ids || []).map((id) => usersById.get(id) || { id, name: id });
  if (!list.length) return null;
  const shown = list.slice(0, max);
  return (
    <span style={{ display: "inline-flex", alignItems: "center" }} title={list.map((u) => u.name).join(", ")}>
      {shown.map((u, i) => (
        <span key={u.id} style={{ marginLeft: i ? -6 : 0, display: "inline-flex", borderRadius: 999, boxShadow: `0 0 0 2px ${userColor(u.id) || "var(--line-2)"}`, background: "var(--bg-1)" }}>
          <Avatar id={u.id} name={u.name} size={size} />
        </span>
      ))}
      {list.length > max && <span className="mono dim" style={{ fontSize: 11, marginLeft: 4 }}>+{list.length - max}</span>}
    </span>
  );
}

// Título editável no lugar (lápis do hover / "Renomear" do menu).
function InlineTitle({ value, onSave, onCancel }) {
  const ref = useRef(null);
  const done = useRef(false);
  const fit = (el) => { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; };
  useLayoutEffect(() => { const el = ref.current; if (!el) return; fit(el); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, []);
  const finish = (fn) => { if (done.current) return; done.current = true; fn(); };
  return (
    <textarea ref={ref} defaultValue={value} rows={1} className="inp"
      onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); finish(() => onSave(e.target.value)); }
        if (e.key === "Escape") { e.preventDefault(); finish(onCancel); }
      }}
      onInput={(e) => fit(e.target)} onBlur={(e) => finish(() => onSave(e.target.value))}
      style={{ width: "100%", height: "auto", padding: "4px 6px", fontSize: 13.5, fontWeight: 600, lineHeight: 1.35, resize: "none", fontFamily: "inherit", boxSizing: "border-box" }} />
  );
}

// Card do quadro. React.memo: só re-renderiza quando a própria tarefa (ou o
// estado de foco/seleção dela) muda. `actions` é um objeto estável da tela.
export const TaskCard = memo(function TaskCard({ t, colKey, usersById, labelColors, done, focused, selected, renaming, blocked, subDone, subTotal, fields, compact, dragProps, actions }) {
  const cover = fields.cover && !compact ? (t.cover || t.photo || (t.attachments || []).find((a) => /^image\//.test(a.mime || ""))?.url || "") : "";
  const labels = fields.labels ? (t.labels || []) : [];
  const comments = (t.comments || []).length;
  const attachments = (t.attachments || []).length;
  const likes = (t.likes || []).length;
  const hasMeta = (fields.subtasks && subTotal > 0) || (fields.comments && comments > 0) || (fields.attachments && attachments > 0) || likes > 0 || blocked;
  const long = useLongPress((pt) => actions.menu(t.id, { x: pt.x, y: pt.y }));
  const dp = dragProps ? dragProps(t, colKey) : {};
  return (
    <div data-task={t.id} role="button" tabIndex={0} aria-label={t.title || "tarefa sem título"}
      className={"tk-card" + (focused ? " is-focused" : "") + (selected ? " is-selected" : "")}
      {...dp} {...long}
      onClick={(e) => actions.click(t.id, e)}
      onDoubleClick={(e) => { e.preventDefault(); actions.rename(t.id); }}
      onContextMenu={(e) => { e.preventDefault(); actions.menu(t.id, { x: e.clientX, y: e.clientY }); }}
      onKeyDown={(e) => { if (e.key === "Enter" && !renaming) { e.preventDefault(); actions.open(t.id); } }}
      onFocus={() => actions.focus(t.id)}
      style={{
        background: "var(--bg-1)", border: "1px solid var(--line-1)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-card)",
        padding: compact ? "8px 10px" : "10px 12px", cursor: "grab", outline: "none", opacity: done && !renaming ? 0.78 : 1,
      }}>
      {cover && <img src={assetUrl(cover)} alt="" draggable={false} style={{ width: "100%", maxHeight: 120, objectFit: "cover", borderRadius: "var(--r-2)", border: "1px solid var(--line-1)", marginBottom: 8, display: "block" }} />}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <span style={{ paddingTop: 1 }}><CompleteCircle done={done} size={compact ? 18 : 20} onToggle={(v) => actions.complete(t.id, v)} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {renaming
            ? <InlineTitle value={t.title} onSave={(v) => actions.renameSave(t.id, v)} onCancel={() => actions.renameSave(t.id, null)} />
            : <div style={{ fontSize: compact ? 13 : 13.5, fontWeight: 600, lineHeight: 1.35, color: done ? "var(--fg-3)" : "var(--fg-1)", wordBreak: "break-word" }}>{t.title || <span className="dim">(sem título)</span>}</div>}
        </div>
        {!renaming && (
          <span className="tk-hover" style={{ display: "inline-flex", gap: 2, marginTop: -3, marginRight: -6, flexShrink: 0 }}>
            <button type="button" title="Renomear" aria-label="Renomear" onClick={(e) => { e.stopPropagation(); actions.rename(t.id); }} onPointerDown={(e) => e.stopPropagation()} style={{ width: 24, height: 24, borderRadius: 6, color: "var(--fg-4)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon name="pencil" size={13} /></button>
            <button type="button" title="Mais ações" aria-label="Mais ações" onClick={(e) => { e.stopPropagation(); actions.menu(t.id, e.currentTarget.getBoundingClientRect()); }} onPointerDown={(e) => e.stopPropagation()} style={{ width: 24, height: 24, borderRadius: 6, color: "var(--fg-4)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon name="more" size={14} /></button>
          </span>
        )}
      </div>
      {(labels.length > 0 || (fields.priority && t.priority) || (fields.due && t.dueDate)) && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 8, paddingLeft: compact ? 26 : 28 }}>
          {fields.priority && <PriorityChip p={t.priority} small={compact} />}
          {labels.slice(0, 3).map((l) => <LabelChip key={l} label={l} color={labelColors.get(l) || ""} small={compact} />)}
          {labels.length > 3 && <span className="mono dim" style={{ fontSize: 11 }}>+{labels.length - 3}</span>}
          {fields.due && <DueChip due={t.dueDate} completed={done} small={compact} />}
        </div>
      )}
      {(hasMeta || (fields.assignee && assigneesOf(t).length > 0)) && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, paddingLeft: compact ? 26 : 28, minHeight: 20 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10, color: "var(--fg-4)", fontSize: 11.5, flex: 1, minWidth: 0 }}>
            {blocked && <span title="Bloqueada por outra tarefa" style={{ color: "var(--neg)", display: "inline-flex" }}><Icon name="blocked" size={13} /></span>}
            {fields.subtasks && subTotal > 0 && <span className="tnum" title="Subtarefas" style={{ display: "inline-flex", alignItems: "center", gap: 3, color: subDone === subTotal ? "var(--pos)" : "var(--fg-4)" }}><Icon name="subtask" size={13} />{subDone}/{subTotal}</span>}
            {fields.comments && comments > 0 && <span className="tnum" title="Comentários" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Icon name="comment" size={13} />{comments}</span>}
            {fields.attachments && attachments > 0 && <span className="tnum" title="Anexos" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Icon name="paperclip" size={13} />{attachments}</span>}
            {likes > 0 && <span className="tnum" title="Curtidas" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Icon name="thumb" size={13} />{likes}</span>}
          </span>
          {fields.assignee && <AvatarStack ids={assigneesOf(t)} usersById={usersById} size={compact ? 18 : 22} />}
        </div>
      )}
    </div>
  );
});

// Composer inline: Enter salva e abre outro; Shift+Enter quebra linha; Esc
// cancela; sair com texto salva.
export function NewTaskCard({ onSave, onCancel, placeholder = "Nome da tarefa" }) {
  const ref = useRef(null);
  // `busy` em ref, NÃO em disabled: desabilitar o campo tira o foco, o blur
  // dispara com o campo já limpo e o composer fechava depois da 1ª tarefa.
  const busy = useRef(false);
  const closing = useRef(false);
  useEffect(() => { ref.current?.focus(); }, []);
  const fit = (el) => { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; };
  const submit = async (again) => {
    if (busy.current) return;
    const el = ref.current; const v = (el?.value || "").trim();
    if (!v) { if (!again) onCancel(); return; }
    busy.current = true;
    if (el) { el.value = ""; fit(el); }
    const ok = await onSave(v);
    busy.current = false;
    if (!ok && el) { el.value = v; fit(el); }
    if (ok && !again) onCancel();
    else if (el && again) el.focus();
  };
  return (
    <div data-composer="1" style={{ background: "var(--bg-1)", border: "1px solid var(--accent-line)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-2)", padding: "8px 10px" }}>
      <textarea ref={ref} rows={1} placeholder={placeholder}
        onInput={(e) => fit(e.target)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(true); }
          if (e.key === "Escape") { e.preventDefault(); closing.current = true; onCancel(); }
        }}
        onBlur={() => { if (!closing.current && !busy.current) submit(false); }}
        style={{ width: "100%", border: "none", outline: "none", background: "transparent", resize: "none", fontSize: 13.5, fontWeight: 600, lineHeight: 1.35, fontFamily: "inherit", color: "var(--fg-1)", padding: 0, boxSizing: "border-box" }} />
      <div className="dim" style={{ fontSize: 10.5, marginTop: 4 }}>Enter salva · Esc cancela</div>
    </div>
  );
}
