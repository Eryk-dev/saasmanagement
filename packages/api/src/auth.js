// Sistema simples de usuários (time interno, um tenant — decisão §3.9: todos
// iguais na v1, roles depois). Senha com scrypt (node:crypto, sem deps), NUNCA
// em plaintext. Sessão = token opaco na collection `sessions` (TTL 7d) que entra
// no MESMO header da key (`x-api-key`/Bearer) — o SPA loga e segue usando o
// pipeline existente; a COCKPIT_API_KEY continua valendo (MCP/integraçōes).
// `users`/`sessions` ficam FORA do CRUD genérico (hash/token não vazam).

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { sanitizeScreens } from "./screens.js";
import { sanitizeSupportSaas } from "./support-scope.js";
import { looksLikeJwt } from "./auth-jwt.js";
import { makeIdentityAdmin, staffRolesFor } from "./identity-admin.js";
import { NOT_CONFIGURED, UPSTREAM_FAILED } from "./http-status.js";

const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(String(password), salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored || "").split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const candidate = scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// Senha nova (criação, reset e troca) precisa de pelo menos 8 caracteres.
export const MIN_PASSWORD_LENGTH = 8;
const weakPassword = (p) => !p || String(p).length < MIN_PASSWORD_LENGTH;
const WEAK_PASSWORD_ERROR = `senha precisa de ${MIN_PASSWORD_LENGTH}+ caracteres`;

// Primeiro admin de um banco vazio (dev/local): vem do env, nunca de senha fixa
// no código. Só age com `users` vazia, então restart nunca recria usuário
// apagado nem reseta senha; sem as duas variáveis, não cria ninguém.
export async function ensureBootstrapAdmin(repo, env = process.env) {
  const id = String(env.BOOTSTRAP_ADMIN_USER || "").trim().toLowerCase();
  const password = String(env.BOOTSTRAP_ADMIN_PASSWORD || "");
  if (!id || weakPassword(password)) return 0;
  if ((await repo.list("users")).length) return 0;
  await repo.create("users", {
    id, name: id, role: "admin", roles: ["admin"],
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
  });
  return 1;
}

// `role` = auth (todos "admin" na v1). `roles` = etiquetas de capacidade do
// funil (quem aparece nos pickers de SDR/closer/integrador) — NÃO é ACL.
// "admin" é a etiqueta de DONO da operação (Leo, Eryk, Jonathan): não é vaga de
// funil (não entra em picker de SDR/closer) e isenta do treinamento obrigatório
// — quem cuida do negócio estuda se quiser, não porque a régua cobra.
// "support" = atendente do Suporte: recebe ticket novo sem responsável dos
// produtos em `supportSaas` (support-scope.js — esse sim é ACL).
export const ROLE_TAGS = ["sdr", "closer", "integrator", "social", "admin", "support"];
const sanitizeRoles = (x) => (Array.isArray(x) ? x.filter((r) => ROLE_TAGS.includes(r)) : []);
// `saas` = escopo de produto: vazio = time de TODOS os produtos; preenchido =
// só aparece nos pickers do workspace daquele produto (ex.: Ana atende só a
// UniqueKids). Também não é ACL — o login continua global.
const sanitizeSaas = (x) => String(x || "").trim().toLowerCase();

const publicUser = (u) => ({
  id: u.id, name: u.name, role: u.role || "admin",
  roles: Array.isArray(u.roles) ? u.roles : [],
  saas: u.saas || "",
  // Nível do plano de remuneração (1 jr · 2 pl · 3 sn) — régua das metas do card.
  compLevel: (() => { const n = Math.floor(Number(u.compLevel)); return n >= 1 && n <= 3 ? n : 1; })(),
  // Desde quando está no nível: é o que o critério de promoção usa como marco
  // zero da contagem de meses.
  compLevelHistory: Array.isArray(u.compLevelHistory) ? u.compLevelHistory : [],
  // Foto de perfil: URL de /public/users/:id com ?v= do último upload (a tag
  // <img> não manda header, então a rota é aberta e o ?v= fura o cache). "" =
  // sem foto, o SPA cai nas iniciais.
  photo: u.photo || "",
  // Telas permitidas (screens.js): [] = todas. O SPA usa pra montar o menu e o
  // guard da API usa pra fechar as rotas correspondentes.
  screens: Array.isArray(u.screens) ? u.screens : [],
  // Produtos cujos tickets de suporte a pessoa atende (support-scope.js). Aqui
  // é ACL: lista vazia = nenhum ticket (admin vê todos).
  supportSaas: sanitizeSupportSaas(u.supportSaas),
  // Status da conta Google PESSOAL (só flags — o refresh token NUNCA sai daqui).
  googleConnected: !!u.google?.refreshToken,
  googleAccount: u.google?.account || "",
  // Conta na identidade central (auth.users.id do lever-identity). "" = ainda
  // não ligada: o login pelo GoTrue não entra até um admin ligar.
  authUserId: u.authUserId || "",
  // E-mail da conta Lever ligada e se a senha já foi levada para lá (Fase 3 do
  // PLANO-AUTH: migra no primeiro login antigo depois do vínculo).
  email: u.email || "",
  identityPasswordSet: !!u.identityPasswordAt,
});

