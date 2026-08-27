// Usuários do time no SPA. `window.SEED.USERS` é carregado junto do bootstrap
// (data.jsx) a partir de GET /api/auth/users — inclui `roles` (sdr/closer/
// integrator), as etiquetas que alimentam os pickers do pipeline. Substitui os
// arrays hardcoded (CLOSERS/INTEGRATORS) do pipeline.jsx.

import { getActiveSaasId } from "./workspace.js";
import { assetUrl } from "./api.js";

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

// Foto de perfil do usuário (registro FRESCO do bootstrap, não o localStorage do
// login): "" quando não tem — quem chama cai nas iniciais.
export function userPhoto(id) {
  if (!id) return "";
  return assetUrl(userById(id)?.photo || "");
}

// Cor de cada pessoa na agenda/pipeline. O matiz por hash do id sorteava
// famílias iguais — José, Vitor e Leonardo caíam todos no verde-oliva (Leo,
// 06/08 e 23/08). O time principal tem cor CRAVADA pelo Leo (FIXED_BY_FIRSTNAME
// abaixo); o resto pega um SLOT livre de uma paleta curada de cores fortes e
// bem separadas, o mais perto do tom de hash. Duas pessoas nunca dividem a
// mesma família. A ordem do roster (SEED.USERS) é estável, então a cor não
// muda entre sessões nem entre workspaces.
const PERSON_COLORS = [
  { name: "roxo", h: 295, l: 0.5, c: 0.2 },
  { name: "vermelho", h: 25, l: 0.54, c: 0.2 },
  { name: "verde", h: 150, l: 0.5, c: 0.15 },
  { name: "azul", h: 250, l: 0.5, c: 0.17 },
  { name: "laranja", h: 55, l: 0.63, c: 0.17 },
  { name: "amarelo", h: 90, l: 0.72, c: 0.15 },
  { name: "magenta", h: 345, l: 0.55, c: 0.19 },
  { name: "petroleo", h: 200, l: 0.55, c: 0.12 },
  { name: "uva", h: 320, l: 0.45, c: 0.14 },
  { name: "marrom", h: 65, l: 0.45, c: 0.08 },
];
// Cores CRAVADAS pelo Leo (23/08), pelo primeiro nome — vale pra id novo da
// mesma pessoa e pra gente nova que ele já batizou (Bruna). Quem não está aqui
// pega um slot LIVRE da paleta (as cravadas ficam fora do sorteio).
const FIXED_BY_FIRSTNAME = {
  jonathan: "roxo", jonatham: "roxo",
  leonardo: "azul",
  vitor: "amarelo", victor: "amarelo",
  jose: "laranja",
  bruna: "vermelho",
};
const firstNameOf = (u) => String(u?.name || u?.id || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().trim().split(/\s+/)[0] || "";
const hashHue = (id) => {
  let h = 0;
  for (const c of String(id || "?")) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
};
export function userTone(id) {
  return hashHue(id);
}
// Slots resolvidos pro roster atual; refeito quando a lista de ids muda.
// Duas passadas: primeiro as cores cravadas por nome, depois o resto no slot
// livre mais perto do tom de hash — ninguém divide família com ninguém.
let toneCache = { key: "", map: new Map() };
function personColorSlot(id) {
  const users = usersList();
  const key = users.map((u) => u.id).join("|");
  if (toneCache.key !== key) {
    const map = new Map();
    let taken = new Set();
    for (const u of users) {
      const fixed = FIXED_BY_FIRSTNAME[firstNameOf(u)];
      if (!fixed) continue;
      const slot = PERSON_COLORS.findIndex((p) => p.name === fixed);
      map.set(u.id, slot);
      taken.add(slot);
    }
    for (const u of users) {
      if (map.has(u.id)) continue;
      const want = hashHue(u.id);
      const dist = (h) => Math.min(Math.abs(h - want), 360 - Math.abs(h - want));
      const nearest = PERSON_COLORS.map((p, i) => i).sort((a, b) => dist(PERSON_COLORS[a].h) - dist(PERSON_COLORS[b].h));
      const slot = nearest.find((i) => !taken.has(i)) ?? nearest[0];
      taken.add(slot);
      if (taken.size === PERSON_COLORS.length) taken = new Set(); // time maior que a paleta: recomeça
      map.set(u.id, slot);
    }
    toneCache = { key, map };
  }
  return toneCache.map.get(String(id || ""));
}
// Cor pronta (string oklch) da pessoa — o que as telas devem usar. Id fora do
// roster (owner legado de PEOPLE) cai no desenho antigo pelo hash.
export function userColor(id) {
  if (!id) return "";
  const slot = personColorSlot(id);
  const p = slot != null ? PERSON_COLORS[slot] : null;
  return p ? `oklch(${p.l} ${p.c} ${p.h})` : `oklch(0.55 0.13 ${userTone(id)})`;
}

export function currentUser() {
  try { return JSON.parse(localStorage.getItem("cockpit_user") || "null"); } catch { return null; }
}

// Dono da operação (etiqueta "admin" em Ajustes → Equipe). Lê o registro FRESCO
// do bootstrap quando existe: marcar a caixinha vale no próximo refresh, sem
// re-login (o localStorage guarda o usuário do momento do login).
export function isAdminUser(user = currentUser()) {
  const fresh = user?.id ? userById(user.id) : null;
  return ((fresh || user)?.roles || []).includes("admin");
}

// ── Telas permitidas (user.screens) ─────────────────────────────────────────
// null = sem restrição (lista vazia/ausente ou acesso por API key). Prefere o
// registro fresco do bootstrap (SEED.USERS): mudança de permissão em Ajustes →
// Equipe vale no próximo refresh, sem re-login. A API tem o guard de verdade
// (screens.js do servidor) — aqui é só a montagem do menu/rota.
export function allowedScreens() {
  const me = currentUser();
  if (!me) return null; // acesso por key: sem restrição
  const fresh = userById(me.id) || me;
  const s = Array.isArray(fresh.screens) ? fresh.screens : [];
  return s.length ? new Set(s) : null;
}

// Piso por PAPEL: espelho do ROLE_SCREENS do servidor (screens.js). Closer
// sempre enxerga o pipeline e a tela de Links de pagamento, mesmo com a lista
// de telas restrita — gerar link é o meio de vida dele, não pode depender de
// alguém lembrar de marcar a caixinha em Ajustes → Equipe. Quem manda de
// verdade é o guard da API; aqui é só o menu e a rota não mentirem pra ele.
const ROLE_SCREENS = {
  closer: ["pipeline", "offers"],
};

export function roleScreens(user = currentUser()) {
  const fresh = user?.id ? (userById(user.id) || user) : user;
  const out = new Set();
  for (const role of (fresh?.roles || [])) {
    for (const screen of ROLE_SCREENS[role] || []) out.add(screen);
  }
  return out;
}

// Telas que TODA sessão alcança (espelho do UNIVERSAL_SCREENS do servidor).
// Links de pagamento virou ferramenta de todo mundo em 27/08/2026: gerar
// cobrança tinha travado duas pessoas por falta de caixinha marcada, e não é
// dado sensível (a base de clientes, essa sim, continua na tela Clientes).
const UNIVERSAL_SCREENS = new Set(["offers"]);

export const isUniversalScreen = (id) => UNIVERSAL_SCREENS.has(id);

export function canSeeScreen(id) {
  if (UNIVERSAL_SCREENS.has(id)) return true;
  const a = allowedScreens();
  if (!a) return true;
  return a.has(id) || roleScreens().has(id);
}

// Tela concedida EXPLICITAMENTE (consta na lista de telas, que não está vazia).
// É o que destrava as telas adminOnly pra quem não é admin: a lista em branco
// ("vê tudo") não basta pra dado sensível, mas a gestão marcar a tela na mão em
// Ajustes → Equipe vale como liberação de leitura. O guard da API (screens.js
// do servidor) aplica a mesma regra.
export function hasExplicitScreen(id) {
  const a = allowedScreens();
  return !!a && a.has(id);
}
