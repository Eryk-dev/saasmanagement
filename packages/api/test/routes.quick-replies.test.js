// Respostas rápidas do Suporte: da equipe (por produto, edita quem tem
// Configurações de SLA) e pessoais (só o dono), com variáveis embutidas e
// customizadas resolvidas pelo servidor no contexto do ticket.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeAuthHook, hashPassword } from "../src/auth.js";
import { makeScreenGuardHook, screenForRequest } from "../src/screens.js";
import { renderTemplate, BUILTIN_VARIABLES, RESERVED_VARIABLE_KEYS, sanitizeVariables, slugShortcut } from "../src/quick-replies.js";

const { registerRoutes } = await import("../src/routes.js");

const USERS = [
  { id: "lia", name: "Lia Souza", roles: ["support"], supportSaas: ["alpha"], screens: ["tickets", "quick_replies"] },
  { id: "mia", name: "Mia Rocha", roles: ["support"], supportSaas: ["alpha"], screens: ["tickets"] },
  { id: "beto", name: "Beto Beta", roles: ["support"], supportSaas: ["beta"], screens: ["tickets", "quick_replies"] },
  { id: "gi", name: "Gi Gestora", roles: [], supportSaas: ["alpha"], screens: ["tickets", "quick_replies", "support_settings"] },
  { id: "caio", name: "Caio", roles: ["sdr"], screens: ["today"] },
];

async function buildApp() {
  const repo = makeMemRepo();
  for (const u of USERS) await repo.create("users", { ...u, role: "admin", passwordHash: hashPassword("1234") });
  await repo.create("products", { id: "alpha", name: "Alpha" });
  await repo.create("products", { id: "beta", name: "Beta" });
  await repo.create("customers", { id: "c1", saas: "alpha", name: "Loja Alpha", contact: "Carla Nunes", email: "carla@loja.com" });
  const app = Fastify();
  app.addHook("onRequest", makeAuthHook({ apiKey: "test-key", repo, openPaths: new Set(["/api/auth/login"]), openPrefixes: [], providedKey: (req) => req.headers["x-api-key"] || "" }));
  app.addHook("onRequest", makeScreenGuardHook());
  registerRoutes(app, repo);
  const as = { key: { "x-api-key": "test-key" } };
  for (const u of USERS) as[u.id] = { "x-api-key": (await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: u.id, password: "1234" } })).json().token };
  const call = (who, method, url, payload) => app.inject({ method, url, headers: { ...as[who], host: "localhost:8787" }, ...(payload !== undefined ? { payload } : {}) });
  return { app, repo, call };
}

test("renderTemplate: embutidas, customizadas, desconhecidas e vazias", () => {
  const r = renderTemplate("{{saudacao}}, {{ cliente.primeiro_nome }}! {{horario}} {{nao_existe}} {{cliente.email}}", { saudacao: "Bom dia", "cliente.primeiro_nome": "Carla", horario: "9h às 18h", "cliente.email": "" });
  assert.equal(r.text, "Bom dia, Carla! 9h às 18h {{nao_existe}} ");
  assert.deepEqual(r.missing, ["nao_existe"]);
  assert.deepEqual(r.empty, ["cliente.email"]);
  // Toda embutida sem ponto é reservada: a customizada não a sobrescreve.
  for (const v of BUILTIN_VARIABLES) if (!v.key.includes(".")) assert.ok(RESERVED_VARIABLE_KEYS.has(v.key), v.key);
  assert.deepEqual(sanitizeVariables([{ key: "Horario_Atendimento", value: "9h" }, { key: "hoje", value: "x" }, { key: "cliente.nome", value: "x" }, { key: "horario_atendimento", value: "dup" }]).map((v) => v.key), ["horario_atendimento"]);
  assert.equal(slugShortcut("Boas-vindas ao Cliente!"), "boas-vindas-ao-cliente");
});

