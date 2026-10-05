// Restrição de telas por usuário (user.screens): o guard de rotas fecha a API
// pras telas que o usuário não tem, o bootstrap sai filtrado e a key mestre
// (MCP/integrações) nunca é restringida.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeAuthHook, hashPassword } from "../src/auth/auth.js";
import { seedTestAdmins } from "./helpers/seed-admins.js";
import { makeScreenGuardHook, screenForRequest, sanitizeScreens } from "../src/auth/screens.js";

const { registerRoutes } = await import("../src/routes.js");

function providedKey(req) {
  const h = req.headers["x-api-key"];
  if (h) return Array.isArray(h) ? h[0] : h;
  const auth = req.headers["authorization"] || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

// App com a MESMA pilha de hooks do index.js (auth + guard de telas).
function buildApp(repo, apiKey = "test-key") {
  const app = Fastify();
  app.addHook("onRequest", makeAuthHook({
    apiKey, repo,
    openPaths: new Set(["/api/health", "/api/auth/login"]),
    openPrefixes: [],
    providedKey,
  }));
  app.addHook("onRequest", makeScreenGuardHook());
  registerRoutes(app, repo);
  return app;
}

async function loginToken(app, username, password) {
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });
  return res.json().token;
}

test("sanitizeScreens: só ids conhecidos passam; não-array vira []", () => {
  assert.deepEqual(sanitizeScreens(["pipeline", "hacker", 42, "tasks"]), ["pipeline", "tasks"]);
  assert.deepEqual(sanitizeScreens("pipeline"), []);
  assert.deepEqual(sanitizeScreens(undefined), []);
});

test("screenForRequest: mapa por prefixo + escritas administrativas", () => {
  // Leituras da Visão geral (tiles de aquisição + Resultado do mês): GET ganha
  // "overview" de carona; escrita/ação continua só da tela dona.
  assert.deepEqual(screenForRequest("GET", "/api/expenses/summary/leverads"), ["expenses", "overview"]);
  assert.deepEqual(screenForRequest("GET", "/api/marketing/leverads"), ["metrics", "overview"]);
  assert.deepEqual(screenForRequest("POST", "/api/marketing/sync"), ["metrics"]);
  assert.deepEqual(screenForRequest("GET", "/api/invoices"), ["customers", "overview"]);
  assert.deepEqual(screenForRequest("POST", "/api/invoices/i1/pay"), ["customers"]);
  assert.deepEqual(screenForRequest("GET", "/api/metrics/leverads"), ["metrics", "overview"]);
  assert.deepEqual(screenForRequest("POST", "/api/expenses"), ["expenses"]);
  assert.deepEqual(screenForRequest("POST", "/api/leads/l1/proposal"), ["pipeline", "today"]);
  assert.deepEqual(screenForRequest("POST", "/api/activities"), ["pipeline", "today"]);
  assert.deepEqual(screenForRequest("GET", "/api/pipeline-pace/leverads"), ["pipeline", "analise", "overview"]);
  assert.deepEqual(screenForRequest("GET", "/api/funnel/leverads"), ["pipeline", "analise"]);
  assert.deepEqual(screenForRequest("GET", "/api/scoreboard/leverads"), ["overview", "funcionarios", "desempenho"]);
  // Análise de Desempenho: a tela lê; SDR (Meu dia) e social (Redes sociais) só
  // gravam o próprio registro do dia pela mesma rota.
  assert.deepEqual(screenForRequest("GET", "/api/desempenho/leverads"), ["desempenho", "today", "social"]);
  assert.deepEqual(screenForRequest("POST", "/api/desempenho/leverads/log"), ["desempenho", "today", "social"]);
  assert.deepEqual(screenForRequest("GET", "/api/daily_logs"), ["desempenho"]);
  // Leitura agregada do inbox na Visão geral; conversas/envio seguem só do inbox
  assert.deepEqual(screenForRequest("GET", "/api/whatsapp/insights"), ["whatsapp", "overview"]);
  assert.deepEqual(screenForRequest("GET", "/api/whatsapp/threads"), ["whatsapp"]);
  assert.deepEqual(screenForRequest("POST", "/api/whatsapp/threads/5541999/send"), ["whatsapp"]);
  assert.deepEqual(screenForRequest("GET", "/api/customers"), ["customers"]);
  assert.equal(screenForRequest("GET", "/api/products"), null);           // catálogo é leitura livre
  assert.deepEqual(screenForRequest("PATCH", "/api/products/leverads"), ["settings"]);
  assert.deepEqual(screenForRequest("POST", "/api/auth/users"), ["settings"]);
  assert.equal(screenForRequest("GET", "/api/auth/users"), null);         // lista de nomes: pickers
  assert.equal(screenForRequest("GET", "/api/bootstrap"), null);          // filtra o payload por conta própria
  // Sync de acesso do produto: anda com a base de clientes.
  assert.deepEqual(screenForRequest("POST", "/api/leverads-access/run"), ["customers"]);
  assert.deepEqual(screenForRequest("GET", "/api/leverads-access/status"), ["customers"]);
  assert.deepEqual(screenForRequest("GET", "/api/entitlements/status"), ["customers"]);
});

