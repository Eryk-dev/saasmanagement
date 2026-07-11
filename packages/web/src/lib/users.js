// Usuários do time no SPA. `window.SEED.USERS` é carregado junto do bootstrap
// (data.jsx) a partir de GET /api/auth/users — inclui `roles` (sdr/closer/
// integrator), as etiquetas que alimentam os pickers do pipeline. Substitui os
// arrays hardcoded (CLOSERS/INTEGRATORS) do pipeline.jsx.

import { getActiveSaasId } from "./workspace.js";

const usersList = () => (Array.isArray(window.SEED?.USERS) ? window.SEED.USERS : []);

// Escopo por produto: usuário com `saas` preenchido só aparece nos pickers do
// workspace daquele produto (ex.: Ana atende só a UniqueKids); vazio = time de
// todos os produtos. displayName/userById seguem globais — registro antigo com
// responsável de outro produto continua mostrando o nome.
const inWorkspace = (u) => !u.saas || u.saas === getActiveSaasId();

// Fallback pré-migração (USERS vazio ou ninguém com a role): o time que era
// hardcoded no board — some sozinho quando as roles chegarem do servidor.
const LEGACY = {
  closer: [{ id: "leonardo", name: "Leonardo" }, { id: "jonathan", name: "Jonathan" }],
  integrator: [{ id: "eryk", name: "Eryk" }],
  sdr: [{ id: "leonardo", name: "Leonardo" }],
};

export function usersByRole(role) {
  const tagged = usersList().filter((u) => (u.roles || []).includes(role));
  if (tagged.length) return tagged.filter(inWorkspace);
  return LEGACY[role] || [];
}

export function allUsers() {
  return usersList();
}

export function userById(id) {
  if (!id) return null;
  return usersList().find((u) => u.id === id) || null;
}

// Nome exibível de um id de responsável: usuário do time → people (legado) → o
// próprio id. Cobre leads antigos com owner de PEOPLE ou código livre.
export function displayName(id) {
  if (!id) return "";
  const u = userById(id);
  if (u) return u.name || u.id;
  const p = window.SEED?.PEOPLE?.[id];
  if (p) return p.name || id;
  return String(id);
}

// Matiz determinística por id — MESMO hash do Avatar (atoms.jsx), pra cor do
// avatar e do chip/agenda baterem.
export function userTone(id) {
  let h = 0;
  for (const c of String(id || "?")) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function currentUser() {
  try { return JSON.parse(localStorage.getItem("cockpit_user") || "null"); } catch { return null; }
}
