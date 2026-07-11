import React from "react";
// Workspace: O produto ativo do cockpit INTEIRO. Troca-se no seletor do pé da
// sidebar (chrome.jsx) e todas as telas seguem — nada de abas por tela (pedido
// do Leo, 11/07/2026). Vive fora do React porque o app remonta a árvore de
// telas a cada mudança de dados (key={dataVersion} no app.jsx); pub/sub via
// useSyncExternalStore mantém sidebar + tela em dia sem remount. localStorage
// preserva a escolha no F5.

const LS_KEY = "cockpit_active_saas";
let current = null;
try { current = localStorage.getItem(LS_KEY); } catch { /* storage indisponível */ }

const listeners = new Set();
let lastPin = null;

export function setActiveSaas(id) {
  current = id;
  try { localStorage.setItem(LS_KEY, id); } catch { /* ignore */ }
  listeners.forEach((fn) => fn());
}

// Pin one-shot vindo de navegação (ex.: "ver no pipeline" com params.saas).
// params persiste entre remounts do app — sem o dedupe, todo remount
// re-aplicaria o produto da última navegação por cima da escolha do usuário.
export function pinActiveSaas(id) {
  if (id && id !== lastPin) {
    lastPin = id;
    setActiveSaas(id);
  }
}

const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const snapshot = () => current;

export function useActiveSaas() {
  const active = React.useSyncExternalStore(subscribe, snapshot);
  const { SAAS } = window.SEED;
  // id salvo pode não existir mais (produto removido) — cai no 1º do portfólio.
  const product = SAAS.find((s) => s.id === active) || SAAS[0] || null;
  return [product, setActiveSaas];
}
