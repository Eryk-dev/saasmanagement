import React from "react";
import { Avatar, SecondaryButton, useEsc } from "../../atoms.jsx";
import { api, assetUrl } from "../../lib/api.js";
import { displayName } from "../../lib/users.js";
import { Menu } from "../../components/menu.jsx";
import { UserPicker, UserAvatarRing } from "../../components/user-picker.jsx";
import { DateQuick } from "../../components/date-quick.jsx";
import { Popover } from "../../components/popover.jsx";
import { assigneesOf, PRIORITIES, priTone, priSoft, fmtDue, dueState, byOrder } from "../../lib/tasks.js";
import { Icon } from "./icons.jsx";
import { CompleteCircle, LabelChip } from "./card.jsx";
import { Composer, CommentsList, ActivityTab, when } from "./comments.jsx";
import { taskMenuItems } from "./context-menu.jsx";
import { RecurrencePicker, LabelColorPopover } from "./pickers.jsx";

const { useState, useEffect, useRef, useCallback, useMemo } = React;

// Campo que salva sozinho: no blur/Enter (título) ou com atraso (descrição).
// Rascunho local manda enquanto está sujo; a resposta do servidor só entra
// quando não há edição pendente. Fechar o painel com rascunho sujo grava.
function useAutosave(serverValue, save, { delay = 0 } = {}) {
  const [draft, setDraft] = useState(serverValue ?? "");
  const dirty = useRef(false);
  const draftRef = useRef(draft); draftRef.current = draft;
  const saveRef = useRef(save); saveRef.current = save;
  const timer = useRef(0);
  const [status, setStatus] = useState("");
  useEffect(() => { if (!dirty.current) setDraft(serverValue ?? ""); }, [serverValue]);
  const commit = useCallback(async () => {
    clearTimeout(timer.current);
    if (!dirty.current) return true;
    const v = draftRef.current;
    dirty.current = false;
    setStatus("saving");
    const ok = await saveRef.current(v);
    setStatus(ok ? "saved" : "error");
    if (ok) setTimeout(() => setStatus((s) => (s === "saved" ? "" : s)), 1500);
    else dirty.current = true;
    return ok;
  }, []);
  const onChange = (v) => { setDraft(v); dirty.current = true; if (delay) { clearTimeout(timer.current); timer.current = setTimeout(commit, delay); } };
  useEffect(() => () => { clearTimeout(timer.current); if (dirty.current) saveRef.current(draftRef.current); }, []);
  return { draft, onChange, commit, status, retry: commit };
}
function SaveStatus({ status, onRetry }) {
  if (!status) return null;
  if (status === "error") return <button type="button" onClick={onRetry} style={{ fontSize: 11, color: "var(--neg)", fontWeight: 600 }}>não salvou · tentar de novo</button>;
  return <span className="mono dim" style={{ fontSize: 11 }}>{status === "saving" ? "Salvando…" : "Salvo"}</span>;
}
const fit = (el, max = 400) => { if (!el) return; el.style.height = "auto"; el.style.height = Math.min(max, el.scrollHeight) + "px"; };

