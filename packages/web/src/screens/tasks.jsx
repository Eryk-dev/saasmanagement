import React from "react";
import { api } from "../lib/api.js";
import { useData } from "../data.jsx";
import { chromeBtnStyleSmall } from "../lib/ui.js";
import { Avatar, EmptyState, PrimaryButton } from "../atoms.jsx";
import { inputStyle, labelStyle } from "../components/theme-inputs.jsx";
// Tarefas — kanban interno do time (estilo Trello). Cards = collection `tasks`
// (CRUD genérico); colunas = 1 registro em `task_boards` (criado ao editar — sem
// board salvo, vale DEFAULT_COLUMNS). Coluna tem KEY estável: renomear não órfã
// cards; remover coluna derruba os cards na primeira (mesmo comportamento do
// pipeline). Filtros: SaaS, responsável (usuários do time), busca. Comentários
// vivem no card (PATCH do array inteiro — time pequeno, sem race real).

const { useState, useEffect, useCallback, useRef } = React;

const DEFAULT_COLUMNS = [
  { key: "todo", name: "A fazer", color: "" },
  { key: "doing", name: "Em andamento", color: "" },
  { key: "done", name: "Concluído", color: "" },
];
const COLUMN_COLORS = [
  "", "oklch(0.62 0.13 240)", "oklch(0.58 0.15 277)", "oklch(0.62 0.13 165)",
  "oklch(0.70 0.13 85)", "oklch(0.64 0.16 25)",
];
const PRIORITY_OPTS = [["", "—"], ["P0", "P0"], ["P1", "P1"], ["P2", "P2"]];
const priTone = (p) => p === "P0" ? "var(--neg)" : p === "P1" ? "var(--warn)" : "var(--fg-4)";

function currentUser() {
  try { return JSON.parse(localStorage.getItem("cockpit_user") || "null"); } catch { return null; }
}
// Compat: tarefas criadas antes do multi-responsável têm `assignee` string.
const assigneesOf = (t) => t.assignees || (t.assignee ? [t.assignee] : []);
const today = () => new Date().toISOString().slice(0, 10);
function fmtDue(d) {
  const dt = new Date(d + "T00:00:00");
  return isNaN(dt) ? d : dt.toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
}

// O App remonta a tela a cada refresh (key=dataVersion) — filtros sobrevivem
// numa variável de módulo, mesmo padrão do settings.jsx.
let lastFilters = { saas: "all", assignee: "all" };