// Usuário do cockpit ligado a uma conta da identidade (claim `sub` do JWT).
// Mesmo cache por writeRev do sessionUser: a lista só é relida depois de uma
// escrita neste processo.
const authIdCache = new WeakMap(); // repo -> { rev, map }
export async function userByAuthId(repo, sub) {
  if (!sub) return null;
  const rev = typeof repo?.writeRev === "function" ? repo.writeRev() : null;
  let hit = rev != null ? authIdCache.get(repo) : null;
  if (!hit || hit.rev !== rev) {
    const map = new Map();
    for (const u of await repo.list("users")) if (u.authUserId) map.set(u.authUserId, u);
    hit = { rev, map };
    if (rev != null) authIdCache.set(repo, hit);
  }
  const user = hit.map.get(sub);
  return user ? publicUser(user) : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Token de sessão → usuário (null se inexistente/expirado).
//
// Cache: cada tela do cockpit dispara ~11 GETs e cada um fazia DUAS idas ao
// banco (sessions + users) só pra saber quem é. A entrada vale enquanto
// ninguém escreveu neste processo (repo.writeRev(), o mesmo carimbo do
// compute-cache) e por no máximo SESSION_CACHE_MS. Logout/troca de papel passam
// pelo repo → writeRev sobe → a entrada morre na hora. Repo sem writeRev
// (double antigo de teste) passa direto, sem cache.
const SESSION_CACHE_MS = 30_000;
const sessionCache = new WeakMap(); // repo -> Map(token -> { user, at, rev })
export async function sessionUser(repo, token) {
  if (!token || token.length < 32) return null;
  const rev = typeof repo?.writeRev === "function" ? repo.writeRev() : null;
  let table = null;
  if (rev != null) {
    table = sessionCache.get(repo);
    if (!table) { table = new Map(); sessionCache.set(repo, table); }
    const hit = table.get(token);
    if (hit && hit.rev === rev && Date.now() - hit.at < SESSION_CACHE_MS) return hit.user;
  }
  const user = await lookupSessionUser(repo, token);
  if (table) { if (user) table.set(token, { user, at: Date.now(), rev }); else table.delete(token); }
  return user;
}

async function lookupSessionUser(repo, token) {
  const session = await repo.get("sessions", token);
  if (!session) return null;
  if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
    await repo.remove("sessions", token);
    return null;
  }
  const user = await repo.get("users", session.user);
  return user ? publicUser(user) : null;
}