test("sync de acesso do produto: sem a tela Clientes é 403; aplicar pede etiqueta admin", async (t) => {
  const repo = makeMemRepo();
  await seedTestAdmins(repo);
  await repo.create("users", {
    id: "sdr", name: "SDR", roles: ["sdr"], screens: ["pipeline"], passwordHash: hashPassword("1234"),
  });
  await repo.create("users", {
    id: "cs", name: "CS", roles: ["cs"], screens: ["customers"], passwordHash: hashPassword("1234"),
  });
  await repo.create("users", {
    id: "chefe", name: "Chefe", roles: ["admin"], screens: ["customers"], passwordHash: hashPassword("1234"),
  });
  const app = Fastify();
  app.addHook("onRequest", makeAuthHook({
    apiKey: "test-key", repo,
    openPaths: new Set(["/api/health", "/api/auth/login"]), openPrefixes: [], providedKey,
  }));
  app.addHook("onRequest", makeScreenGuardHook());
  const updates = [];
  registerRoutes(app, repo, {
    leveradsAccess: {
      client: {
        configured: () => true,
        listOrgs: async () => [],
        updateOrg: async (id, patch) => { updates.push({ id, ...patch }); },
      },
    },
  });
  t.after(() => app.close());

  const sdr = { "x-api-key": await loginToken(app, "sdr", "1234") };
  for (const [method, url] of [["POST", "/api/leverads-access/run"], ["GET", "/api/leverads-access/status"], ["GET", "/api/leverads-access/orgs"]]) {
    assert.equal((await app.inject({ method, url, headers: sdr, payload: method === "POST" ? {} : undefined })).statusCode, 403, `esperava 403 em ${url}`);
  }

  const cs = { "x-api-key": await loginToken(app, "cs", "1234") };
  assert.equal((await app.inject({ method: "POST", url: "/api/leverads-access/run", headers: cs, payload: {} })).statusCode, 200, "dry-run segue com a tela Clientes");
  assert.equal((await app.inject({ method: "POST", url: "/api/leverads-access/run", headers: cs, payload: { apply: true } })).statusCode, 403);

  const chefe = { "x-api-key": await loginToken(app, "chefe", "1234") };
  assert.equal((await app.inject({ method: "POST", url: "/api/leverads-access/run", headers: chefe, payload: { apply: true } })).json().mode, "apply");
  const key = { "x-api-key": "test-key" };
  assert.equal((await app.inject({ method: "POST", url: "/api/leverads-access/run", headers: key, payload: { apply: true } })).json().mode, "apply");
});

test("usuário restrito (pipeline+tasks): funil libera, financeiro/clientes/ajustes 403", async (t) => {
  const repo = makeMemRepo();
  await seedTestAdmins(repo);
  await repo.create("users", {
    id: "sdr", name: "SDR", role: "admin", roles: ["sdr"],
    screens: ["pipeline", "tasks"], passwordHash: hashPassword("1234"),
  });
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Novo lead", conv: 1 }] });
  const app = buildApp(repo);
  t.after(() => app.close());
  const token = await loginToken(app, "sdr", "1234");
  const H = { "x-api-key": token };

  // O que a tela dele usa: liberado.
  assert.equal((await app.inject({ url: "/api/leads", headers: H })).statusCode, 200);
  assert.equal((await app.inject({ url: "/api/tasks", headers: H })).statusCode, 200);
  assert.equal((await app.inject({ url: "/api/pipeline-pace/leverads", headers: H })).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: "/api/leads", headers: H, payload: { name: "Lead X", saas: "leverads" } })).statusCode, 201);
  assert.equal((await app.inject({ url: "/api/products", headers: H })).statusCode, 200);
  assert.equal((await app.inject({ url: "/api/auth/users", headers: H })).statusCode, 200);

  // Telas que ele NÃO tem: 403 na API, não só menu escondido.
  for (const url of ["/api/customers", "/api/expenses", "/api/expenses/summary/leverads", "/api/marketing/leverads", "/api/metrics/leverads", "/api/proposal_templates", "/api/forms", "/api/forms/overview?saas=leverads", "/api/forms/funnels?saas=leverads", "/api/portfolio", "/api/ad_insights"]) {
    assert.equal((await app.inject({ url, headers: H })).statusCode, 403, `esperava 403 em ${url}`);
  }
  // Escritas administrativas também.
  assert.equal((await app.inject({ method: "PATCH", url: "/api/products/leverads", headers: H, payload: { name: "X" } })).statusCode, 403);
  assert.equal((await app.inject({ method: "POST", url: "/api/auth/users", headers: H, payload: { name: "Z", password: "abcd1234" } })).statusCode, 403);
  assert.equal((await app.inject({ method: "PATCH", url: "/api/auth/users/sdr", headers: H, payload: { screens: [] } })).statusCode, 403); // não se auto-libera
});