function TasksScreen() {
  const { SAAS } = window.SEED;
  const { version, openDelete } = useData();
  const [tasks, setTasks] = useState([]);
  const [board, setBoard] = useState(null);   // registro task_boards (null = só defaults)
  const [users, setUsers] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [fSaas, setFSaas] = useState(lastFilters.saas);
  const [fAssignee, setFAssignee] = useState(lastFilters.assignee);
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(null);   // { task: record|null, column: key }
  const [dragging, setDragging] = useState(null);

  useEffect(() => { lastFilters = { saas: fSaas, assignee: fAssignee }; }, [fSaas, fAssignee]);

  const load = useCallback(async () => {
    const [ts, boards, us] = await Promise.all([
      api.list("tasks"),
      api.list("task_boards"),
      api.listUsers().catch(() => []),
    ]);
    setTasks(ts); setBoard(boards[0] || null); setUsers(us); setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load, version]);

  const columns = board?.columns?.length ? board.columns : DEFAULT_COLUMNS;
  const colKeyOf = (t) => columns.some((c) => c.key === t.column) ? t.column : columns[0].key;

  async function saveColumns(cols) {
    const saved = board
      ? await api.update("task_boards", board.id, { columns: cols })
      : await api.create("task_boards", { columns: cols });
    setBoard(saved);
  }

  const shown = tasks.filter((t) =>
    (fSaas === "all" || t.saas === fSaas) &&
    (fAssignee === "all" || assigneesOf(t).includes(fAssignee)) &&
    (!q || `${t.title} ${t.description || ""}`.toLowerCase().includes(q.toLowerCase())));

  const byOrder = (a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  const byColumn = {};
  columns.forEach((c) => byColumn[c.key] = []);
  shown.forEach((t) => byColumn[colKeyOf(t)].push(t));
  Object.values(byColumn).forEach((list) => list.sort(byOrder));

  // Drop na coluna = vai pro fim; drop em cima de um card = entra antes dele
  // (order = ponto médio entre vizinhos — float, suficiente pra v1).
  function moveTask(id, colKey, beforeId = null) {
    if (beforeId === id) return;
    const inCol = tasks.filter((t) => t.id !== id && colKeyOf(t) === colKey).sort(byOrder);
    let order;
    if (beforeId) {
      const idx = inCol.findIndex((t) => t.id === beforeId);
      const next = Number(inCol[idx]?.order) || 0;
      order = idx > 0 ? ((Number(inCol[idx - 1].order) || 0) + next) / 2 : next - 1;
    } else {
      order = inCol.length ? (Number(inCol[inCol.length - 1].order) || 0) + 1 : 1;
    }
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, column: colKey, order } : t));
    api.update("tasks", id, { column: colKey, order }).catch((err) => console.warn("task move not persisted:", err.message));
  }

  async function saveTask(draft) {
    if (draft.id) {
      const saved = await api.update("tasks", draft.id, draft);
      setTasks((prev) => prev.map((t) => t.id === saved.id ? saved : t));
    } else {
      const inCol = tasks.filter((t) => colKeyOf(t) === draft.column);
      const order = inCol.length ? Math.max(...inCol.map((t) => Number(t.order) || 0)) + 1 : 1;
      const saved = await api.create("tasks", { ...draft, order });
      setTasks((prev) => [...prev, saved]);
    }
    setModal(null);
  }

  if (!loaded) return null;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Toolbar — filtros + nova tarefa */}
      <div style={{ padding: "12px 24px", borderBottom: "1px solid var(--line-1)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, background: "var(--bg-0)" }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <FilterChip label="Todos" active={fSaas === "all"} onClick={() => setFSaas("all")} />
          {SAAS.map((s) => (
            <FilterChip key={s.id} label={s.name} dot={window.productTone(s)} active={fSaas === s.id} onClick={() => setFSaas(s.id)} />
          ))}
          <span style={{ color: "var(--line-2)" }}>·</span>
          <select value={fAssignee} onChange={(e) => setFAssignee(e.target.value)} style={{ ...inputStyle, width: "auto", height: 26, fontSize: 12 }}>
            <option value="all">todos responsáveis</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="buscar…" style={{ ...inputStyle, width: 160, height: 26, fontSize: 12 }} />
        </div>
        <PrimaryButton onClick={() => setModal({ task: null, column: columns[0].key })}>+ tarefa</PrimaryButton>
      </div>

      {/* Board */}
      {tasks.length === 0 ? (
        <EmptyState
          title="Nenhuma tarefa ainda"
          hint="Crie a primeira tarefa do time — atribua a uma pessoa e a um SaaS, arraste entre colunas, comente no card."
          action={<PrimaryButton onClick={() => setModal({ task: null, column: columns[0].key })}>+ Criar tarefa</PrimaryButton>}
        />
      ) : (
        <div style={{ flex: 1, overflowX: "auto", padding: 14, display: "grid", gridAutoFlow: "column", gridAutoColumns: "minmax(260px, 1fr)", gap: 10, alignItems: "start" }}>
          {columns.map((col, i) => (
            <TaskColumn key={col.key}
              col={col} idx={i} count={columns.length}
              cards={byColumn[col.key] || []}
              users={users}
              dragging={dragging} setDragging={setDragging}
              onDrop={(beforeId) => { if (dragging) moveTask(dragging, col.key, beforeId); setDragging(null); }}
              onOpen={(t) => setModal({ task: t, column: col.key })}
              onAdd={() => setModal({ task: null, column: col.key })}
              onRename={(name) => saveColumns(columns.map((c) => c.key === col.key ? { ...c, name } : c))}
              onColor={(color) => saveColumns(columns.map((c) => c.key === col.key ? { ...c, color } : c))}
              onMove={(dir) => {
                const next = [...columns];
                [next[i], next[i + dir]] = [next[i + dir], next[i]];
                saveColumns(next);
              }}
              onRemove={() => saveColumns(columns.filter((c) => c.key !== col.key))}
            />
          ))}
          <button onClick={() => saveColumns([...columns, { key: `c_${Date.now().toString(36)}`, name: "Nova coluna", color: "" }])}
            style={{ ...chromeBtnStyleSmall, height: 36, border: "1px dashed var(--line-2)", background: "transparent", color: "var(--fg-4)" }}>
            <span style={{ fontSize: 12 }}>+ coluna</span>
          </button>
        </div>
      )}

      {modal && (
        <TaskModal
          task={modal.task}
          presetColumn={modal.column}
          presetSaas={fSaas !== "all" ? fSaas : ""}
          columns={columns}
          users={users}
          onSave={saveTask}
          onDelete={(t) => { setModal(null); openDelete("tasks", t); }}
          onComment={(t, saved) => setTasks((prev) => prev.map((x) => x.id === saved.id ? saved : x))}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

function FilterChip({ label, dot, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      height: 26, padding: "0 10px", borderRadius: "var(--r-2)",
      border: "1px solid " + (active ? "var(--line-strong)" : "var(--line-1)"),
      background: active ? "var(--bg-3)" : "var(--bg-2)",
      color: active ? "var(--fg-1)" : "var(--fg-3)",
      fontSize: 12, fontFamily: "var(--mono)",
      display: "inline-flex", alignItems: "center", gap: 6,
    }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: 2, background: dot }} />}
      {label}
    </button>
  );
}