function TitleField({ task, save }) {
  const a = useAutosave(task.title, save);
  const ref = useRef(null);
  useEffect(() => { fit(ref.current, 200); }, [a.draft]);
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
      <textarea ref={ref} value={a.draft} rows={1} placeholder="Nome da tarefa" className="tk-panel-field"
        onChange={(e) => a.onChange(e.target.value)} onBlur={a.commit}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.target.blur(); } }}
        style={{ flex: 1, minWidth: 0, fontSize: 18, fontWeight: 700, lineHeight: 1.3, letterSpacing: "-0.01em", border: "1px solid transparent", borderRadius: "var(--r-2)", padding: "4px 6px", margin: "-4px -6px", background: "transparent", resize: "none", fontFamily: "inherit", color: "var(--fg-1)", outline: "none" }} />
      <SaveStatus status={a.status} onRetry={a.retry} />
    </div>
  );
}
function DescriptionField({ task, save }) {
  const a = useAutosave(task.description, save, { delay: 800 });
  const ref = useRef(null);
  useEffect(() => { fit(ref.current, 600); }, [a.draft]);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span className="kicker">Descrição</span>
        <span style={{ marginLeft: "auto" }}><SaveStatus status={a.status} onRetry={a.retry} /></span>
      </div>
      <textarea ref={ref} value={a.draft} rows={2} placeholder="Adicione detalhes, contexto, links…" className="tk-panel-field"
        onChange={(e) => a.onChange(e.target.value)} onBlur={a.commit} onKeyDown={(e) => e.stopPropagation()}
        style={{ width: "100%", boxSizing: "border-box", fontSize: 13, lineHeight: 1.5, border: "1px solid transparent", borderRadius: "var(--r-2)", padding: "6px 8px", margin: "0 -8px", background: "var(--bg-inset)", resize: "none", fontFamily: "inherit", color: "var(--fg-1)", outline: "none", minHeight: 64 }} />
    </div>
  );
}

// Labels: chips com ✕ + campo que sugere as labels do quadro; Enter/vírgula adiciona.
function LabelsField({ value, options, colors, onChange, onColor }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [colorFor, setColorFor] = useState(null); // { label, anchor }
  const ref = useRef(null);
  const list = (value || []);
  const sugg = options.filter((o) => !list.includes(o) && (!q || o.toLowerCase().includes(q.toLowerCase()))).slice(0, 8);
  const add = (name) => { const n = String(name || "").trim().replace(/,+$/, ""); if (!n || list.includes(n)) { setQ(""); return; } onChange([...list, n]); setQ(""); };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", minHeight: 28 }}>
      {list.map((l) => (
        <span key={l} role="button" tabIndex={0} title="Clique pra escolher a cor (vale pro quadro todo)" style={{ display: "inline-flex", cursor: "pointer", borderRadius: "var(--r-1)" }}
          onClick={(e) => setColorFor({ label: l, anchor: e.currentTarget.getBoundingClientRect() })}
          onKeyDown={(e) => { if (e.key === "Enter") setColorFor({ label: l, anchor: e.currentTarget.getBoundingClientRect() }); }}>
          <LabelChip label={l} color={colors.get(l) || ""} onRemove={() => onChange(list.filter((x) => x !== l))} />
        </span>
      ))}
      {colorFor && <LabelColorPopover anchor={colorFor.anchor} label={colorFor.label} color={colors.get(colorFor.label) || ""} onChange={(c) => onColor(colorFor.label, c)} onClose={() => setColorFor(null)} />}
      <div style={{ position: "relative" }}>
        <input ref={ref} value={q} placeholder={list.length ? "+ label" : "Adicionar label"} className="inp"
          onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(sugg[0] && q && sugg[0].toLowerCase() === q.toLowerCase() ? sugg[0] : q); } if (e.key === "Escape") setOpen(false); if (e.key === "Backspace" && !q && list.length) onChange(list.slice(0, -1)); }}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          style={{ height: 26, width: 130, fontSize: 12 }} />
        {open && (sugg.length > 0 || q.trim()) && (
          <Popover anchor={ref} onClose={() => setOpen(false)} width={220}>
            {sugg.map((o) => <button key={o} type="button" onMouseDown={(e) => { e.preventDefault(); add(o); }} className="tk-menu-item" style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 8px", borderRadius: 6, textAlign: "left", fontSize: 12.5 }}><LabelChip label={o} color={colors.get(o) || ""} /></button>)}
            {q.trim() && !options.some((o) => o.toLowerCase() === q.trim().toLowerCase()) && <button type="button" onMouseDown={(e) => { e.preventDefault(); add(q); }} className="tk-menu-item" style={{ display: "flex", width: "100%", padding: "6px 8px", borderRadius: 6, textAlign: "left", fontSize: 12.5, color: "var(--accent)" }}>Criar "{q.trim()}"</button>}
          </Popover>
        )}
      </div>
    </div>
  );
}