test("usuário só com Meu dia (today): leads e toques liberados, resto 403", async (t) => {
  const repo = makeMemRepo();
  await seedTestAdmins(repo);
  await repo.create("users", {
    id: "op", name: "Operação", role: "admin", roles: ["sdr"],
    screens: ["today"], passwordHash: hashPassword("1234"),
  });
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Novo lead", conv: 1 }] });
  await repo.create("leads", { id: "l1", saas: "leverads", name: "Lead" });
  const app = buildApp(repo);
  t.after(() => app.close());
  const token = await loginToken(app, "op", "1234");
  const H = { "x-api-key": token };

  // A fila do dia usa leads + registro de toque: liberados.
  assert.equal((await app.inject({ url: "/api/leads", headers: H })).statusCode, 200);
  assert.equal((await app.inject({
    method: "POST", url: "/api/activities", headers: H,
    payload: { saas: "leverads", lead: "l1", type: "call", text: "tentativa" },
  })).statusCode, 201);
  // Bootstrap entrega os leads pra tela.
  const seed = (await app.inject({ url: "/api/bootstrap", headers: H })).json();
  assert.equal(seed.LEADS.length, 1);
  // O que não é da tela continua fechado.
  for (const url of ["/api/customers", "/api/expenses", "/api/funnel/leverads", "/api/pipeline-pace/leverads", "/api/tasks"]) {
    assert.equal((await app.inject({ url, headers: H })).statusCode, 403, `esperava 403 em ${url}`);
  }
});

test("usuário só com Visão geral (overview): LÊ os painéis da tela de gestão, mas não age", async (t) => {
  const repo = makeMemRepo();
  await seedTestAdmins(repo);
  await repo.create("users", {
    id: "vitor", name: "Vitor", role: "admin", roles: ["closer"],
    screens: ["overview"], passwordHash: hashPassword("1234"),
  });
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Novo lead", conv: 1 }] });
  const app = buildApp(repo);
  t.after(() => app.close());
  const token = await loginToken(app, "vitor", "1234");
  const H = { "x-api-key": token };

  // A Visão geral de gestão é a mesma pra todo o time: as leituras dos painéis
  // (aquisição, CAC, Resultado do mês) passam só com a tela overview.
  for (const url of ["/api/marketing/leverads", "/api/metrics/leverads", "/api/invoices", "/api/expenses/summary/leverads", "/api/portfolio", "/api/scoreboard/leverads", "/api/pipeline-pace/leverads"]) {
    assert.equal((await app.inject({ url, headers: H })).statusCode, 200, `esperava 200 em ${url}`);
  }
  // Ação/escrita continua exigindo a tela dona da rota.
  assert.equal((await app.inject({ method: "POST", url: "/api/marketing/sync", headers: H, payload: {} })).statusCode, 403);
  assert.equal((await app.inject({ method: "POST", url: "/api/expenses", headers: H, payload: { saas: "leverads", label: "X", amount: 1 } })).statusCode, 403);
  assert.equal((await app.inject({ method: "POST", url: "/api/invoices/i1/pay", headers: H, payload: {} })).statusCode, 403);
});