// ─────────────────────────────────────────────── Coluna
function TaskColumn({ col, idx, count, cards, users, dragging, setDragging, onDrop, onOpen, onAdd, onRename, onColor, onMove, onRemove }) {
  const [over, setOver] = useState(false);
  const [menu, setMenu] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onDrop(null); }}
      style={{
        background: "var(--bg-1)",
        border: "1px solid " + (over ? "var(--accent-line)" : "var(--line-1)"),
        borderRadius: "var(--r-3)",
        padding: 10, minHeight: 240,
        display: "flex", flexDirection: "column", gap: 6,
      }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 4px 6px", borderBottom: "1px solid var(--line-1)", position: "relative" }}>
        <div style={{ fontSize: 12, fontWeight: 500, display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          {col.color && <span style={{ width: 8, height: 8, borderRadius: 2, background: col.color, flexShrink: 0 }} />}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{col.name}</span>
          <span className="mono dim" style={{ fontSize: 10 }}>{cards.length}</span>
        </div>
        <button onClick={() => setMenu((m) => !m)} className="mono dim" style={{ fontSize: 12, padding: "0 4px" }}>⋯</button>
        {menu && (
          <ColumnMenu col={col} idx={idx} count={count} hasCards={cards.length > 0}
            onRename={onRename} onColor={onColor} onMove={onMove} onRemove={onRemove}
            onClose={() => setMenu(false)} />
        )}
      </div>
      {cards.map((t) => (
        <TaskCard key={t.id} t={t} users={users}
          onDragStart={() => setDragging(t.id)}
          onDropBefore={() => onDrop(t.id)}
          onOpen={() => onOpen(t)}
        />
      ))}
      {cards.length === 0 && <div className="mono dim" style={{ fontSize: 11, textAlign: "center", padding: "20px 0" }}>vazio</div>}
      <button onClick={onAdd} className="mono dim" style={{ fontSize: 11, textAlign: "left", padding: "6px 4px", borderRadius: "var(--r-1)" }}
        onMouseEnter={(e) => e.currentTarget.style.background = "var(--hover)"}
        onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
        + adicionar
      </button>
    </div>
  );
}

function ColumnMenu({ col, idx, count, hasCards, onRename, onColor, onMove, onRemove, onClose }) {
  const [name, setName] = useState(col.name);
  const ref = useRef(null);
  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) onClose(); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);
  function commitName() { if (name.trim() && name !== col.name) onRename(name.trim()); }
  return (
    <div ref={ref} style={{
      position: "absolute", top: "calc(100% + 4px)", right: 0, width: 200, zIndex: 60,
      background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)",
      boxShadow: "var(--shadow-pop)", padding: 8, display: "flex", flexDirection: "column", gap: 8,
    }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={labelStyle}>Nome</span>
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={commitName}
          onKeyDown={(e) => { if (e.key === "Enter") { commitName(); onClose(); } }}
          style={{ ...inputStyle, height: 26, fontSize: 12 }} />
      </label>
      <div>
        <span style={labelStyle}>Cor</span>
        <div style={{ display: "flex", gap: 5, marginTop: 4 }}>
          {COLUMN_COLORS.map((c) => (
            <button key={c || "none"} onClick={() => onColor(c)} title={c ? "" : "sem cor"} style={{
              width: 18, height: 18, borderRadius: 4,
              background: c || "var(--bg-3)",
              border: "1px solid " + ((col.color || "") === c ? "var(--fg-1)" : "var(--line-2)"),
            }}>{!c && <span className="dim" style={{ fontSize: 9 }}>×</span>}</button>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, borderTop: "1px solid var(--line-1)", paddingTop: 8 }}>
        <button disabled={idx === 0} onClick={() => { onMove(-1); onClose(); }} style={{ ...chromeBtnStyleSmall, opacity: idx === 0 ? 0.4 : 1 }}>◀</button>
        <button disabled={idx === count - 1} onClick={() => { onMove(1); onClose(); }} style={{ ...chromeBtnStyleSmall, opacity: idx === count - 1 ? 0.4 : 1 }}>▶</button>
        <button disabled={count <= 1} onClick={() => { onRemove(); onClose(); }}
          title={hasCards ? "cards caem na primeira coluna" : ""}
          style={{ ...chromeBtnStyleSmall, marginLeft: "auto", color: "var(--neg)", opacity: count <= 1 ? 0.4 : 1 }}>
          <span style={{ fontSize: 11 }}>excluir</span>
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── Card
function TaskCard({ t, users, onDragStart, onDropBefore, onOpen }) {
  const { SAAS } = window.SEED;
  const s = SAAS.find((x) => x.id === t.saas);
  const assignees = assigneesOf(t).map((id) => users.find((u) => u.id === id)).filter(Boolean);
  const overdue = t.dueDate && t.dueDate < today();
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDropBefore(); }}
      onClick={onOpen}
      style={{
        background: "var(--bg-2)",
        border: "1px solid var(--line-1)",
        borderRadius: "var(--r-2)",
        padding: "8px 10px",
        cursor: "grab",
      }}>
      <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.35 }}>{t.title}</div>
      {(t.labels || []).length > 0 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 5 }}>
          {t.labels.map((l) => <LabelChip key={l} label={l} />)}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "var(--fg-3)", minWidth: 0 }}>
          {assignees.length > 0 && (
            <span style={{ display: "inline-flex" }}>
              {assignees.map((u, i) => (
                <span key={u.id} style={{ marginLeft: i ? -5 : 0, display: "inline-flex" }}>
                  <Avatar id={u.id} name={u.name} size={16} />
                </span>
              ))}
            </span>
          )}
          {t.dueDate && <span className="mono" style={{ color: overdue ? "var(--neg)" : "var(--fg-3)" }}>{fmtDue(t.dueDate)}</span>}
          {t.priority && <span className="mono" style={{ color: priTone(t.priority) }}>· {t.priority}</span>}
          {(t.comments || []).length > 0 && <span className="mono dim">❞ {t.comments.length}</span>}
        </div>
        {s && (
          <span className="mono dim" style={{ fontSize: 10, display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <span style={{ width: 6, height: 6, borderRadius: 2, background: window.productTone(s) }} />
            {s.name}
          </span>
        )}
      </div>
    </div>
  );
}