test("equipe x pessoal: quem vê, quem edita e o isolamento por produto", async (t) => {
  const { app, repo, call } = await buildApp();
  t.after(() => app.close());

  // Só quem tem Configurações de SLA cria da equipe.
  let r = await call("lia", "POST", "/api/support/quick-replies", { saas: "alpha", title: "Boas-vindas", body: "{{saudacao}}!" });
  assert.equal(r.statusCode, 403);
  assert.equal(r.json().code, "shared_forbidden");
  r = await call("gi", "POST", "/api/support/quick-replies", { saas: "alpha", title: "Boas-vindas", body: "{{saudacao}}, {{cliente.primeiro_nome}}!" });
  assert.equal(r.statusCode, 201, r.body);
  const shared = r.json();
  assert.equal(shared.scope, "shared");
  assert.equal(shared.shortcut, "boas-vindas");

  // Pessoal: qualquer atendente, e o atalho pode repetir o da equipe.
  r = await call("lia", "POST", "/api/support/quick-replies", { scope: "personal", saas: "", title: "Minha assinatura", shortcut: "boas-vindas", body: "Abraço, {{atendente.primeiro_nome}}" });
  assert.equal(r.statusCode, 201, r.body);
  const mine = r.json();
  assert.equal(mine.owner, "lia");
  assert.equal((await call("lia", "POST", "/api/support/quick-replies", { scope: "personal", title: "Outra", shortcut: "boas-vindas", body: "x" })).json().code, "shortcut_taken");

  // Lista: Lia vê a da equipe (sem editar) e a dela; Mia só a da equipe.
  const liaList = (await call("lia", "GET", "/api/support/quick-replies?saas=alpha")).json();
  assert.deepEqual(liaList.items.map((q) => [q.title, q.editable]).sort(), [["Boas-vindas", false], ["Minha assinatura", true]]);
  assert.equal(liaList.canEditShared, false);
  assert.ok(liaList.variables.builtin.some((v) => v.key === "cliente.primeiro_nome"));
  assert.deepEqual((await call("mia", "GET", "/api/support/quick-replies?saas=alpha")).json().items.map((q) => q.title), ["Boas-vindas"]);
  assert.equal((await call("beto", "GET", "/api/support/quick-replies?saas=alpha")).statusCode, 404, "produto fora do escopo");
  assert.equal((await call("caio", "GET", "/api/support/quick-replies?saas=alpha")).statusCode, 403, "sem tela");

  // Editar/apagar: equipe só gestor; pessoal só o dono (os outros nem enxergam).
  assert.equal((await call("lia", "PATCH", `/api/support/quick-replies/${shared.id}`, { title: "x" })).statusCode, 403);
  assert.equal((await call("mia", "PATCH", `/api/support/quick-replies/${mine.id}`, { title: "x" })).statusCode, 404);
  assert.equal((await call("gi", "DELETE", `/api/support/quick-replies/${mine.id}`)).statusCode, 404, "nem o gestor mexe na pessoal dos outros");
  r = await call("lia", "PATCH", `/api/support/quick-replies/${mine.id}`, { body: "Até mais, {{atendente.primeiro_nome}}" });
  assert.equal(r.json().body, "Até mais, {{atendente.primeiro_nome}}");
  assert.equal((await call("gi", "PATCH", `/api/support/quick-replies/${shared.id}`, { title: "Boas-vindas v2" })).json().title, "Boas-vindas v2");

  // Validações e porta dos fundos.
  assert.equal((await call("gi", "POST", "/api/support/quick-replies", { saas: "alpha", title: "", body: "x" })).json().code, "title_required");
  assert.equal((await call("gi", "POST", "/api/support/quick-replies", { saas: "beta", title: "x", body: "x" })).json().code, "saas_out_of_scope");
  assert.equal((await call("key", "GET", "/api/quick_replies")).statusCode, 404);
  assert.equal((await call("lia", "DELETE", `/api/support/quick-replies/${mine.id}`)).statusCode, 200);
  assert.equal(await repo.get("quick_replies", mine.id), null);
});

test("inserir no ticket resolve as variáveis do ticket e das configurações, e conta o uso", async (t) => {
  const { app, repo, call } = await buildApp();
  t.after(() => app.close());
  await call("gi", "PUT", "/api/support/settings/alpha", { variables: [{ key: "horario_atendimento", value: "seg a sex, 9h às 18h", label: "Horário" }] });
  const qr = (await call("gi", "POST", "/api/support/quick-replies", {
    saas: "alpha", title: "Recebido",
    body: "{{saudacao}}, {{cliente.primeiro_nome}}! Recebemos o chamado #{{ticket.numero}} ({{ticket.assunto}}) da {{cliente.empresa}}. Atendemos {{horario_atendimento}}. Acompanhe: {{ticket.link}} — {{atendente.nome}}, {{produto.nome}}. {{telefone_extra}}",
  })).json();
  const tk = (await call("key", "POST", "/api/tickets", { saas: "alpha", subject: "Painel fora", customerId: "c1" })).json();

  const r = await call("lia", "POST", `/api/tickets/${tk.id}/quick-replies/${qr.id}/render`);
  assert.equal(r.statusCode, 200, r.body);
  const out = r.json();
  assert.match(out.text, /^(Bom dia|Boa tarde|Boa noite), Carla! Recebemos o chamado #1 \(Painel fora\) da Loja Alpha\. Atendemos seg a sex, 9h às 18h\./);
  assert.ok(out.text.includes(`http://localhost:8787/s/${tk.portalToken}`));
  assert.ok(out.text.includes("Lia Souza, Alpha"));
  assert.deepEqual(out.missing, ["telefone_extra"], "variável desconhecida volta pra tela avisar");
  assert.equal((await repo.get("quick_replies", qr.id)).uses, 1);

  // Prévia da página: mesma função, com exemplo nas variáveis do ticket.
  const prev = (await call("lia", "POST", "/api/support/quick-replies/preview", { saas: "alpha", body: "Oi {{cliente.primeiro_nome}}, {{horario_atendimento}} — {{atendente.primeiro_nome}}" })).json();
  assert.equal(prev.text, "Oi Carla, seg a sex, 9h às 18h — Lia");

  // Ticket de outro produto ou fora do escopo não resolve.
  const tkBeta = (await call("key", "POST", "/api/tickets", { saas: "beta", subject: "b" })).json();
  assert.equal((await call("lia", "POST", `/api/tickets/${tkBeta.id}/quick-replies/${qr.id}/render`)).statusCode, 404);
  assert.equal((await call("key", "POST", `/api/tickets/${tkBeta.id}/quick-replies/${qr.id}/render`)).statusCode, 404, "resposta de alpha não vale em ticket de beta");
  // Variável customizada inválida ou reservada não entra.
  const saved = (await call("gi", "PUT", "/api/support/settings/alpha", { variables: [{ key: "hoje", value: "x" }, { key: "1ruim", value: "x" }, { key: "ok_var", value: "v" }] })).json();
  assert.deepEqual(saved.variables.map((v) => v.key), ["ok_var"]);
});

test("guard: página e chat alcançam as respostas; configurações seguem na tela de SLA", () => {
  assert.deepEqual(screenForRequest("GET", "/api/support/quick-replies"), ["quick_replies", "tickets"]);
  assert.deepEqual(screenForRequest("POST", "/api/tickets/t1/quick-replies/q1/render"), ["tickets"]);
  assert.deepEqual(screenForRequest("GET", "/api/support/settings/alpha"), ["support_settings", "tickets", "quick_replies"]);
  assert.deepEqual(screenForRequest("PUT", "/api/support/settings/alpha"), ["support_settings"]);
});
