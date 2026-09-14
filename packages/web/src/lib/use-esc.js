import React from "react";

// Todo modal/painel fecha no Esc: useEsc(onClose) dentro do componente do
// popup. Pilha por ordem de MONTAGEM: com modal sobre drawer, o Esc fecha só
// o de cima; o próximo Esc fecha o de baixo. Passe null pra desativar
// temporariamente (ex.: enquanto salva).
//
// Mora em lib/ (14/09) porque atoms.jsx e components/popover.jsx precisam dele
// dos dois lados: o MoreMenu do atoms passou a abrir pelo Popover, e o Popover
// já fechava no Esc. Import circular entre os dois resolveria por hoisting,
// mas é o tipo de coisa que quebra em silêncio quando alguém troca a ordem.
const escStack = [];

export function useEsc(onClose) {
  const ref = React.useRef(onClose);
  ref.current = onClose;
  React.useEffect(() => {
    const entry = {};
    escStack.push(entry);
    function onKey(e) {
      if (e.key !== "Escape") return;
      if (escStack[escStack.length - 1] !== entry || !ref.current) return;
      // Esc dentro de campo primeiro tira o foco; o próximo Esc fecha.
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) { t.blur(); return; }
      ref.current();
    }
    window.addEventListener("keydown", onKey);
    return () => { escStack.splice(escStack.indexOf(entry), 1); window.removeEventListener("keydown", onKey); };
  }, []);
}
