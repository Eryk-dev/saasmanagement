import React from "react";
import { SecondaryButton } from "../../atoms.jsx";
import { Popover } from "../../components/popover.jsx";
import { UserAvatarRing } from "../../components/user-picker.jsx";
import { PRIORITIES } from "../../lib/tasks.js";
import { DEFAULT_FILTERS, DEFAULT_FIELDS } from "./prefs.js";
import { SORTS, GROUPS, activeFilterCount } from "./filters.js";
import { Icon } from "./icons.jsx";
import { LabelChip } from "./card.jsx";

const { useRef, useState } = React;

const chip = (on) => ({ height: 26, padding: "0 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, border: "1px solid " + (on ? "var(--accent-line)" : "var(--line-2)"), background: on ? "var(--accent-soft)" : "var(--bg-1)", color: on ? "var(--accent)" : "var(--fg-2)", display: "inline-flex", alignItems: "center", gap: 5 });
const Section = ({ title, children }) => (<div style={{ marginBottom: 10 }}><div className="kicker" style={{ marginBottom: 6 }}>{title}</div><div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>{children}</div></div>);
const Radio = ({ on, onClick, children }) => (
  <button type="button" onClick={onClick} className={"tk-menu-item" + (on ? " is-active" : "")} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 8px", borderRadius: 6, textAlign: "left", fontSize: 12.5, color: "var(--fg-1)" }}>
    <span style={{ width: 14, height: 14, borderRadius: 999, border: `1.5px solid ${on ? "var(--accent)" : "var(--line-strong)"}`, background: on ? "var(--accent)" : "transparent", boxShadow: on ? "inset 0 0 0 3px var(--bg-1)" : "none", flexShrink: 0 }} />{children}
  </button>
);
const Check = ({ on, onClick, children }) => (
  <button type="button" onClick={onClick} className="tk-menu-item" style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 8px", borderRadius: 6, textAlign: "left", fontSize: 12.5, color: "var(--fg-1)" }}>
    <span style={{ width: 14, height: 14, borderRadius: 4, border: `1.5px solid ${on ? "var(--accent)" : "var(--line-strong)"}`, background: on ? "var(--accent)" : "transparent", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{on && <Icon name="check" size={10} />}</span>{children}
  </button>
);
const TBtn = ({ btnRef, on, count, icon, label, onClick, hideLabelOnMobile = true }) => (
  <button ref={btnRef} type="button" onClick={onClick} title={label} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 10px", borderRadius: "var(--r-2)", border: `1px solid ${on ? "var(--accent-line)" : "var(--line-2)"}`, background: on ? "var(--accent-soft)" : "var(--bg-1)", color: on ? "var(--accent)" : "var(--fg-2)", fontSize: 12.5, fontWeight: 500 }}>
    <Icon name={icon} size={14} /><span className={hideLabelOnMobile ? "hide-mobile" : ""}>{label}</span>
    {count > 0 && <span className="tnum" style={{ minWidth: 16, height: 16, padding: "0 4px", borderRadius: 999, background: "var(--accent)", color: "#fff", fontSize: 10.5, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{count}</span>}
  </button>
);
const toggleIn = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export function Toolbar({ prefs, setPrefs, users, labelOptions, labelColors, columns, q, setQ, searchRef, onHelp, onNew }) {
  const [open, setOpen] = useState(null); // filter | sort | group | options
  const refs = { filter: useRef(null), sort: useRef(null), group: useRef(null), options: useRef(null) };
  const f = { ...DEFAULT_FILTERS, ...(prefs.filters || {}) };
  const setF = (patch) => setPrefs((p) => ({ ...p, filters: { ...DEFAULT_FILTERS, ...(p.filters || {}), ...patch } }));
  const fields = { ...DEFAULT_FIELDS, ...(prefs.fields || {}) };
  const nFilters = activeFilterCount(f);
  const sortOn = prefs.sort?.key && prefs.sort.key !== "manual";
  const groupOn = prefs.group && prefs.group !== "column";
  const optionsOn = prefs.done !== "all" || prefs.compact || prefs.hideEmpty || prefs.subtasksOnBoard || Object.values(fields).some((v) => !v);
  const close = () => setOpen(null);
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ position: "relative" }}>
        <span style={{ position: "absolute", left: 8, top: 8, color: "var(--fg-4)" }}><Icon name="search" size={14} /></span>
        <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar tarefas" className="inp" aria-label="Buscar tarefas" style={{ width: 190, height: 32, paddingLeft: 28, paddingRight: q ? 26 : 30 }}
          onKeyDown={(e) => { if (e.key === "Escape") { setQ(""); e.target.blur(); } }} />
        {q ? <button type="button" onClick={() => setQ("")} aria-label="Limpar busca" style={{ position: "absolute", right: 6, top: 7, color: "var(--fg-4)" }}><Icon name="x" size={13} /></button>
          : <span className="kbd hide-mobile" style={{ position: "absolute", right: 7, top: 7 }}>/</span>}
      </div>
      <TBtn btnRef={refs.filter} on={nFilters > 0} count={nFilters} icon="filter" label="Filtrar" onClick={() => setOpen(open === "filter" ? null : "filter")} />
      <TBtn btnRef={refs.sort} on={sortOn} icon="sort" label="Ordenar" onClick={() => setOpen(open === "sort" ? null : "sort")} />
      <TBtn btnRef={refs.group} on={groupOn} icon="group" label="Agrupar" onClick={() => setOpen(open === "group" ? null : "group")} />
      <TBtn btnRef={refs.options} on={optionsOn} icon="settings" label="Opções" onClick={() => setOpen(open === "options" ? null : "options")} />
      {onNew}

      {open === "filter" && (
        <Popover anchor={refs.filter} onClose={close} width={360} title="Filtros" align="end">
          <Section title="Filtros rápidos">
            {[["open", "Por concluir"], ["done", "Concluídas"]].map(([k, l]) => <button key={k} type="button" style={chip(f.quick === k)} onClick={() => setF({ quick: f.quick === k ? "all" : k })}>{l}</button>)}
            <button type="button" style={chip(f.mine)} onClick={() => setF({ mine: !f.mine })}>Só as minhas</button>
            <button type="button" style={chip(f.dueThisWeek)} onClick={() => setF({ dueThisWeek: !f.dueThisWeek })}>Prazo esta semana</button>
            <button type="button" style={chip(f.dueNextWeek)} onClick={() => setF({ dueNextWeek: !f.dueNextWeek })}>Prazo próxima semana</button>
            <button type="button" style={chip(f.overdue)} onClick={() => setF({ overdue: !f.overdue })}>Atrasadas</button>
            <button type="button" style={chip(f.unassigned)} onClick={() => setF({ unassigned: !f.unassigned })}>Sem responsável</button>
          </Section>
          <Section title="Responsável">
            {users.map((u) => <button key={u.id} type="button" style={chip(f.assignees.includes(u.id))} onClick={() => setF({ assignees: toggleIn(f.assignees, u.id) })}><UserAvatarRing id={u.id} name={u.name} size={16} />{u.name}</button>)}
          </Section>
          <Section title="Prazo">
            {[["none", "Sem prazo"], ["overdue", "Atrasadas"], ["today", "Hoje"], ["week", "Esta semana"], ["nextweek", "Próxima semana"], ["range", "Período"]].map(([k, l]) => <button key={k} type="button" style={chip(f.due.preset === k)} onClick={() => setF({ due: { ...f.due, preset: f.due.preset === k ? "" : k } })}>{l}</button>)}
            {f.due.preset === "range" && (
              <span style={{ display: "inline-flex", gap: 6, alignItems: "center", width: "100%", marginTop: 4 }}>
                <input type="date" className="inp" value={f.due.since || ""} onChange={(e) => setF({ due: { ...f.due, since: e.target.value } })} style={{ flex: 1 }} />
                <span className="dim" style={{ fontSize: 12 }}>até</span>
                <input type="date" className="inp" value={f.due.until || ""} onChange={(e) => setF({ due: { ...f.due, until: e.target.value } })} style={{ flex: 1 }} />
              </span>
            )}
          </Section>
          <Section title="Prioridade">
            {PRIORITIES.map(([v, l]) => <button key={v || "none"} type="button" style={chip(f.priorities.includes(v))} onClick={() => setF({ priorities: toggleIn(f.priorities, v) })}>{v || l}</button>)}
          </Section>
          {labelOptions.length > 0 && (
            <Section title="Label">
              {labelOptions.map((l) => <button key={l} type="button" style={{ ...chip(f.labels.includes(l)), padding: "0 6px" }} onClick={() => setF({ labels: toggleIn(f.labels, l) })}><LabelChip label={l} color={labelColors.get(l) || ""} small /></button>)}
            </Section>
          )}
          <Section title="Criador">
            {users.map((u) => <button key={u.id} type="button" style={chip(f.creators.includes(u.id))} onClick={() => setF({ creators: toggleIn(f.creators, u.id) })}>{u.name}</button>)}
          </Section>
          <Section title="Coluna">
            {columns.map((c) => <button key={c.key} type="button" style={chip(f.columns.includes(c.key))} onClick={() => setF({ columns: toggleIn(f.columns, c.key) })}>{c.name}</button>)}
          </Section>
          <div style={{ display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid var(--line-1)", paddingTop: 8 }}>
            <span className="mono dim" style={{ fontSize: 11.5, flex: 1 }}>{nFilters ? `${nFilters} ${nFilters === 1 ? "filtro ativo" : "filtros ativos"}` : "sem filtro"}</span>
            <SecondaryButton size="sm" onClick={() => setPrefs((p) => ({ ...p, filters: { ...DEFAULT_FILTERS } }))} disabled={!nFilters}>Limpar</SecondaryButton>
          </div>
        </Popover>
      )}
      {open === "sort" && (
        <Popover anchor={refs.sort} onClose={close} width={260} title="Ordenar por" align="end">
          {SORTS.map(([k, l]) => <Radio key={k} on={(prefs.sort?.key || "manual") === k} onClick={() => setPrefs((p) => ({ ...p, sort: { key: k, dir: p.sort?.dir || "asc" } }))}>{l}</Radio>)}
          {sortOn && (
            <div style={{ display: "flex", gap: 6, marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--line-1)" }}>
              {[["asc", "Crescente"], ["desc", "Decrescente"]].map(([d, l]) => <button key={d} type="button" style={chip((prefs.sort?.dir || "asc") === d)} onClick={() => setPrefs((p) => ({ ...p, sort: { ...p.sort, dir: d } }))}>{l}</button>)}
            </div>
          )}
          {sortOn && <div className="dim" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.4 }}>Com ordenação ativa, arrastar dentro da coluna fica desativado. Mover entre colunas continua funcionando.</div>}
        </Popover>
      )}
      {open === "group" && (
        <Popover anchor={refs.group} onClose={close} width={240} title="Agrupar por" align="end">
          {GROUPS.map(([k, l]) => <Radio key={k} on={(prefs.group || "column") === k} onClick={() => setPrefs((p) => ({ ...p, group: k }))}>{l}</Radio>)}
          {groupOn && <div className="dim" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.4 }}>Arrastar entre grupos muda o campo da tarefa.</div>}
        </Popover>
      )}
      {open === "options" && (
        <Popover anchor={refs.options} onClose={close} width={280} title="Opções do quadro" align="end">
          <div className="kicker" style={{ margin: "2px 0 4px" }}>Campos no card</div>
          {[["assignee", "Responsável"], ["due", "Prazo"], ["priority", "Prioridade"], ["labels", "Labels"], ["subtasks", "Subtarefas"], ["comments", "Comentários"], ["attachments", "Anexos"], ["cover", "Capa"]].map(([k, l]) => (
            <Check key={k} on={fields[k] !== false} onClick={() => setPrefs((p) => ({ ...p, fields: { ...DEFAULT_FIELDS, ...(p.fields || {}), [k]: !(fields[k] !== false) } }))}>{l}</Check>
          ))}
          <div className="kicker" style={{ margin: "10px 0 4px" }}>Concluídas</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[["all", "Mostrar todas"], ["recent", "Últimos 14 dias"], ["hidden", "Ocultar"]].map(([k, l]) => <button key={k} type="button" style={chip((prefs.done || "all") === k)} onClick={() => setPrefs((p) => ({ ...p, done: k }))}>{l}</button>)}
          </div>
          <div className="kicker" style={{ margin: "10px 0 4px" }}>Quadro</div>
          <Check on={!!prefs.subtasksOnBoard} onClick={() => setPrefs((p) => ({ ...p, subtasksOnBoard: !p.subtasksOnBoard }))}>Subtarefas no quadro</Check>
          <Check on={!!prefs.hideEmpty} onClick={() => setPrefs((p) => ({ ...p, hideEmpty: !p.hideEmpty }))}>Ocultar colunas vazias</Check>
          <Check on={!!prefs.compact} onClick={() => setPrefs((p) => ({ ...p, compact: !p.compact }))}>Cards compactos</Check>
          <div style={{ display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid var(--line-1)", paddingTop: 8, marginTop: 8 }}>
            <button type="button" onClick={() => { close(); onHelp(); }} style={{ fontSize: 12, color: "var(--accent)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>Atalhos de teclado <span className="kbd">?</span></button>
            <button type="button" onClick={() => setPrefs((p) => ({ ...p, fields: { ...DEFAULT_FIELDS }, done: "all", subtasksOnBoard: false, hideEmpty: false, compact: false, collapsed: {}, sort: { key: "manual", dir: "asc" }, group: "column", filters: { ...DEFAULT_FILTERS } }))} style={{ marginLeft: "auto", fontSize: 12, color: "var(--fg-3)" }}>Restaurar padrão</button>
          </div>
        </Popover>
      )}
    </div>
  );
}

// Faixa dos filtros ativos (cada um com ✕) embaixo do cabeçalho.
export function ActiveFiltersStrip({ prefs, setPrefs, users, columns }) {
  const f = { ...DEFAULT_FILTERS, ...(prefs.filters || {}) };
  const setF = (patch) => setPrefs((p) => ({ ...p, filters: { ...DEFAULT_FILTERS, ...(p.filters || {}), ...patch } }));
  const name = (id) => users.find((u) => u.id === id)?.name || id;
  const items = [];
  if (f.quick === "open") items.push(["Por concluir", () => setF({ quick: "all" })]);
  if (f.quick === "done") items.push(["Concluídas", () => setF({ quick: "all" })]);
  if (f.mine) items.push(["Só as minhas", () => setF({ mine: false })]);
  if (f.dueThisWeek) items.push(["Prazo esta semana", () => setF({ dueThisWeek: false })]);
  if (f.dueNextWeek) items.push(["Prazo próxima semana", () => setF({ dueNextWeek: false })]);
  if (f.overdue) items.push(["Atrasadas", () => setF({ overdue: false })]);
  if (f.unassigned) items.push(["Sem responsável", () => setF({ unassigned: false })]);
  for (const u of f.assignees) items.push([`Responsável: ${name(u)}`, () => setF({ assignees: f.assignees.filter((x) => x !== u) })]);
  if (f.due.preset) items.push([`Prazo: ${({ none: "sem prazo", overdue: "atrasadas", today: "hoje", week: "esta semana", nextweek: "próxima semana", range: `${f.due.since || "…"} a ${f.due.until || "…"}` })[f.due.preset]}`, () => setF({ due: { preset: "", since: "", until: "" } })]);
  for (const p of f.priorities) items.push([`Prioridade: ${p || "sem"}`, () => setF({ priorities: f.priorities.filter((x) => x !== p) })]);
  for (const l of f.labels) items.push([`Label: ${l}`, () => setF({ labels: f.labels.filter((x) => x !== l) })]);
  for (const c of f.creators) items.push([`Criador: ${name(c)}`, () => setF({ creators: f.creators.filter((x) => x !== c) })]);
  for (const c of f.columns) items.push([`Coluna: ${columns.find((x) => x.key === c)?.name || c}`, () => setF({ columns: f.columns.filter((x) => x !== c) })]);
  if (prefs.sort?.key && prefs.sort.key !== "manual") items.push([`Ordenar: ${SORTS.find(([k]) => k === prefs.sort.key)?.[1] || prefs.sort.key} ${prefs.sort.dir === "desc" ? "↓" : "↑"}`, () => setPrefs((p) => ({ ...p, sort: { key: "manual", dir: "asc" } }))]);
  if (prefs.group && prefs.group !== "column") items.push([`Agrupar: ${GROUPS.find(([k]) => k === prefs.group)?.[1] || prefs.group}`, () => setPrefs((p) => ({ ...p, group: "column" }))]);
  if (!items.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", padding: "8px var(--pad-x) 0" }}>
      {items.map(([label, off], i) => (
        <span key={i} className="chip" style={{ background: "var(--accent-soft)", color: "var(--accent)", minHeight: 22, paddingRight: 4 }}>
          {label}<button type="button" onClick={off} aria-label={`Tirar ${label}`} style={{ color: "inherit", opacity: 0.8, display: "inline-flex" }}><Icon name="x" size={11} /></button>
        </span>
      ))}
      <button type="button" onClick={() => setPrefs((p) => ({ ...p, filters: { ...DEFAULT_FILTERS }, sort: { key: "manual", dir: "asc" }, group: "column" }))} style={{ fontSize: 12, color: "var(--fg-3)", fontWeight: 500, marginLeft: 4 }}>Limpar tudo</button>
    </div>
  );
}
