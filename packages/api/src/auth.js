// Sistema simples de usuários (time interno, um tenant — decisão §3.9: todos
// iguais na v1, roles depois). Senha com scrypt (node:crypto, sem deps), NUNCA
// em plaintext. Sessão = token opaco na collection `sessions` (TTL 7d) que entra
// no MESMO header da key (`x-api-key`/Bearer) — o SPA loga e segue usando o
// pipeline existente; a COCKPIT_API_KEY continua valendo (MCP/integraçōes).
// `users`/`sessions` ficam FORA do CRUD genérico (hash/token não vazam).

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

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

// Admins padrão (Eryk e Leonardo) — criados só quando a collection está vazia,
// então um deploy/restart nunca recria usuário apagado nem reseta senha.
export const DEFAULT_ADMINS = [
  { id: "eryk", name: "Eryk", password: "1234" },
  { id: "leonardo", name: "Leonardo", password: "1234" },
];

export async function ensureDefaultAdmins(repo) {
  const users = await repo.list("users");
  if (users.length) return 0;
  for (const u of DEFAULT_ADMINS) {
    await repo.create("users", {
      id: u.id, name: u.name, role: "admin",
      passwordHash: hashPassword(u.password),
      createdAt: new Date().toISOString(),
    });
  }
  return DEFAULT_ADMINS.length;
}

const publicUser = (u) => ({ id: u.id, name: u.name, role: u.role || "admin" });

// Token de sessão → usuário (null se inexistente/expirado).
export async function sessionUser(repo, token) {
  if (!token || token.length < 32) return null;
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
// aceita a COCKPIT_API_KEY OU um token de sessão válido. Exportado pra ser
// testável sem subir o index.
export function makeAuthHook({ apiKey, repo, openPaths, openPrefixes, providedKey }) {
  return async (req, reply) => {
    if (!apiKey) return;
    if (req.method === "OPTIONS") return;
    const path = req.url.split("?")[0];
    if (openPaths.has(path)) return;
    if (openPrefixes.some((p) => path.startsWith(p))) return;
    const key = providedKey(req);
    if (key === apiKey) return;
    if (await sessionUser(repo, key)) return;
    return reply.code(401).send({ error: "Unauthorized" });
  };
}

export function registerAuthRoutes(app, repo) {
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
    return { token, user: publicUser(user) };
  });

  // Quem sou eu (token no header) — o SPA usa pra mostrar o usuário logado.
  app.get("/api/auth/me", async (req, reply) => {
    const user = await sessionUser(repo, headerKey(req));
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
    const me = await sessionUser(repo, headerKey(req));
    if (!me) return reply.code(401).send({ error: "sessão inválida" });
    const { current, password } = req.body || {};
    if (!password || String(password).length < 4) return reply.code(400).send({ error: "senha nova precisa de 4+ caracteres" });
    const user = await repo.get("users", me.id);
    if (!verifyPassword(current || "", user.passwordHash)) {
      return reply.code(401).send({ error: "senha atual incorreta" });
    }
    await repo.update("users", user.id, { passwordHash: hashPassword(password) });
    return { ok: true };
  });

  // Gestão mínima do time (qualquer autenticado — todos admins na v1).
  app.get("/api/auth/users", async () => (await repo.list("users")).map(publicUser));

  app.post("/api/auth/users", async (req, reply) => {
    const { name, password, id } = req.body || {};
    if (!name || !password) return reply.code(400).send({ error: "name e password obrigatórios" });
    const created = await repo.create("users", {
      ...(id ? { id: String(id).toLowerCase() } : {}),
      name, role: "admin",
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
    });
    return reply.code(201).send(publicUser(created));
  });
}

function headerKey(req) {
  const h = req.headers["x-api-key"];
  if (h) return Array.isArray(h) ? h[0] : h;
  const auth = req.headers["authorization"] || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}
