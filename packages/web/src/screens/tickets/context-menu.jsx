import React from "react";
import { TICKET_STATUSES, TICKET_PRIORITIES, agentHandles, linearKey, categoryColor } from "../../lib/tickets.js";
import { LabelChip } from "../../components/label-chip.jsx";
import { Icon } from "../tasks/icons.jsx";

// Menu do clique direito (toque longo no celular) no card e na linha da fila,
// como o das Tarefas. Abrir não entra: o clique esquerdo já abre. Cada item
// chama uma ação da tela (mutação otimista com rollback), nada fala com a API
// daqui.

const dot = (tone) => <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 999, background: tone }} />;

export function ticketMenuItems(t, { me, agents, saasId, categories, canDelete, patch, copy, remove }) {
  const assignable = (agents || []).filter((a) => agentHandles(a, saasId));
  const cats = [...new Set([...(categories || []), ...(t.category ? [t.category] : [])])];
  const handlesMe = !!me && assignable.some((a) => a.id === me);
  return [
    {
      label: "Status", icon: <Icon name="circle" size={14} />, children: TICKET_STATUSES.map((s) => ({
        label: s.label, icon: dot(s.tone), checked: t.status === s.key,
        onClick: () => patch(t.id, { status: s.key }, `#${t.number} em ${s.label}`),
      })),
    },
    {
      label: "Prioridade", icon: <Icon name="flag" size={14} />, children: TICKET_PRIORITIES.map((p) => ({
        label: p.label, icon: dot(p.tone), checked: t.priority === p.key,
        onClick: () => patch(t.id, { priority: p.key }, `#${t.number} com prioridade ${p.label.toLowerCase()}`),
      })),
    },
    {
      label: "Responsável", icon: <Icon name="user" size={14} />, children: [
        ...(handlesMe && t.assignee !== me ? [{ label: "Assumir", onClick: () => patch(t.id, { assignee: me }, `#${t.number} com você`) }, { sep: true }] : []),
        ...assignable.map((a) => ({ label: a.name || a.id, checked: t.assignee === a.id, onClick: () => patch(t.id, { assignee: a.id }, `#${t.number} com ${a.name || a.id}`) })),
        { label: "Sem responsável", checked: !t.assignee, onClick: () => patch(t.id, { assignee: "" }, `#${t.number} sem responsável`) },
      ],
    },
    {
      label: "Categoria", icon: <Icon name="tag" size={14} />, children: [
        // Mesmo badge (e cor) da categoria no card.
        ...cats.map((c) => ({ label: c, content: <LabelChip label={c} color={categoryColor(c)} small />, checked: t.category === c, onClick: () => patch(t.id, { category: c }, `#${t.number} em ${c}`) })),
        { label: "Sem categoria", checked: !t.category, onClick: () => patch(t.id, { category: "" }, `#${t.number} sem categoria`) },
      ],
    },
    { sep: true },
    { label: "Copiar link do ticket", icon: <Icon name="link" size={14} />, onClick: () => copy(`${location.origin}${location.pathname}#tickets/${encodeURIComponent(t.id)}`, "Link copiado") },
    { label: "Copiar número", icon: <Icon name="copy" size={14} />, onClick: () => copy(`#${t.number}`, "Número copiado") },
    linearKey(t) && t.linear?.url ? { label: `Abrir ${linearKey(t)} no Linear`, icon: <Icon name="expand" size={14} />, onClick: () => window.open(t.linear.url, "_blank", "noopener") } : null,
    ...(canDelete ? [{ sep: true }, { label: "Excluir", icon: <Icon name="trash" size={14} />, danger: true, onClick: () => remove(t) }] : []),
  ];
}