function LabelChip({ label }) {
  let h = 0;
  for (const c of label) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <span className="mono" style={{
      fontSize: 9, padding: "1px 6px", borderRadius: 999,
      background: `oklch(0.30 0.05 ${h})`, color: `oklch(0.88 0.06 ${h})`,
    }}>{label}</span>
  );
}

// ─────────────────────────────────────────────── Modal (criar/editar + comentários)
function TaskModal({ task, presetColumn, presetSaas, columns, users, onSave, onDelete, onComment, onClose }) {
  const { SAAS } = window.SEED;
  const [d, setD] = useState(() => task ? { ...task, assignees: assigneesOf(task) } : {
    title: "", description: "", saas: presetSaas, assignees: [],
    column: presetColumn, priority: "", dueDate: "", labels: [],
  });
  const [comments, setComments] = useState(task?.comments || []);
  const [newComment, setNewComment] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setD((p) => ({ ...p, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (!d.title.trim()) return;
    setBusy(true);
    // Comentários são salvos na hora pelo addComment — manda o estado local pra
    // não sobrescrever com a versão de quando o modal abriu.
    try { await onSave({ ...d, title: d.title.trim(), comments }); }
    finally { setBusy(false); }
  }

  async function addComment() {
    const text = newComment.trim();
    if (!text || !task) return;
    const me = currentUser();
    const next = [...comments, { id: `c_${Date.now().toString(36)}`, author: me?.name || "API key", text, at: new Date().toISOString() }];
    const saved = await api.update("tasks", task.id, { comments: next });
    setComments(saved.comments); setNewComment("");
    onComment(task, saved);
  }

  const selStyle = { ...inputStyle, height: 30, fontSize: 13 };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "oklch(0 0 0 / 0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70 }}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit}
        style={{ width: 560, maxWidth: "94vw", maxHeight: "88vh", overflowY: "auto", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-pop)", padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 15, fontWeight: 500 }}>{task ? "Editar tarefa" : "Nova tarefa"}</span>
          {task && (
            <button type="button" onClick={() => onDelete(task)} style={{ ...chromeBtnStyleSmall, color: "var(--neg)" }}>
              <span style={{ fontSize: 11 }}>excluir</span>
            </button>
          )}
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={labelStyle}>Título</span>
          <input value={d.title} onChange={set("title")} autoFocus style={{ ...inputStyle, height: 32, fontSize: 14 }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={labelStyle}>Descrição</span>
          <textarea value={d.description} onChange={set("description")} rows={3} style={{ ...inputStyle, height: "auto", padding: 8, fontSize: 13, resize: "vertical" }} />
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={labelStyle}>SaaS</span>
            <select value={d.saas} onChange={set("saas")} style={selStyle}>
              <option value="">—</option>
              {SAAS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={labelStyle}>Responsáveis</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", minHeight: 30 }}>
              {users.map((u) => {
                const on = (d.assignees || []).includes(u.id);
                return (
                  <button type="button" key={u.id}
                    onClick={() => setD((p) => ({ ...p, assignees: on ? p.assignees.filter((x) => x !== u.id) : [...(p.assignees || []), u.id] }))}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      height: 26, padding: "0 10px 0 5px", borderRadius: 999,
                      border: "1px solid " + (on ? "var(--accent-line)" : "var(--line-1)"),
                      background: on ? "var(--accent-soft)" : "var(--bg-2)",
                      color: on ? "var(--accent)" : "var(--fg-3)",
                      fontSize: 12,
                    }}>
                    <Avatar id={u.id} name={u.name} size={18} />
                    {u.name}
                  </button>
                );
              })}
            </div>
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={labelStyle}>Coluna</span>
            <select value={d.column} onChange={set("column")} style={selStyle}>
              {columns.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={labelStyle}>Prioridade</span>
            <select value={d.priority} onChange={set("priority")} style={selStyle}>
              {PRIORITY_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={labelStyle}>Entrega</span>
            <input type="date" value={d.dueDate} onChange={set("dueDate")} style={selStyle} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={labelStyle}>Labels (vírgula)</span>
            <input value={(d.labels || []).join(", ")}
              onChange={(e) => setD((p) => ({ ...p, labels: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) }))}
              placeholder="bug, urgente" style={selStyle} />
          </label>
        </div>

        {task && (
          <div style={{ borderTop: "1px solid var(--line-1)", paddingTop: 10 }}>
            <span style={labelStyle}>Comentários</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
              {comments.map((c) => (
                <div key={c.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <Avatar id={c.author} name={c.author} size={20} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                      <span style={{ fontSize: 12, fontWeight: 500 }}>{c.author}</span>
                      <span className="mono dim" style={{ fontSize: 10 }}>{c.at ? new Date(c.at).toLocaleDateString("pt-BR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}</span>
                    </div>
                    <div style={{ fontSize: 13, color: "var(--fg-2)", whiteSpace: "pre-wrap" }}>{c.text}</div>
                  </div>
                </div>
              ))}
              {comments.length === 0 && <span className="mono dim" style={{ fontSize: 11 }}>sem comentários</span>}
              <div style={{ display: "flex", gap: 6 }}>
                <input value={newComment} onChange={(e) => setNewComment(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addComment(); } }}
                  placeholder="escreva um comentário…" style={{ ...inputStyle, flex: 1, height: 30, fontSize: 13 }} />
                <button type="button" onClick={addComment} disabled={!newComment.trim()} style={{ ...chromeBtnStyleSmall, height: 30, opacity: newComment.trim() ? 1 : 0.5 }}>
                  <span style={{ fontSize: 11 }}>comentar</span>
                </button>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, borderTop: "1px solid var(--line-1)", paddingTop: 12 }}>
          <PrimaryButton disabled={busy || !d.title.trim()}>{busy ? "Salvando…" : "Salvar"}</PrimaryButton>
          <button type="button" onClick={onClose} style={{ padding: "8px 14px", background: "var(--bg-2)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", fontSize: 13 }}>Cancelar</button>
        </div>
      </form>
    </div>
  );
}

export { TasksScreen };