test("bootstrap filtrado: restrito recebe leads mas NÃO clientes/portfólio/financeiro do produto", async (t) => {
  const repo = makeMemRepo();
  await seedTestAdmins(repo);
  await repo.create("users", {
    id: "sdr", name: "SDR", role: "admin", screens: ["pipeline", "tasks"], passwordHash: hashPassword("1234"),
  });
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Novo lead", conv: 1 }] });
  await repo.create("customers", { id: "c1", saas: "leverads", name: "Cliente", arr: 12000 });
  await repo.create("leads", { id: "l1", saas: "leverads", name: "Lead" });
  const app = buildApp(repo);
  t.after(() => app.close());

  const token = await loginToken(app, "sdr", "1234");
  const seed = (await app.inject({ url: "/api/bootstrap", headers: { "x-api-key": token } })).json();
  assert.equal(seed.LEADS.length, 1);
  // Cliente vem, mas SÓ pra escolher (cobrança, contrato, consulta): nome e
  // contato, nunca ARR/MRR/saúde. Ver test/cobranca-todo-mundo.test.js.
  assert.equal(seed.CUSTOMERS.length, 1);
  assert.equal(seed.CUSTOMERS[0].name, "Cliente");
  assert.equal(seed.CUSTOMERS[0].arr, undefined, "receita do cliente não chega em quem não tem a tela Clientes");
  assert.equal(seed.PORTFOLIO, null);
  assert.deepEqual(seed.GOALS, []);
  const p = seed.SAAS.find((s) => s.id === "leverads");
  assert.ok(p, "catálogo de produtos continua (funil/config)");
  assert.ok(Array.isArray(p.funnel));
  assert.equal(p.arr, undefined, "receita não chega no navegador de quem não vê telas financeiras");
  assert.equal(p.mrr, undefined);
  assert.equal(p.customers, undefined);

  // Admin (screens vazio) recebe tudo.
  const t2 = await loginToken(app, "eryk", "1234");
  const full = (await app.inject({ url: "/api/bootstrap", headers: { "x-api-key": t2 } })).json();
  assert.equal(full.CUSTOMERS.length, 1);
  assert.equal(full.SAAS.find((s) => s.id === "leverads").arr, 12000);
});

test("key mestre segue com acesso total (MCP/integrações)", async (t) => {
  const repo = makeMemRepo();
  await repo.create("customers", { id: "c1", saas: "leverads", name: "Cliente" });
  const app = buildApp(repo);
  t.after(() => app.close());
  const H = { "x-api-key": "test-key" };
  assert.equal((await app.inject({ url: "/api/customers", headers: H })).statusCode, 200);
  assert.equal((await app.inject({ url: "/api/portfolio", headers: H })).statusCode, 200);
});

test("screens: create/PATCH sanitizam e expõem; [] volta a ver tudo", async (t) => {
  const repo = makeMemRepo();
  const app = Fastify();
  registerRoutes(app, repo); // sem hooks: chamador = key (testes de contrato do campo)
  t.after(() => app.close());

  const created = (await app.inject({
    method: "POST", url: "/api/auth/users",
    payload: { id: "x", name: "X", password: "abcd1234", screens: ["pipeline", "nada", "tasks"] },
  })).json();
  assert.deepEqual(created.screens, ["pipeline", "tasks"]);

  const patched = (await app.inject({ method: "PATCH", url: "/api/auth/users/x", payload: { screens: [] } })).json();
  assert.deepEqual(patched.screens, []);
});

// ── Piso por papel (ROLE_SCREENS) ───────────────────────────────────────────
// O closer Vitor não conseguiu gerar link de pagamento em 24/08/2026 porque
// faltava "offers" na lista de telas dele. Gerar link é o meio de vida do
// closer: o papel garante o piso, sem depender de alguém marcar a caixinha.

test("closer com lista restrita alcança Links de pagamento e o pipeline pelo PAPEL", async (t) => {
  const repo = makeMemRepo();
  await seedTestAdmins(repo);
  // Lista restrita que NÃO tem offers nem pipeline: é o caso do Vitor.
  await repo.create("users", {
    id: "vitor", name: "Vitor", roles: ["closer"],
    screens: ["today", "tasks"], passwordHash: hashPassword("1234"),
  });
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Novo lead", conv: 1 }] });
  const app = buildApp(repo);
  t.after(() => app.close());
  const H = { "x-api-key": await loginToken(app, "vitor", "1234") };

  // A tela de Links de pagamento (histórico + baixa manual): liberada pelo papel.
  assert.equal((await app.inject({ url: "/api/payment-links?saas=leverads", headers: H })).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: "/api/payment-links/pl_x/pay", headers: H, payload: { method: "pix" } })).statusCode, 404, "passa do guard (404 = link inexistente, não 403)");
  // O pipeline, de onde ele gera o link do lead.
  assert.equal((await app.inject({ url: "/api/leads", headers: H })).statusCode, 200);
  // O piso é PISO, não teto: o que ele não tem por papel nem por lista segue 403.
  for (const url of ["/api/expenses", "/api/forms", "/api/marketing/leverads"]) {
    assert.equal((await app.inject({ url, headers: H })).statusCode, 403, `esperava 403 em ${url}`);
  }
});

