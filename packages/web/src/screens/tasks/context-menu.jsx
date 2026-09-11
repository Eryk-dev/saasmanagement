import { quickDates } from "../../components/date-quick.jsx";
import { fmtDue } from "../../lib/tasks.js";
// Itens do menu da tarefa: o mesmo conjunto no "⋯" do card, no botão direito,
// no toque longo e no "⋯" do painel. `ctx.actions` são as funções da tela.
export function taskMenuItems(task, { columns, done, me, actions, inPanel = false }) {
  const a = actions;
  const moveTo = columns.filter((c) => c.key !== task.column).map((c) => ({ label: c.name, onClick: () => a.move(task.id, c.key) }));
  const due = [
    ...quickDates().map((q) => ({ label: `${q.label} (${fmtDue(q.value)})`, checked: task.dueDate === q.value, onClick: () => a.setDue(task.id, q.value) })),
    { label: "Escolher…", onClick: () => a.pickDue(task.id) },
    ...(task.dueDate ? [{ sep: true }, { label: "Limpar prazo", onClick: () => a.setDue(task.id, "") }] : []),
  ];
  const items = [
    { label: done ? "Reabrir tarefa" : "Marcar como concluída", icon: "✓", kbd: "⌘↵", onClick: () => a.complete(task.id, !done) },
    !inPanel && { label: "Abrir detalhes", kbd: "↵", onClick: () => a.open(task.id) },
    { label: "Renomear", onClick: () => a.rename(task.id) },
    { sep: true },
    { label: "Mover para", children: moveTo, disabled: !moveTo.length },
    { label: "Definir prazo", children: due },
    { label: me && !(task.assignees || []).includes(me) ? "Atribuir a mim" : "Tirar de mim", disabled: !me, onClick: () => a.assignMe(task.id) },
    { sep: true },
    { label: "Duplicar", onClick: () => a.duplicate(task.id) },
    { label: "Criar tarefa de acompanhamento", onClick: () => a.followUp(task.id) },
    { label: "Adicionar subtarefa", onClick: () => a.subtask(task.id) },
    { label: "Copiar link", onClick: () => a.copyLink(task.id) },
    { sep: true },
    { label: "Excluir", danger: true, onClick: () => a.remove(task.id) },
  ];
  return items.filter(Boolean);
}
