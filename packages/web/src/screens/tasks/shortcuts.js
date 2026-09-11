import React from "react";
// Atalhos do quadro (estilo Asana). Um listener na janela enquanto a tela está
// montada; ignora campos de texto, menus/popovers abertos e camadas por cima.
// Acorde "Tab + tecla" (1s) só com um card focado, pra não roubar o Tab da
// navegação por teclado do resto da página.
const { useEffect, useRef } = React;

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");
export const MOD = isMac ? "⌘" : "Ctrl";
export const SHORTCUTS = [
  { group: "Navegação", keys: ["↑", "↓", "←", "→"], label: "Andar entre os cards" },
  { group: "Navegação", keys: ["Enter"], label: "Abrir o card focado" },
  { group: "Navegação", keys: ["Esc"], label: "Fechar menu, painel, seleção" },
  { group: "Navegação", keys: ["/"], label: "Buscar" },
  { group: "Navegação", keys: ["?"], label: "Esta ajuda" },
  { group: "Tarefa", keys: ["n"], label: "Nova tarefa no topo da coluna" },
  { group: "Tarefa", keys: [`${MOD}+Enter`], label: "Concluir / reabrir" },
  { group: "Tarefa", keys: [`${MOD}+Z`], label: "Desfazer a última ação" },
  { group: "Tarefa", keys: ["Tab", "m"], label: "Atribuir a mim" },
  { group: "Tarefa", keys: ["Tab", "a"], label: "Escolher responsável" },
  { group: "Tarefa", keys: ["Tab", "d"], label: "Definir prazo" },
  { group: "Tarefa", keys: ["Tab", "c"], label: "Comentar" },
  { group: "Tarefa", keys: ["Tab", "q"], label: "Nova tarefa" },
  { group: "Tarefa", keys: ["Delete"], label: "Excluir (pede confirmação)" },
  { group: "Tarefa", keys: ["Shift+F10"], label: "Menu de ações" },
  { group: "Mover", keys: [`${MOD}+Shift+←`, `${MOD}+Shift+→`], label: "Mover pra coluna ao lado" },
  { group: "Mover", keys: [`${MOD}+Shift+↑`, `${MOD}+Shift+↓`], label: "Subir / descer na coluna" },
  { group: "Seleção", keys: ["Shift+clique"], label: "Selecionar um intervalo" },
  { group: "Seleção", keys: [`${MOD}+clique`], label: "Somar à seleção" },
  { group: "Seleção", keys: ["Tab", "x"], label: "Modo seleção (clique seleciona)" },
  { group: "Quadro", keys: ["Tab", "n"], label: "Nova coluna" },
];

const inField = (el) => {
  if (!el) return false;
  const tag = (el.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
};
const layerOpen = () => !!document.querySelector("[role=menu], [role=dialog][data-tk-layer]:not([data-panel-root]), [role=toolbar][data-tk-layer] [role=dialog]");
// Alguma camada de outro lugar do app por cima do quadro (portão do treino,
// alerta de WhatsApp, busca ⌘K, modal de exclusão)?
const coveredBy = (root) => {
  if (!root) return false;
  const r = root.getBoundingClientRect();
  const el = document.elementFromPoint(r.left + r.width / 2, Math.min(window.innerHeight - 4, r.top + Math.min(r.height / 2, 200)));
  return !!el && !root.contains(el) && !el.closest("[data-tk-layer]");
};

export function useShortcuts({ rootRef, enabled = true, get, actions }) {
  const getRef = useRef(get); getRef.current = get;
  const actRef = useRef(actions); actRef.current = actions;
  const chord = useRef(0);
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (e) => {
      if (e.defaultPrevented) return;
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) return; // busca global
      const s = getRef.current();
      const a = actRef.current;
      if (inField(e.target) || inField(document.activeElement)) return;
      if (layerOpen() || coveredBy(rootRef.current)) return;
      const mod = e.metaKey || e.ctrlKey;
      const focused = s.focusId;
      // acorde Tab + tecla (só com card focado)
      if (e.key === "Tab" && !mod && !e.shiftKey && focused) { e.preventDefault(); chord.current = Date.now(); a.hint("Tab…"); return; }
      if (chord.current && Date.now() - chord.current < 1000 && !mod) {
        chord.current = 0; a.hint("");
        const k = e.key.toLowerCase();
        const map = { q: () => a.compose(focused), m: () => a.assignMe(focused), a: () => a.pickAssignee(focused), d: () => a.pickDue(focused), c: () => a.openComment(focused), n: () => a.newColumn(), x: () => a.toggleSelectMode() };
        if (map[k]) { e.preventDefault(); map[k](); return; }
      }
      if (mod && !e.shiftKey && (e.key === "z" || e.key === "Z")) { e.preventDefault(); a.undo(); return; }
      if (mod && e.key === "Enter") { e.preventDefault(); a.completeFocused(); return; }
      if (mod && e.shiftKey && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) { e.preventDefault(); a.nudge(e.key); return; }
      if (mod) return;
      switch (e.key) {
        case "ArrowUp": case "ArrowDown": case "ArrowLeft": case "ArrowRight": e.preventDefault(); a.moveFocus(e.key); return;
        case "Enter": if (focused) { e.preventDefault(); a.open(focused); } return;
        case "n": case "N": if (!e.shiftKey) { e.preventDefault(); a.compose(focused); } return;
        case "/": e.preventDefault(); a.search(); return;
        case "?": e.preventDefault(); a.help(); return;
        case "Delete": case "Backspace": if (focused || s.selectionSize) { e.preventDefault(); a.remove(); } return;
        case "F10": if (e.shiftKey && focused) { e.preventDefault(); a.menu(focused); } return;
        default: return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, rootRef]);
}