// Hook de autenticação (substitui a comparação crua da key no index.js):
// aceita a COCKPIT_API_KEY OU um token de sessão válido OU (AUTH_MODE dual ou
// gotrue, auth-jwt.js) o JWT da identidade central. Sem COCKPIT_API_KEY a API
// NÃO fica aberta: só a key mestre deixa de existir e vale o login.
// Exportado pra ser testável sem subir o index.
export function makeAuthHook({ apiKey, repo, openPaths, openPrefixes, providedKey, authMode = "legacy", jwtUser = null }) {
  return async (req, reply) => {
    if (req.method === "OPTIONS") return;
    const path = req.url.split("?")[0];
    if (openPaths.has(path)) return;
    if (openPrefixes.some((p) => path.startsWith(p))) return;
    const key = providedKey(req);
    if (apiKey && key === apiKey) return;
    let user = null;
    if (authMode !== "legacy" && jwtUser && looksLikeJwt(key)) {
      user = await jwtUser(key);
      if (user) req.authVia = "jwt";
    } else if (authMode !== "gotrue") {
      user = await sessionUser(repo, key);
      if (user) req.authVia = "session";
    }
    if (user) {
      // Autoria real das escritas (quem moveu o card / logou o toque). Key de
      // integração não tem usuário — rotas caem no author "api".
      req.authUser = user;
      return;
    }
    return reply.code(401).send({ error: "Unauthorized" });
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function registerAuthRoutes(app, repo, { identity = makeIdentityAdmin() } = {}) {
  // Quem está logado: o hook já resolveu (sessão ou JWT); sem hook (testes),
  // cai no token de sessão do header.
  const currentUser = async (req) => req.authUser || sessionUser(repo, headerKey(req));

  // Migração de senha no login antigo (o scrypt não é importável no GoTrue):
  // com a senha já validada aqui, grava a mesma na conta Lever ligada. Só em
  // conta criada pelo cockpit e ainda sem senha lá — nunca sobrescreve a senha
  // de uma conta do LeverAds nem a que a pessoa já definiu pelo e-mail. Falha
  // (identidade fora, senha fraca demais para o GoTrue) não impede o login.
  async function migratePasswordToIdentity(user, password) {
    if (!identity || !user.authUserId || user.identitySource !== "cockpit" || user.identityPasswordAt || !user.email) return;
    try {
      const found = await identity.findUserByEmail(user.email);
      if (!found || found.userId !== user.authUserId) return;
      if (!found.hasPassword) await identity.setPassword(user.authUserId, password);
      await repo.update("users", user.id, { identityPasswordAt: new Date().toISOString() });
    } catch (err) {
      app.log?.warn?.(`identidade: senha de ${user.id} não migrou (${err.message})`);
    }
  }

  // Papéis de staff na identidade seguem as etiquetas daqui. Best-effort: a
  // conferência do login (authUserId + is_staff) já barra quem saiu do time.
  async function syncStaff(user, roles = staffRolesFor(user)) {
    if (!identity || !user?.authUserId) return;
    try { await identity.setStaff(user.authUserId, roles); }
    catch (err) { app.log?.warn?.(`identidade: papéis de ${user.id} não sincronizaram (${err.message})`); }
  }

  // Ligar o usuário a uma conta Lever pelo e-mail de trabalho. Se o e-mail já
  // tem conta (ex.: a do LeverAds), usa ela — uma pessoa, uma conta, a senha
  // de lá; senão cria a conta, sem senha (migra no próximo login antigo).
  app.post("/api/auth/users/:id/identity", async (req, reply) => {
    if (!identity) return reply.code(NOT_CONFIGURED).send({ error: "identidade central não configurada (IDENTITY_*)" });
    const user = await repo.get("users", req.params.id);
    if (!user) return reply.code(404).send({ error: "Not found" });
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return reply.code(400).send({ error: "e-mail inválido" });
    const others = (await repo.list("users")).filter((u) => u.id !== user.id);
    if (others.some((u) => String(u.email || "").toLowerCase() === email)) {
      return reply.code(409).send({ error: "esse e-mail já está ligado a outra pessoa do time" });
    }
    let found;
    try { found = await identity.findUserByEmail(email); }
    catch (err) { return reply.code(UPSTREAM_FAILED).send({ error: "identidade indisponível", detail: err.message }); }
    if (found && others.some((u) => u.authUserId === found.userId)) {
      return reply.code(409).send({ error: "essa conta Lever já está ligada a outra pessoa do time" });
    }
    let authUserId = found?.userId;
    try { if (!authUserId) authUserId = await identity.createUser(email); }
    catch (err) { return reply.code(UPSTREAM_FAILED).send({ error: "não criou a conta Lever", detail: err.message }); }
    const source = found ? found.source || "" : "cockpit";
    const updated = await repo.update("users", user.id, {
      email, authUserId, identitySource: source,
      // Conta que já existia com senha: nada a migrar.
      identityPasswordAt: found?.hasPassword ? new Date().toISOString() : "",
    });
    await syncStaff(updated);
    return { ...publicUser(updated), identityCreated: !found };
  });

  // E-mail "defina sua senha" para quem não vai passar pelo login antigo (ou
  // esqueceu a senha da conta Lever). O link volta ao cockpit (`redirectTo`,
  // a origem de quem pediu), que mostra a tela de definir senha.
  app.post("/api/auth/users/:id/identity/password-email", async (req, reply) => {
    if (!identity) return reply.code(NOT_CONFIGURED).send({ error: "identidade central não configurada (IDENTITY_*)" });
    const user = await repo.get("users", req.params.id);
    if (!user) return reply.code(404).send({ error: "Not found" });
    if (!user.authUserId || !user.email) return reply.code(409).send({ error: "ligue uma conta Lever antes" });
    let redirectTo;
    try {
      const url = new URL(String(req.body?.redirectTo || process.env.COCKPIT_PUBLIC_URL || ""));
      if (!/^https?:$/.test(url.protocol)) throw new Error("protocolo");
      redirectTo = `${url.origin}/`;
    } catch { return reply.code(400).send({ error: "redirectTo inválido" }); }
    try { await identity.sendPasswordEmail(user.email, redirectTo); }
    catch (err) { return reply.code(UPSTREAM_FAILED).send({ error: "não enviou o e-mail", detail: err.message }); }
    return { ok: true, email: user.email };
  });

  // Desligar: tira o staff na identidade (a conta continua existindo — pode ser
  // a do LeverAds) e apaga o vínculo daqui.
  app.delete("/api/auth/users/:id/identity", async (req, reply) => {
    const user = await repo.get("users", req.params.id);
    if (!user) return reply.code(404).send({ error: "Not found" });
    await syncStaff(user, []);
    const updated = await repo.update("users", user.id, { authUserId: "", identitySource: "", identityPasswordAt: "" });
    return publicUser(updated);
  });

  // Login (rota ABERTA — está em OPEN_PATHS no index). Nome é case-insensitive.
  app.post("/api/auth/login", async (req, reply) => {
    const { username, password } = req.body || {};
    if (!username || !password) return reply.code(400).send({ error: "username e password obrigatórios" });
    const users = await repo.list("users");
    const q = String(username).trim().toLowerCase();
    const user = users.find((u) => u.id.toLowerCase() === q || String(u.name || "").toLowerCase() === q);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return reply.code(401).send({ error: "usuário ou senha inválidos" });
    }
    const token = randomBytes(32).toString("hex");
    await repo.create("sessions", {
      id: token, user: user.id,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    });
    await migratePasswordToIdentity(user, password);
    return { token, user: publicUser(user) };
  });

  // Quem sou eu (token no header) — o SPA usa pra mostrar o usuário logado.
  app.get("/api/auth/me", async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return reply.code(401).send({ error: "sessão inválida" });
    return user;
  });

  app.post("/api/auth/logout", async (req) => {
    const token = headerKey(req);
    if (token) await repo.remove("sessions", token);
    return { ok: true };
  });

  // Trocar a própria senha (exige sessão — key não tem usuário — e a senha atual).
  app.post("/api/auth/password", async (req, reply) => {
    const me = await currentUser(req);
    if (!me) return reply.code(401).send({ error: "sessão inválida" });
    // Conta da identidade central troca a senha lá (GoTrue), não aqui.
    if (req.authVia === "jwt") return reply.code(409).send({ error: "sua senha é trocada no login da Lever, não no cockpit" });
    const { current, password } = req.body || {};
    if (weakPassword(password)) return reply.code(400).send({ error: WEAK_PASSWORD_ERROR });
    const user = await repo.get("users", me.id);
    if (!verifyPassword(current || "", user.passwordHash)) {
      return reply.code(401).send({ error: "senha atual incorreta" });
    }
    await repo.update("users", user.id, { passwordHash: hashPassword(password) });
    return { ok: true };
  });

  // ── Meu perfil ────────────────────────────────────────────────────────────
  // Nome e foto são do PRÓPRIO usuário: /api/auth/me não passa pelo guard de
  // Ajustes (SETTINGS_WRITE_PREFIXES cobre /api/auth/users), então quem tem
  // telas restritas (SDR, Ana) também consegue se editar. Cargo NÃO entra aqui
  // — etiquetas de papel continuam sendo gestão, em Ajustes → Equipe.
  app.patch("/api/auth/me", async (req, reply) => {
    const me = await currentUser(req);
    if (!me) return reply.code(401).send({ error: "sessão inválida" });
    const name = String(req.body?.name || "").trim();
    if (name.length < 2) return reply.code(400).send({ error: "nome precisa de 2+ caracteres" });
    // O login casa por id OU nome (case-insensitive): deixar dois usuários com o
    // mesmo nome tornaria a entrada ambígua.
    const taken = (await repo.list("users")).some((u) => u.id !== me.id
      && (u.id.toLowerCase() === name.toLowerCase() || String(u.name || "").toLowerCase() === name.toLowerCase()));
    if (taken) return reply.code(409).send({ error: "já existe alguém no time com esse nome" });
    const updated = await repo.update("users", me.id, { name });
    return publicUser(updated);
  });

  // Foto de perfil: bytes na collection `user_assets` (1 por usuário, id = id do
  // usuário) e URL com ?v= no registro — mesmo desenho de /public/training e
  // /public/social, que já rodam em produção.
  app.post("/api/auth/me/photo", async (req, reply) => {
    const me = await currentUser(req);
    if (!me) return reply.code(401).send({ error: "sessão inválida" });
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "envie uma imagem (multipart, campo file)" });
    if (!/^image\//.test(file.mimetype || "")) return reply.code(400).send({ error: "só aceito imagem" });
    const buf = await file.toBuffer();
    if (buf.length > 2 * 1024 * 1024) return reply.code(413).send({ error: "imagem acima de 2MB — recorte ou comprima" });
    const doc = {
      id: me.id, mime: file.mimetype, size: buf.length,
      data: buf.toString("base64"), at: new Date().toISOString(),
    };
    if (await repo.get("user_assets", me.id)) await repo.update("user_assets", me.id, doc);
    else await repo.create("user_assets", doc);
    const photo = `/public/users/${me.id}?v=${Date.now().toString(36)}`;
    const updated = await repo.update("users", me.id, { photo });
    return publicUser(updated);
  });

  app.delete("/api/auth/me/photo", async (req, reply) => {
    const me = await currentUser(req);
    if (!me) return reply.code(401).send({ error: "sessão inválida" });
    await repo.remove("user_assets", me.id);
    const updated = await repo.update("users", me.id, { photo: "" });
    return publicUser(updated);
  });

  // Rota ABERTA (está em OPEN_PREFIXES): <img> não manda header. Só devolve os
  // bytes da foto — nada do usuário vaza aqui.
  app.get("/public/users/:id", async (req, reply) => {
    const doc = await repo.get("user_assets", req.params.id);
    if (!doc) return reply.code(404).send({ error: "sem foto" });
    reply.header("cache-control", "public, max-age=86400, immutable");
    return reply.type(doc.mime || "image/png").send(Buffer.from(doc.data || "", "base64"));
  });

  // Gestão mínima do time (qualquer autenticado — todos admins na v1).
  app.get("/api/auth/users", async () => (await repo.list("users")).map(publicUser));

  app.post("/api/auth/users", async (req, reply) => {
    const { name, password, id, roles, saas, screens } = req.body || {};
    if (!name || !password) return reply.code(400).send({ error: "name e password obrigatórios" });
    if (weakPassword(password)) return reply.code(400).send({ error: WEAK_PASSWORD_ERROR });
    const created = await repo.create("users", {
      ...(id ? { id: String(id).toLowerCase() } : {}),
      name, role: "admin",
      roles: sanitizeRoles(roles),
      ...(saas ? { saas: sanitizeSaas(saas) } : {}),
      ...(screens !== undefined ? { screens: sanitizeScreens(screens) } : {}),
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
    });
    return reply.code(201).send(publicUser(created));
  });

  // Editar usuário (nome, etiquetas de papel, reset de senha). Qualquer
  // autenticado pode — postura atual do time (todos admins); revisitar quando
  // roles virarem ACL. Reset de senha aqui NÃO pede a atual (o /password, que é
  // "trocar a própria", pede) — é o caminho de gestão pro dono destravar acesso.
  app.patch("/api/auth/users/:id", async (req, reply) => {
    const user = await repo.get("users", req.params.id);
    if (!user) return reply.code(404).send({ error: "Not found" });
    const { name, roles, password, saas, screens, compLevel, supportSaas, authUserId } = req.body || {};
    const patch = {};
    // Liga (ou desliga, com "") a conta da identidade central. Uma conta só
    // pode estar ligada a um usuário do cockpit.
    if (authUserId !== undefined) {
      const id = String(authUserId || "").trim().toLowerCase();
      if (id && !UUID_RE.test(id)) return reply.code(400).send({ error: "authUserId precisa ser um UUID" });
      if (id && (await repo.list("users")).some((u) => u.id !== user.id && u.authUserId === id)) {
        return reply.code(409).send({ error: "essa conta já está ligada a outro usuário" });
      }
      patch.authUserId = id;
    }
    // Nível do plano de remuneração (1 jr · 2 pl · 3 sn): régua das metas de
    // contratos/receita do card da pessoa na Visão geral (comp-plan.js).
    if (compLevel !== undefined) {
      const n = Math.floor(Number(compLevel));
      patch.compLevel = n >= 1 && n <= 3 ? n : 1;
      // HISTÓRICO do nível: sem ele não dá pra saber desde quando a pessoa está
      // no nível atual, e o critério de promoção (3 meses fechados a 100%)
      // contaria meses de ANTES da última promoção — alguém subiria hoje e
      // chegaria elegível amanhã.
      if (Math.floor(Number(user.compLevel) || 1) !== patch.compLevel) {
        const hist = Array.isArray(user.compLevelHistory) ? user.compLevelHistory : [];
        patch.compLevelHistory = [...hist, { level: patch.compLevel, at: new Date().toISOString(), by: req.authUser?.id || "api" }].slice(-20);
      }
    }
    if (typeof name === "string" && name.trim()) {
      // Mesma guarda do /api/auth/me: o login casa por id OU nome, então dois
      // nomes iguais no time deixariam a entrada ambígua.
      const taken = (await repo.list("users")).some((u) => u.id !== user.id
        && (u.id.toLowerCase() === name.trim().toLowerCase() || String(u.name || "").toLowerCase() === name.trim().toLowerCase()));
      if (taken) return reply.code(409).send({ error: "já existe alguém no time com esse nome" });
      patch.name = name.trim();
    }
    if (roles !== undefined) patch.roles = sanitizeRoles(roles);
    if (saas !== undefined) patch.saas = sanitizeSaas(saas); // "" volta a valer pra todos
    if (screens !== undefined) patch.screens = sanitizeScreens(screens); // [] volta a ver tudo
    // Produtos cujos tickets a pessoa atende (ACL do Suporte). Ajustes → Equipe
    // é a porta de quem gerencia o time: a tela de Configurações de SLA só abre
    // pra quem já atende o produto, então sem isto ninguém destravava o primeiro.
    if (supportSaas !== undefined) {
      const products = new Set((await repo.list("products")).map((p) => String(p.id)));
      patch.supportSaas = sanitizeSupportSaas(supportSaas).filter((s) => products.has(s));
    }

    if (password !== undefined) {
      if (weakPassword(password)) return reply.code(400).send({ error: WEAK_PASSWORD_ERROR });
      patch.passwordHash = hashPassword(password);
    }
    // Trocou/desligou a conta Lever à mão: a antiga deixa de ser staff.
    if (patch.authUserId !== undefined && user.authUserId && user.authUserId !== patch.authUserId) await syncStaff(user, []);
    const updated = await repo.update("users", user.id, patch);
    if (patch.roles || patch.authUserId !== undefined) await syncStaff(updated);
    return publicUser(updated);
  });

  // Remover usuário do time. Guarda: não dá pra remover a si mesmo, nem alguém
  // que ainda é responsável por leads (owner/closer/integrator) — evita card
  // órfão no board. `?force=1` remove assim mesmo (o dono reatribui depois).
  app.delete("/api/auth/users/:id", async (req, reply) => {
    const id = req.params.id;
    const user = await repo.get("users", id);
    if (!user) return reply.code(404).send({ error: "Not found" });
    if (req.authUser?.id === id) return reply.code(400).send({ error: "você não pode remover a si mesmo" });
    const force = req.query.force === "1" || req.query.force === "true";
    const owned = (await repo.list("leads")).filter((l) => l.owner === id || l.closer === id || l.integrator === id).length;
    if (owned > 0 && !force) {
      return reply.code(409).send({ error: `este usuário ainda é responsável por ${owned} lead(s) — reatribua antes de remover`, owned });
    }
    await syncStaff(user, []);
    await repo.remove("users", id);
    try { await repo.remove("user_assets", id); } catch { /* pode nem ter foto */ }
    // Sessões órfãs do usuário removido (best-effort; a auth trata como deslogado).
    try { for (const s of await repo.list("sessions")) if (s.user === id) await repo.remove("sessions", s.id); } catch { /* ignore */ }
    return { ok: true, removed: id, owned };
  });
}

function headerKey(req) {
  const h = req.headers["x-api-key"];
  if (h) return Array.isArray(h) ? h[0] : h;
  const auth = req.headers["authorization"] || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}