function AttachmentsSection({ task, onTaskChange }) {
  const [progress, setProgress] = useState(null); // 0..1
  const fileRef = useRef(null);
  const list = task.attachments || [];
  const send = async (files) => {
    for (const file of Array.from(files || [])) {
      if (!file) continue;
      if (file.size > 5 * 1024 * 1024) { window.toast && window.toast(`${file.name}: arquivo acima de 5MB`, "warn"); continue; }
      setProgress(0);
      try { const r = await api.taskAttachment(task.id, file, (p) => setProgress(p)); onTaskChange(r.task); }
      catch (err) { window.toast && window.toast(`Não deu pra anexar ${file.name} · ${err.message || "tente de novo"}`, "neg"); }
      finally { setProgress(null); }
    }
  };
  const act = async (fn, msg) => { try { const t = await fn(); onTaskChange(t); } catch (err) { window.toast && window.toast(`${msg} · ${err.message || "tente de novo"}`, "neg"); } };
  const isCover = (a) => a.url && (task.cover === a.url || task.photo === a.url);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span className="kicker">Anexos{list.length ? ` · ${list.length}` : ""}</span>
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8, alignItems: "center" }}>
          {progress != null && <span className="mono dim" style={{ fontSize: 11 }}>enviando {Math.round(progress * 100)}%</span>}
          <SecondaryButton size="sm" onClick={() => fileRef.current?.click()} disabled={progress != null}><Icon name="paperclip" size={13} /> Anexar arquivo</SecondaryButton>
          <input ref={fileRef} type="file" multiple style={{ display: "none" }} onChange={(e) => { send(e.target.files); e.target.value = ""; }} />
        </span>
      </div>
      {list.length === 0 && <div className="mono dim" style={{ fontSize: 11.5 }}>arraste, cole (Ctrl+V) ou anexe um arquivo de até 5MB</div>}
      {list.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 8 }}>
          {list.map((a) => {
            const img = /^image\//.test(a.mime || "");
            return (
              <div key={a.id} className="tk-row" style={{ position: "relative", border: "1px solid var(--line-1)", borderRadius: "var(--r-2)", background: "var(--bg-inset)", overflow: "hidden" }}>
                <a href={assetUrl(a.url)} target="_blank" rel="noreferrer" title={a.name} style={{ display: "block" }}>
                  {img ? <img src={assetUrl(a.url)} alt="" style={{ width: "100%", height: 76, objectFit: "cover", display: "block" }} />
                    : <div style={{ height: 76, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--fg-4)" }}><Icon name="file" size={26} /></div>}
                  <div style={{ padding: "5px 7px", fontSize: 11, color: "var(--fg-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name || "arquivo"}</div>
                </a>
                {isCover(a) && <span className="chip accent" style={{ position: "absolute", top: 4, left: 4, minHeight: 16, fontSize: 9.5 }}>capa</span>}
                <span className="tk-hover" style={{ position: "absolute", top: 4, right: 4, display: "inline-flex", gap: 2 }}>
                  {img && <button type="button" title={isCover(a) ? "Remover capa" : "Definir como capa"} onClick={() => act(() => api.taskCover(task.id, isCover(a) ? "" : a.id), "Não deu pra mudar a capa")} style={{ width: 22, height: 22, borderRadius: 6, background: "var(--bg-1)", border: "1px solid var(--line-2)", color: "var(--fg-2)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon name="image" size={12} /></button>}
                  <button type="button" title="Remover anexo" onClick={() => { if (window.confirm(`Remover o anexo ${a.name || ""}?`)) act(() => api.taskAttachmentDelete(task.id, a.id), "Não deu pra remover"); }} style={{ width: 22, height: 22, borderRadius: 6, background: "var(--bg-1)", border: "1px solid var(--line-2)", color: "var(--neg)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon name="x" size={12} /></button>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SubtasksSection({ task, subtasks, usersById, onOpen, actions, autoFocus }) {
  const [adding, setAdding] = useState(!!autoFocus);
  const ref = useRef(null);
  useEffect(() => { if (adding) ref.current?.focus(); }, [adding]);
  useEffect(() => { if (autoFocus) setAdding(true); }, [autoFocus]);
  const done = subtasks.filter((s) => s.completed).length;
  const submit = async (again) => {
    const v = (ref.current?.value || "").trim();
    if (!v) { if (!again) setAdding(false); return; }
    const ok = await actions.createSubtask(task.id, v);
    if (ok && ref.current) { ref.current.value = ""; if (!again) setAdding(false); }
  };
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span className="kicker">Subtarefas{subtasks.length ? ` · ${done}/${subtasks.length}` : ""}</span>
        <button type="button" onClick={() => setAdding(true)} style={{ marginLeft: "auto", fontSize: 12, color: "var(--accent)", fontWeight: 600 }}>+ Adicionar subtarefa</button>
      </div>
      {subtasks.map((s) => (
        <div key={s.id} className="tk-row" style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: "1px solid var(--line-1)" }}>
          <CompleteCircle done={!!s.completed} size={18} onToggle={(v) => actions.complete(s.id, v)} />
          <button type="button" onClick={() => onOpen(s.id)} style={{ flex: 1, minWidth: 0, textAlign: "left", fontSize: 13, color: s.completed ? "var(--fg-3)" : "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title || "(sem título)"}</button>
          {s.dueDate && <span className="tnum" style={{ fontSize: 11, color: dueState(s.dueDate, { completed: !!s.completed })?.tone }}>{dueState(s.dueDate, { completed: !!s.completed })?.label}</span>}
          {assigneesOf(s).slice(0, 2).map((id) => <Avatar key={id} id={id} name={usersById.get(id)?.name || id} size={18} />)}
        </div>
      ))}
      {adding && (
        <input ref={ref} className="inp" placeholder="Nome da subtarefa (Enter salva)" style={{ width: "100%", marginTop: 6, boxSizing: "border-box" }}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); submit(true); } if (e.key === "Escape") setAdding(false); }}
          onBlur={() => submit(false)} />
      )}
    </div>
  );
}

function Row({ label, children, anchorRef }) {
  return (
    <div className="tk-row" style={{ display: "flex", alignItems: "flex-start", gap: 10, minHeight: 30 }}>
      <span className="kicker" style={{ width: 108, flexShrink: 0, paddingTop: 9 }}>{label}</span>
      <div ref={anchorRef} style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, minHeight: 30 }}>{children}</div>
    </div>
  );
}
const ghostBtn = { display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 8px", borderRadius: "var(--r-2)", fontSize: 12.5, color: "var(--fg-2)", background: "transparent", border: "1px dashed transparent" };
const hoverIn = (e) => { e.currentTarget.style.background = "var(--hover)"; };
const hoverOut = (e) => { e.currentTarget.style.background = "transparent"; };
const IconBtn = ({ title, onClick, active, danger, children, btnRef }) => (
  <button ref={btnRef} type="button" title={title} aria-label={title} onClick={onClick} onMouseEnter={hoverIn} onMouseLeave={hoverOut}
    style={{ width: 32, height: 32, borderRadius: "var(--r-2)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: danger ? "var(--neg)" : active ? "var(--accent)" : "var(--fg-3)", background: "transparent" }}>{children}</button>
);

export function TaskPanel({ task, tasks, columns, board, users, usersById, labelColors, labelOptions, me, mobile, expanded, onToggleExpand, onClose, onOpen, stack, onBack, saveField, actions, activityVersion, onTaskChange, focusHint }) {
  useEsc(onClose);
  const done = !!task.completed;
  const [tab, setTab] = useState("comments");
  const [menu, setMenu] = useState(null);
  const [picker, setPicker] = useState(null);
  const [dropping, setDropping] = useState(false);
  const rootRef = useRef(null);
  const assigneesRef = useRef(null), followersRef = useRef(null), startRef = useRef(null), dueRef = useRef(null), moreRef = useRef(null);
  const subtasks = useMemo(() => tasks.filter((t) => t.parentId === task.id).sort(byOrder), [tasks, task.id]);
  const parent = task.parentId ? tasks.find((t) => t.id === task.parentId) : null;
  const liked = (task.likes || []).includes(me);
  const following = (task.followers || []).includes(me);
  const SAAS = (typeof window !== "undefined" && window.SEED?.SAAS) || [];
  const products = SAAS.filter((s) => s.id === task.saas || s.id === (actions.activeSaas && actions.activeSaas()));
  const blockers = (task.blockedBy || []).map((id) => tasks.find((t) => t.id === id)).filter(Boolean);
  const blocking = tasks.filter((t) => (t.blockedBy || []).includes(task.id));

  useEffect(() => { setTab("comments"); }, [task.id]);
  useEffect(() => { document.body.dataset.tkPanel = "1"; return () => { delete document.body.dataset.tkPanel; }; }, []);
  useEffect(() => { if (!mobile) rootRef.current?.focus({ preventScroll: true }); }, [task.id, mobile]);

  const followToggle = async () => {
    try { const r = following ? await api.taskUnfollow(task.id, me) : await api.taskFollow(task.id, me); onTaskChange(r.task); }
    catch (err) { window.toast && window.toast(`Não deu pra ${following ? "deixar de seguir" : "seguir"} · ${err.message}`, "neg"); }
  };
  const setFollowers = async (ids) => {
    const cur = task.followers || [];
    const add = ids.filter((x) => !cur.includes(x)), rm = cur.filter((x) => !ids.includes(x));
    try {
      let t = task;
      for (const u of add) t = (await api.taskFollow(task.id, u)).task;
      for (const u of rm) t = (await api.taskUnfollow(task.id, u)).task;
      onTaskChange(t);
    } catch (err) { window.toast && window.toast(`Seguidores não salvos · ${err.message}`, "neg"); }
  };
  const like = async () => { try { const r = await api.taskLike(task.id); onTaskChange(r.task); } catch (err) { window.toast && window.toast(`Não deu pra curtir · ${err.message}`, "neg"); } };
  const onFiles = (e) => {
    const files = e.dataTransfer?.files; setDropping(false);
    if (!files?.length) return;
    e.preventDefault();
    const input = rootRef.current?.querySelector('input[type="file"]');
    if (input) { const dt = new DataTransfer(); for (const f of files) dt.items.add(f); input.files = dt.files; input.dispatchEvent(new Event("change", { bubbles: true })); }
  };
  const onPaste = (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.kind === "file");
    if (!item) return;
    const target = e.target; if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT") && !target.closest?.("[data-panel-root]")) return;
    const file = item.getAsFile(); if (!file) return;
    e.preventDefault();
    const input = rootRef.current?.querySelector('input[type="file"]');
    if (input) { const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files; input.dispatchEvent(new Event("change", { bubbles: true })); }
  };

  const shell = mobile
    ? { position: "fixed", inset: 0, zIndex: 70, background: "var(--bg-1)", display: "flex", flexDirection: "column" }
    : { width: expanded ? "min(920px, 62vw)" : "min(560px, 46vw)", minWidth: 380, flexShrink: 0, borderLeft: "1px solid var(--line-1)", background: "var(--bg-1)", display: "flex", flexDirection: "column", minHeight: 0, boxShadow: "var(--shadow-card)" };

  return (
    <div ref={rootRef} data-panel-root="1" data-tk-layer="1" role="dialog" aria-label={task.title || "Tarefa"} tabIndex={-1} style={{ ...shell, outline: "none", position: shell.position || "relative" }}
      onDragEnter={(e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); setDropping(true); } }}
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); } }}
      onDragLeave={(e) => { if (!rootRef.current?.contains(e.relatedTarget)) setDropping(false); }}
      onDrop={onFiles} onPaste={onPaste}
      onKeyDown={(e) => { if (e.key === "Escape") return; e.stopPropagation(); }}>
      {dropping && <div className="tk-drop-overlay">Solte para anexar</div>}
      {/* Cabeçalho */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "10px 12px 10px 16px", borderBottom: "1px solid var(--line-1)", flexShrink: 0 }}>
        {stack.length > 0 && parent && <button type="button" onClick={onBack} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5, color: "var(--accent)", fontWeight: 600, marginRight: 6, maxWidth: 200 }}><Icon name="arrowLeft" size={14} /><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{parent.title || "tarefa-mãe"}</span></button>}
        <button type="button" onClick={() => actions.complete(task.id, !done)} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 30, padding: "0 10px 0 6px", borderRadius: "var(--r-2)", border: `1px solid ${done ? "var(--pos)" : "var(--line-2)"}`, background: done ? "var(--pos-soft)" : "var(--bg-1)", color: done ? "var(--pos)" : "var(--fg-2)", fontSize: 12.5, fontWeight: 600 }}>
          <span style={{ width: 18, height: 18, borderRadius: 999, border: `1.5px solid ${done ? "var(--pos)" : "var(--line-strong)"}`, background: done ? "var(--pos)" : "transparent", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon name="check" size={11} /></span>
          {done ? "Concluída" : "Marcar como concluída"}
        </button>
        <span style={{ flex: 1 }} />
        <IconBtn title={liked ? "Descurtir" : "Curtir"} onClick={like} active={liked}><Icon name="thumb" size={16} /></IconBtn>
        <IconBtn title="Copiar link" onClick={() => actions.copyLink(task.id)}><Icon name="link" size={16} /></IconBtn>
        {!mobile && <IconBtn title={expanded ? "Recolher painel" : "Expandir painel"} onClick={onToggleExpand}><Icon name={expanded ? "collapse" : "expand"} size={16} /></IconBtn>}
        <IconBtn title="Mais ações" btnRef={moreRef} onClick={() => setMenu(moreRef.current?.getBoundingClientRect())}><Icon name="more" size={16} /></IconBtn>
        <IconBtn title="Fechar (Esc)" onClick={onClose}><Icon name="x" size={16} /></IconBtn>
        {menu && <Menu anchor={menu} onClose={() => setMenu(null)} title="Tarefa" items={[
          ...taskMenuItems(task, { columns, done, me, actions, inPanel: true }).slice(0, -2), // sem o separador + Excluir do fim (voltam abaixo)
          task.parentId ? { label: "Converter em tarefa do quadro", onClick: () => actions.convert(task.id, { to: "task" }) } : { label: "Converter em subtarefa de…", onClick: () => actions.convert(task.id, { to: "subtask" }) },
          { label: "Bloqueada por…", onClick: () => actions.pickBlocker(task.id) },
          { sep: true },
          { label: "Excluir", danger: true, onClick: () => actions.remove(task.id) },
        ]} />}
      </div>

      {/* Corpo */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 18px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
        {task.createdBy && <div className="mono dim" style={{ fontSize: 11 }}>criada por {usersById.get(task.createdBy)?.name || displayName(task.createdBy) || task.createdBy}{task.createdAt ? ` · ${when(task.createdAt)}` : ""}{task.recurrenceOf ? " · ocorrência de tarefa recorrente" : ""}{task.followUpOf ? " · acompanhamento" : ""}</div>}
        <TitleField key={"t" + task.id} task={task} save={(v) => saveField(task.id, { title: v })} />

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Row label="Responsáveis" anchorRef={assigneesRef}>
            {assigneesOf(task).map((id) => <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}><UserAvatarRing id={id} name={usersById.get(id)?.name || id} size={22} />{usersById.get(id)?.name || displayName(id) || id}</span>)}
            <button type="button" onClick={() => setPicker("assignees")} onMouseEnter={hoverIn} onMouseLeave={hoverOut} style={{ ...ghostBtn, color: assigneesOf(task).length ? "var(--fg-4)" : "var(--fg-3)" }}><Icon name="user" size={14} />{assigneesOf(task).length ? "" : "Atribuir"}</button>
            {picker === "assignees" && <UserPicker anchor={assigneesRef} users={users} value={assigneesOf(task)} multi title="Responsáveis" onChange={(ids) => saveField(task.id, { assignees: ids })} onClose={() => setPicker(null)} />}
          </Row>
          <Row label="Datas">
            <button ref={startRef} type="button" onClick={() => setPicker("start")} onMouseEnter={hoverIn} onMouseLeave={hoverOut} style={{ ...ghostBtn, color: task.startDate ? "var(--fg-1)" : "var(--fg-3)" }}><Icon name="play" size={13} />{task.startDate ? `Início ${fmtDue(task.startDate)}` : "Início"}</button>
            <span className="dim" style={{ fontSize: 12 }}>→</span>
            <button ref={dueRef} type="button" onClick={() => setPicker("due")} onMouseEnter={hoverIn} onMouseLeave={hoverOut} style={{ ...ghostBtn, color: task.dueDate ? (dueState(task.dueDate, { completed: done })?.tone) : "var(--fg-3)", fontWeight: task.dueDate ? 600 : 500 }}><Icon name="calendar" size={13} />{task.dueDate ? `Prazo ${dueState(task.dueDate, { completed: done })?.label}` : "Prazo"}</button>
            {picker === "start" && <DateQuick anchor={startRef} value={task.startDate} title="Início" onChange={(v) => saveField(task.id, { startDate: v })} onClose={() => setPicker(null)} />}
            {picker === "due" && <DateQuick anchor={dueRef} value={task.dueDate} title="Prazo" min={task.startDate || undefined} onChange={(v) => saveField(task.id, { dueDate: v })} onClose={() => setPicker(null)} />}
          </Row>
          <Row label="Coluna">
            <select className="inp" value={columns.some((c) => c.key === task.column) ? task.column : columns[0].key} onChange={(e) => actions.move(task.id, e.target.value)} style={{ height: 28, fontSize: 12.5 }}>
              {columns.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
            </select>
          </Row>
          <Row label="Prioridade">
            {PRIORITIES.map(([v, l]) => (
              <button key={v || "none"} type="button" onClick={() => saveField(task.id, { priority: v })} style={{ height: 26, padding: "0 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, border: `1px solid ${(task.priority || "") === v ? (v ? priTone(v) : "var(--line-strong)") : "var(--line-2)"}`, background: (task.priority || "") === v ? (v ? priSoft(v) : "var(--bg-2)") : "var(--bg-1)", color: v ? priTone(v) : "var(--fg-3)" }}>{v || l}</button>
            ))}
          </Row>
          <Row label="Labels">
            <LabelsField value={task.labels || []} options={labelOptions} colors={labelColors} onChange={(labels) => saveField(task.id, { labels })} onColor={(name, color) => actions.labelColor(name, color)} />
          </Row>
          <Row label="Repetir">
            <RecurrencePicker value={task.recurrence} dueDate={task.dueDate} onChange={(recurrence) => saveField(task.id, { recurrence })} />
          </Row>
          <Row label="Produto">
            <select className="inp" value={task.saas || ""} onChange={(e) => saveField(task.id, { saas: e.target.value })} style={{ height: 28, fontSize: 12.5 }}>
              <option value="">Geral (todos)</option>
              {products.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Row>
          <Row label="Seguidores" anchorRef={followersRef}>
            {(task.followers || []).slice(0, 8).map((id) => <UserAvatarRing key={id} id={id} name={usersById.get(id)?.name || id} size={20} />)}
            {(task.followers || []).length > 8 && <span className="mono dim" style={{ fontSize: 11 }}>+{task.followers.length - 8}</span>}
            <button type="button" onClick={followToggle} onMouseEnter={hoverIn} onMouseLeave={hoverOut} style={{ ...ghostBtn, color: "var(--fg-3)" }}>{following ? "Deixar de seguir" : "Seguir"}</button>
            <button type="button" onClick={() => setPicker("followers")} onMouseEnter={hoverIn} onMouseLeave={hoverOut} title="Adicionar seguidores" style={{ ...ghostBtn, color: "var(--fg-4)" }}><Icon name="plus" size={13} /></button>
            {picker === "followers" && <UserPicker anchor={followersRef} users={users} value={task.followers || []} multi title="Seguidores" onChange={setFollowers} onClose={() => setPicker(null)} />}
          </Row>
          {(blockers.length > 0 || blocking.length > 0) && (
            <Row label="Dependências">
              {blockers.map((b) => <button key={b.id} type="button" onClick={() => onOpen(b.id)} className="chip" style={{ color: b.completed ? "var(--pos)" : "var(--neg)", background: b.completed ? "var(--pos-soft)" : "var(--neg-soft)", maxWidth: 220 }}><Icon name={b.completed ? "check" : "blocked"} size={11} /><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>bloqueada por {b.title}</span><span role="button" title="Tirar bloqueio" onClick={(e) => { e.stopPropagation(); actions.unblock(task.id, b.id); }} style={{ marginLeft: 2 }}>✕</span></button>)}
              {blocking.map((b) => <button key={b.id} type="button" onClick={() => onOpen(b.id)} className="chip" style={{ maxWidth: 220 }}><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>bloqueia {b.title}</span></button>)}
            </Row>
          )}
        </div>

        <DescriptionField key={"d" + task.id} task={task} save={(v) => saveField(task.id, { description: v })} />
        <SubtasksSection task={task} subtasks={subtasks} usersById={usersById} onOpen={(id) => onOpen(id, { push: true })} actions={actions} autoFocus={focusHint === "subtask"} />
        <AttachmentsSection task={task} onTaskChange={onTaskChange} />
      </div>

      {/* Rodapé: comentários / atividade */}
      <div style={{ borderTop: "1px solid var(--line-1)", padding: mobile ? "10px 18px calc(12px + env(safe-area-inset-bottom))" : "10px 72px 12px 18px", background: "var(--bg-0)", flexShrink: 0, maxHeight: "46%", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ display: "flex", gap: 2, marginBottom: 8, flexShrink: 0 }}>
          {[["comments", `Comentários${(task.comments || []).length ? ` · ${task.comments.length}` : ""}`], ["activity", "Atividade"]].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setTab(k)} style={{ padding: "5px 10px", borderRadius: "var(--r-2)", fontSize: 12.5, fontWeight: tab === k ? 600 : 500, background: tab === k ? "var(--bg-2)" : "transparent", color: tab === k ? "var(--fg-1)" : "var(--fg-3)" }}>{l}</button>
          ))}
        </div>
        <div style={{ overflowY: "auto", minHeight: 0, flex: 1, marginBottom: 10 }}>
          {tab === "comments" ? <CommentsList task={task} users={users} usersById={usersById} me={me} onTaskChange={onTaskChange} /> : <ActivityTab taskId={task.id} usersById={usersById} users={users} columns={columns} version={activityVersion} />}
        </div>
        <Composer task={task} users={users} me={me} onSent={onTaskChange} autoFocus={focusHint === "comment"} />
      </div>
    </div>
  );
}
