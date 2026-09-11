import React from "react";
// Deep link da tarefa: "#tasks/<id>" abre o painel; Voltar do navegador fecha.
// A tela é a mesma (app.jsx só olha o 1º segmento), então o SPA não remonta.
const read = () => (typeof location === "undefined" ? "" : location.hash).replace(/^#\/?/, "");
export function parseTaskHash() {
  const [screen, rest] = read().split("/");
  if (screen !== "tasks" || !rest) return null;
  try { return decodeURIComponent(rest.split(/[?#]/)[0]) || null; } catch { return null; }
}
export function openTaskHash(id) {
  if (typeof location === "undefined") return;
  const target = `#tasks/${encodeURIComponent(id)}`;
  if (location.hash !== target) location.hash = target;
}
export function clearTaskHash() {
  if (typeof location === "undefined" || !parseTaskHash()) return;
  try { history.replaceState(null, "", "#tasks"); } catch { location.hash = "tasks"; }
}
export function useTaskHash(onChange) {
  const ref = React.useRef(onChange);
  ref.current = onChange;
  React.useEffect(() => {
    const h = () => ref.current(parseTaskHash());
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
}