test("piso do papel não vaza dado sensível: remuneração segue exigindo admin ou tela na mão", async (t) => {
  const repo = makeMemRepo();
  await seedTestAdmins(repo);
  await repo.create("users", {
    id: "vitor", name: "Vitor", roles: ["closer"],
    screens: ["today"], passwordHash: hashPassword("1234"),
  });
  const app = buildApp(repo);
  t.after(() => app.close());
  const H = { "x-api-key": await loginToken(app, "vitor", "1234") };
  assert.equal((await app.inject({ url: "/api/comp_plans", headers: H })).statusCode, 403);
});

// (`offers` saiu deste teste de propósito: desde 27/08/2026 os Links de
// pagamento valem pra toda sessão — UNIVERSAL_SCREENS. O que se garante aqui
// continua sendo que o PISO de um papel não vaza pros outros.)
test("papel sem piso definido (sdr) não ganha nada de graça", async (t) => {
  const repo = makeMemRepo();
  await seedTestAdmins(repo);
  await repo.create("users", {
    id: "manu", name: "Manuela", roles: ["sdr"],
    screens: ["today"], passwordHash: hashPassword("1234"),
  });
  await repo.create("products", { id: "leverads", name: "LeverAds", funnel: [{ stage: "Novo lead", conv: 1 }] });
  const app = buildApp(repo);
  t.after(() => app.close());
  const H = { "x-api-key": await loginToken(app, "manu", "1234") };
  assert.equal((await app.inject({ url: "/api/proposals", headers: H })).statusCode, 403);
  assert.equal((await app.inject({ url: "/api/contracts", headers: H })).statusCode, 403);
});

// Gestão do time exige a etiqueta `admin`: com a tela Ajustes (ou sem restrição
// de telas) dava para se promover a admin ou resetar a senha de um admin.
test("gestão do time: só a etiqueta admin cria, edita, reseta senha e remove", async () => {
  const repo = makeMemRepo();
  await seedTestAdmins(repo);
  await repo.create("users", { id: "dono", name: "Dono", role: "admin", roles: ["admin"], passwordHash: hashPassword("1234") });
  await repo.create("users", { id: "ops", name: "Ops", role: "admin", roles: ["closer"], passwordHash: hashPassword("1234") });
  const app = buildApp(repo);
  const ops = { "x-api-key": await loginToken(app, "ops", "1234") };
  const dono = { "x-api-key": await loginToken(app, "dono", "1234") };

  // sem a etiqueta: lê a lista (pickers), mas não escreve
  assert.equal((await app.inject({ method: "GET", url: "/api/auth/users", headers: ops })).statusCode, 200);
  assert.equal((await app.inject({ method: "PATCH", url: "/api/auth/users/ops", headers: ops, payload: { roles: ["closer", "admin"] } })).statusCode, 403);
  assert.equal((await app.inject({ method: "PATCH", url: "/api/auth/users/dono", headers: ops, payload: { password: "tomada-de-conta" } })).statusCode, 403);
  assert.equal((await app.inject({ method: "POST", url: "/api/auth/users", headers: ops, payload: { name: "Novo", password: "abcd1234" } })).statusCode, 403);
  assert.equal((await app.inject({ method: "DELETE", url: "/api/auth/users/leonardo", headers: ops })).statusCode, 403);
  assert.deepEqual((await repo.get("users", "ops")).roles, ["closer"]);
  // o próprio perfil segue editável
  assert.equal((await app.inject({ method: "PATCH", url: "/api/auth/me", headers: ops, payload: { name: "Ops Silva" } })).statusCode, 200);

  // com a etiqueta: gerencia
  assert.equal((await app.inject({ method: "POST", url: "/api/auth/users", headers: dono, payload: { name: "Novo", password: "abcd1234" } })).statusCode, 201);
  assert.equal((await app.inject({ method: "PATCH", url: "/api/auth/users/ops", headers: dono, payload: { password: "nova-senha-ops" } })).statusCode, 200);
  // key mestre (MCP/integrações) continua passando
  assert.equal((await app.inject({ method: "PATCH", url: "/api/auth/users/ops", headers: { "x-api-key": "test-key" }, payload: { compLevel: 2 } })).statusCode, 200);
});
