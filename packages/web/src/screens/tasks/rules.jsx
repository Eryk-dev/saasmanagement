import React from "react";
import { PrimaryButton, SecondaryButton, useEsc } from "../../atoms.jsx";
import { UserAvatarRing } from "../../components/user-picker.jsx";
import { PRIORITIES } from "../../lib/tasks.js";
import { Icon } from "./icons.jsx";

const { useState } = React;

// Regras de uma coluna: o que acontece com o card AO ENTRAR nela (o servidor
// aplica em tasks-core.js): concluir/reabrir, somar responsável, fixar prioridade.
export function ColumnRulesModal({ col, users, isDoneCol, onSave, onClose }) {
  useEsc(onClose);
  const cur = col.rules || {};
  const [complete, setComplete] = useState(cur.complete === true ? "complete" : cur.complete === false ? "reopen" : "");
  const [assign, setAssign] = useState(cur.assign || []);
  const [priority, setPriority] = useState(cur.priority || "");
  const [busy, setBusy] = useState(false);
  const toggle = (id) => setAssign((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));
  const save = async () => {
    setBusy(true);
    const rules = {};
    if (complete === "complete") rules.complete = true;
    if (complete === "reopen") rules.complete = false;
    if (assign.length) rules.assign = assign;
    if (priority) rules.priority = priority;
    await onSave(Object.keys(rules).length ? rules : null);
    setBusy(false);
    onClose();
  };
  const Radio = ({ v, children }) => (
    <button type="button" onClick={() => setComplete(v)} className="tk-menu-item" style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 8px", borderRadius: 6, textAlign: "left", fontSize: 13, color: "var(--fg-1)" }}>
      <span style={{ width: 14, height: 14, borderRadius: 999, border: `1.5px solid ${complete === v ? "var(--accent)" : "var(--line-strong)"}`, background: complete === v ? "var(--accent)" : "transparent", boxShadow: complete === v ? "inset 0 0 0 3px var(--bg-1)" : "none", flexShrink: 0 }} />{children}
    </button>
  );
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 80, background: "oklch(0 0 0 / 0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
      <div role="dialog" aria-label={`Regras da coluna ${col.name}`} data-tk-layer="1" onClick={(e) => e.stopPropagation()} style={{ width: "min(520px, 100%)", maxHeight: "88vh", overflowY: "auto", background: "var(--bg-1)", border: "1px solid var(--line-2)", borderRadius: "var(--r-3)", boxShadow: "var(--shadow-pop)", padding: "18px 20px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="play" size={16} style={{ color: "var(--accent)" }} />
          <span className="card-title">Regras da coluna {col.name}</span>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ marginLeft: "auto", width: 32, height: 32, borderRadius: "var(--r-2)", color: "var(--fg-3)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon name="x" size={16} /></button>
        </div>
        <div className="dim" style={{ fontSize: 12.5, lineHeight: 1.45 }}>Quando um card entrar nesta coluna (arrastado, movido pelo menu ou pelo painel):</div>
        {isDoneCol && <div style={{ fontSize: 12.5, padding: "8px 10px", borderRadius: "var(--r-2)", background: "var(--pos-soft)", color: "var(--pos)" }}>Esta é a coluna de concluído do quadro: entrar aqui já marca como concluída e sair reabre.</div>}
        <div>
          <div className="kicker" style={{ marginBottom: 4 }}>Conclusão</div>
          <Radio v="">Não mexer</Radio>
          <Radio v="complete">Marcar como concluída</Radio>
          <Radio v="reopen">Reabrir (tirar a conclusão)</Radio>
        </div>
        <div>
          <div className="kicker" style={{ marginBottom: 6 }}>Somar responsável</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {users.map((u) => {
              const on = assign.includes(u.id);
              return <button key={u.id} type="button" onClick={() => toggle(u.id)} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 10px 0 5px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, border: `1px solid ${on ? "var(--accent-line)" : "var(--line-2)"}`, background: on ? "var(--accent-soft)" : "var(--bg-1)", color: on ? "var(--accent)" : "var(--fg-2)" }}><UserAvatarRing id={u.id} name={u.name} size={18} />{u.name}</button>;
            })}
          </div>
        </div>
        <div>
          <div className="kicker" style={{ marginBottom: 6 }}>Fixar prioridade</div>
          <select className="inp" value={priority} onChange={(e) => setPriority(e.target.value)} style={{ height: 30, fontSize: 12.5 }}>
            <option value="">Não mexer</option>
            {PRIORITIES.filter(([v]) => v).map(([v]) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", borderTop: "1px solid var(--line-1)", paddingTop: 12 }}>
          <SecondaryButton onClick={onClose}>Cancelar</SecondaryButton>
          <PrimaryButton onClick={save} disabled={busy}>{busy ? "Salvando…" : "Salvar regras"}</PrimaryButton>
        </div>
      </div>
    </div>
  );
}
export const rulesSummary = (rules, users = new Map(), doneCol = false) => {
  const out = [];
  if (doneCol) out.push("conclui ao entrar");
  if (rules?.complete === true) out.push("conclui ao entrar");
  if (rules?.complete === false) out.push("reabre ao entrar");
  if (rules?.assign?.length) out.push(`atribui a ${rules.assign.map((id) => users.get(id)?.name || id).join(", ")}`);
  if (rules?.priority) out.push(`prioridade ${rules.priority}`);
  return [...new Set(out)].join(" · ");
};
