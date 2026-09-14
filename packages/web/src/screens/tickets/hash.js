import React from "react";
// Deep link do ticket: "#tickets/<id>" abre o painel (é o destino do sino);
// Voltar do navegador fecha. app.jsx só olha o 1º segmento, a tela não remonta.
const read = () => (typeof location === "undefined" ? "" : location.hash).replace(/^#\/?/, "");
export function parseTicketHash() {
  const [screen, rest] = read().split("/");
  if (screen !== "tickets" || !rest) return null;
  try { return decodeURIComponent(rest.split(/[?#]/)[0]) || null; } catch { return null; }
}
export function openTicketHash(id) {
  if (typeof location === "undefined") return;
  const target = `#tickets/${encodeURIComponent(id)}`;
  if (location.hash !== target) location.hash = target;
}
export function clearTicketHash() {
  if (typeof location === "undefined" || !parseTicketHash()) return;
  try { history.replaceState(null, "", "#tickets"); } catch { location.hash = "tickets"; }
}
export function useTicketHash(onChange) {
  const ref = React.useRef(onChange);
  ref.current = onChange;
  React.useEffect(() => {
    const h = () => ref.current(parseTicketHash());
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
}
