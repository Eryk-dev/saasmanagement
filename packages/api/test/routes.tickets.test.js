// Suporte (tickets): isolamento por produto no servidor (support-scope.js),
// conversa com resposta pública x nota interna, SLA, atendentes e
// configurações por produto.

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeAuthHook, hashPassword } from "../src/auth.js";
import { makeScreenGuardHook, screenForRequest } from "../src/screens.js";

const { registerRoutes } = await import("../src/routes.js");

const USERS = [
  { id: "lia", name: "Lia Atendente", roles: ["support"], supportSaas: ["alpha"], screens: ["tickets"] },
  { id: "mia", name: "Mia Suporte", roles: ["support"], supportSaas: ["alpha"], screens: ["tickets"] },
  { id: "beto", name: "Beto Beta", roles: ["support"], supportSaas: ["beta"], screens: ["tickets"] },
  { id: "bia", name: "Bia Sem Produto", roles: ["support"], supportSaas: [], screens: ["tickets"] },
  { id: "gi", name: "Gi Gestora", roles: [], supportSaas: ["alpha"], screens: ["tickets", "support_settings"] },
  { id: "dono", name: "Dono", roles: ["admin"], screens: [] },
  { id: "caio", name: "Caio Comercial", roles: ["sdr"], screens: ["today"] },
];

async function buildApp({ mailer = null } = {}) {
  const repo = makeMemRepo();
  for (const u of USERS) await repo.create("users", { ...u, role: "admin", passwordHash: hashPassword("1234") });
  await repo.create("products", { id: "alpha", name: "Alpha" });
  await repo.create("products", { id: "beta", name: "Beta" });
  await repo.create("customers", { id: "c1", saas: "alpha", name: "Loja Alpha", contact: "Carla Cliente", email: "Carla@Loja.com", phone: "11999", leadId: "l1" });
  await repo.create("customers", { id: "c2", saas: "beta", name: "Loja Beta" });
  const app = Fastify();
  await app.register(multipart);
  app.addHook("onRequest", makeAuthHook({
    apiKey: "test-key", repo,
    openPaths: new Set(["/api/auth/login"]), openPrefixes: [],
    providedKey: (req) => req.headers["x-api-key"] || "",
  }));
  app.addHook("onRequest", makeScreenGuardHook());
  registerRoutes(app, repo, mailer ? { mailer } : {});
  const as = {};
  for (const u of USERS) {
    as[u.id] = { "x-api-key": (await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: u.id, password: "1234" } })).json().token };
  }
  as.key = { "x-api-key": "test-key" };
  const call = (who, method, url, payload) => app.inject({ method, url, headers: as[who], ...(payload !== undefined ? { payload } : {}) });
  return { app, repo, call };
}

test("isolamento por produto: fora do escopo é 404, criar é 403, lista vazia sem produto", async (t) => {
  const { app, repo, call } = await buildApp();
  t.after(() => app.close());

  const beta = (await call("key", "POST", "/api/tickets", { saas: "beta", subject: "Erro no Beta" })).json();
  const alpha = (await call("lia", "POST", "/api/tickets", { saas: "alpha", subject: "Dúvida no Alpha" })).json();
  assert.equal(alpha.number, 2);
  assert.equal(beta.number, 1);

  assert.deepEqual((await call("lia", "GET", "/api/tickets")).json().map((x) => x.id), [alpha.id]);
  assert.deepEqual((await call("lia", "GET", "/api/tickets?saas=beta")).json(), []);
  assert.equal((await call("lia", "GET", `/api/tickets/${beta.id}`)).statusCode, 404);
  assert.equal((await call("lia", "PATCH", `/api/tickets/${beta.id}`, { priority: "urgent" })).statusCode, 404);
  assert.equal((await call("lia", "POST", `/api/tickets/${beta.id}/messages`, { text: "oi" })).statusCode, 404);
  assert.equal((await call("lia", "GET", `/api/tickets/${beta.id}/activity`)).statusCode, 404);
  const denied = await call("lia", "POST", "/api/tickets", { saas: "beta", subject: "x" });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.json().code, "saas_out_of_scope");
  const bulk = (await call("lia", "POST", "/api/tickets/bulk", { ids: [alpha.id, beta.id], action: "priority", value: "high" })).json();
  assert.deepEqual(bulk.ok, [alpha.id]);
  assert.deepEqual(bulk.missing, [beta.id]);
  assert.equal((await repo.get("tickets", beta.id)).priority, "normal");

  assert.deepEqual((await call("bia", "GET", "/api/tickets")).json(), [], "sem produto no escopo, nenhum ticket");
  assert.equal((await call("dono", "GET", "/api/tickets")).json().length, 2, "admin vê todos");
  assert.equal((await call("key", "GET", "/api/tickets")).json().length, 2, "chave mestre vê todos");
  assert.equal((await call("caio", "GET", "/api/tickets")).statusCode, 403, "sem a tela, nem chega na rota");

  // Nenhuma porta dos fundos pelo CRUD genérico.
  for (const c of ["ticket_events", "ticket_assets", "ticket_settings"]) {
    assert.equal((await call("key", "GET", `/api/${c}`)).statusCode, 404, c);
  }
  assert.equal((await call("key", "DELETE", `/api/ticket_events/x`)).statusCode, 404);
});

test("criação, responsável, conversa (resposta x nota), SLA e notificações", async (t) => {
  const { app, repo, call } = await buildApp();
  t.after(() => app.close());

  const created = await call("key", "POST", "/api/tickets", { saas: "alpha", subject: "Não consigo logar", customerId: "c1", priority: "urgent", category: "Problema técnico" });
  assert.equal(created.statusCode, 201, created.body);
  const tk = created.json();
  assert.equal(tk.status, "new");
  assert.deepEqual(tk.requester, { name: "Carla Cliente", email: "carla@loja.com", phone: "11999" });
  assert.equal(tk.leadId, "l1");
  assert.match(tk.portalToken, /^[0-9a-f]{32}$/);
  assert.ok(tk.sla.firstResponseDue && tk.sla.resolutionDue);
  // ticket novo sem responsável avisa os atendentes do produto
  const newFor = async (u) => (await repo.listWhere("notifications", { user: u, type: "ticket_new" })).length;
  assert.equal(await newFor("lia"), 1);
  assert.equal(await newFor("mia"), 1);
  assert.equal(await newFor("beto"), 0, "atendente de outro produto não recebe");
  const notif = (await repo.listWhere("notifications", { user: "lia" }))[0];
  assert.deepEqual(notif.link, { screen: "tickets", thread: tk.id });

  // cliente de outro produto e responsável sem o produto são recusados
  assert.equal((await call("lia", "PATCH", `/api/tickets/${tk.id}`, { customerId: "c2" })).json().code, "customer_other_saas");
  assert.equal((await call("lia", "PATCH", `/api/tickets/${tk.id}`, { assignee: "beto" })).json().code, "assignee_out_of_scope");
  assert.equal((await call("lia", "PATCH", `/api/tickets/${tk.id}`, { saas: "beta" })).json().code, "saas_immutable");

  let r = await call("lia", "PATCH", `/api/tickets/${tk.id}`, { assignee: "mia" });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().status, "open", "atribuir tira de Novo");
  assert.equal((await repo.listWhere("notifications", { user: "mia", type: "ticket_assigned" })).length, 1);

  // nota interna com menção não conta como 1ª resposta
  r = await call("mia", "POST", `/api/tickets/${tk.id}/messages`, { kind: "note", text: "@Lia Atendente viu esse erro antes?" });
  assert.equal(r.statusCode, 201, r.body);
  assert.equal(r.json().ticket.sla.firstResponseAt, "");
  assert.deepEqual(r.json().message.mentions, ["lia"]);
  assert.equal((await repo.listWhere("notifications", { user: "lia", type: "ticket_mention" })).length, 1);

  // resposta pública + aguardar cliente: marca a 1ª resposta e pausa a resolução
  r = await call("mia", "POST", `/api/tickets/${tk.id}/messages`, { kind: "reply", text: "Pode limpar o cache e tentar de novo?", status: "pending_customer" });
  const after = r.json().ticket;
  assert.ok(after.sla.firstResponseAt);
  assert.equal(after.status, "pending_customer");
  assert.ok(after.sla.pausedAt);
  assert.equal(after.lastAgentAt, after.sla.firstResponseAt);
  assert.equal(r.json().emailed, false, "sem mailer não manda e-mail");

  // lista traz resumo, sem a conversa
  const row = (await call("lia", "GET", "/api/tickets?status=pending_customer")).json()[0];
  assert.equal(row.messages, undefined);
  assert.equal(row.messageCount, 2);
  assert.equal(row.lastMessage.kind, "reply");

  const activity = (await call("lia", "GET", `/api/tickets/${tk.id}/activity`)).json().map((e) => e.type);
  for (const type of ["created", "assigned", "message", "status_changed"]) assert.ok(activity.includes(type), type);

  // status inválido e mensagem vazia
  assert.equal((await call("lia", "PATCH", `/api/tickets/${tk.id}`, { status: "done" })).json().code, "status_invalid");
  assert.equal((await call("lia", "POST", `/api/tickets/${tk.id}/messages`, { text: "  " })).json().code, "message_empty");

  // resolver fecha o relógio; fechar carimba closedAt
  r = await call("mia", "PATCH", `/api/tickets/${tk.id}`, { status: "closed" });
  assert.ok(r.json().closedAt);
  assert.ok(r.json().sla.resolvedAt);
  assert.equal(r.json().sla.pausedAt, "");

  // apagar: só admin
  assert.equal((await call("lia", "DELETE", `/api/tickets/${tk.id}`)).statusCode, 403);
  assert.equal((await call("dono", "DELETE", `/api/tickets/${tk.id}`)).statusCode, 200);
  assert.equal(await repo.get("tickets", tk.id), null);
  assert.equal((await repo.listWhere("ticket_events", { ticket: tk.id })).length, 0);
  assert.equal((await repo.listWhere("notifications", { task: tk.id })).length, 0);
});

const mpPayload = (boundary, name, mime, bytes) => Buffer.concat([
  Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${name}"\r\ncontent-type: ${mime}\r\n\r\n`),
  bytes, Buffer.from(`\r\n--${boundary}--\r\n`),
]);

test("anexos ficam presos ao ticket e respeitam o escopo", async (t) => {
  const { app, repo, call } = await buildApp();
  t.after(() => app.close());
  const a = (await call("key", "POST", "/api/tickets", { saas: "alpha", subject: "A" })).json();
  const b = (await call("key", "POST", "/api/tickets", { saas: "alpha", subject: "B" })).json();
  const boundary = "----tickettest";
  const up = await app.inject({
    method: "POST", url: `/api/tickets/${a.id}/attachments`,
    headers: { "x-api-key": "test-key", "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: mpPayload(boundary, "print.png", "image/png", Buffer.from("fake-png")),
  });
  assert.equal(up.statusCode, 201, up.body);
  const att = up.json().attachment;
  assert.equal(att.public, false, "anexo do atendente nasce interno");
  assert.equal((await repo.get("ticket_assets", att.id)).ticket, a.id);

  assert.equal((await call("lia", "GET", `/api/tickets/${a.id}/attachments/${att.id}`)).statusCode, 200);
  assert.equal((await call("lia", "GET", `/api/tickets/${b.id}/attachments/${att.id}`)).statusCode, 404, "id de anexo de outro ticket não serve");
  assert.equal((await call("beto", "GET", `/api/tickets/${a.id}/attachments/${att.id}`)).statusCode, 404);

  // citado numa resposta pública, passa a ser visível no portal
  const r = (await call("lia", "POST", `/api/tickets/${a.id}/messages`, { text: "segue o print", attachments: [att.id, "tia_inexistente"] })).json();
  assert.deepEqual(r.message.attachments, [att.id]);
  assert.equal(r.ticket.attachments[0].public, true);

  const del = await call("lia", "DELETE", `/api/tickets/${a.id}/attachments/${att.id}`);
  assert.equal(del.statusCode, 200);
  assert.equal(await repo.get("ticket_assets", att.id), null);
  assert.deepEqual(del.json().messages[0].attachments, []);
});

test("configurações de SLA e atendentes: tela + escopo", async (t) => {
  const { app, repo, call } = await buildApp();
  t.after(() => app.close());

  // quem só tem a fila lê as configurações, mas não edita
  const read = await call("lia", "GET", "/api/support/settings/alpha");
  assert.equal(read.statusCode, 200);
  assert.equal(read.json().policies.urgent.firstResponseMin, 60);
  assert.equal((await call("lia", "PUT", "/api/support/settings/alpha", { warnAt: 0.9 })).statusCode, 403);
  assert.equal((await call("lia", "GET", "/api/support/settings/beta")).statusCode, 404);
  assert.equal((await call("lia", "GET", "/api/support/agents")).statusCode, 200);

  let r = await call("gi", "PUT", "/api/support/settings/alpha", { policies: { urgent: { firstResponseMin: 30 } }, categories: ["Acesso", "Acesso", ""], portal: { enabled: true } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().policies.urgent.firstResponseMin, 30);
  assert.equal(r.json().policies.urgent.resolutionMin, 480, "o resto da política fica");
  assert.deepEqual(r.json().categories, ["Acesso"]);
  assert.equal(r.json().portal.enabled, true);
  assert.equal(r.json().updatedBy, "gi");
  assert.equal((await call("gi", "PUT", "/api/support/settings/beta", { warnAt: 0.9 })).statusCode, 404);
  assert.equal((await call("gi", "PUT", "/api/support/settings/alpha", { policies: { low: { firstResponseMin: 500, resolutionMin: 100 } } })).json().code, "policy_invalid");

  // novo ticket usa a política gravada
  const tk = (await call("key", "POST", "/api/tickets", { saas: "alpha", subject: "x", priority: "urgent" })).json();
  assert.equal(new Date(tk.sla.firstResponseDue) > new Date(tk.createdAt), true);

  // gestora sem admin só mexe nos produtos do próprio escopo
  r = await call("gi", "PUT", "/api/support/agents/bia", { supportSaas: ["alpha", "beta"], support: true });
  assert.deepEqual(r.json().supportSaas, ["alpha"]);
  r = await call("gi", "PUT", "/api/support/agents/beto", { supportSaas: [] });
  assert.deepEqual(r.json().supportSaas, ["beta"], "não tira produto que ela não atende");
  r = await call("dono", "PUT", "/api/support/agents/beto", { supportSaas: ["alpha", "beta", "fantasma"] });
  assert.deepEqual(r.json().supportSaas, ["alpha", "beta"], "admin mexe em tudo; produto inexistente cai");
  assert.equal((await call("lia", "PUT", "/api/support/agents/bia", { supportSaas: [] })).statusCode, 403);
  assert.deepEqual((await call("bia", "GET", "/api/auth/me")).json().supportSaas, ["alpha"], "a sessão enxerga o escopo novo");
  assert.equal((await call("bia", "GET", "/api/tickets")).json().length, 1);
  assert.equal((await repo.get("users", "bia")).roles.filter((x) => x === "support").length, 1);
});

test("Ajustes → Equipe destrava o primeiro atendente: etiqueta sozinha não libera, supportSaas sim", async (t) => {
  const { app, call } = await buildApp();
  t.after(() => app.close());
  await call("key", "POST", "/api/tickets", { saas: "alpha", subject: "a1" });
  // A etiqueta Suporte sozinha (o que foi marcado no banco local) não abre a fila.
  assert.deepEqual((await call("bia", "GET", "/api/tickets")).json(), []);
  // Quem tem Ajustes (dono, lista de telas vazia) inclui o produto pela Equipe.
  const r = await call("dono", "PATCH", "/api/auth/users/bia", { supportSaas: ["ALPHA", "fantasma"] });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(r.json().supportSaas, ["alpha"], "saneado: minúsculas e só produto existente");
  assert.equal((await call("bia", "GET", "/api/tickets")).json().length, 1);
  // Sem a tela Ajustes, a rota de gestão segue fechada.
  assert.equal((await call("lia", "PATCH", "/api/auth/users/lia", { supportSaas: ["beta"] })).statusCode, 403);
});

test("e-mail ao cliente só com o toggle, e-mail do solicitante e resposta pública", async (t) => {
  const sent = [];
  const mailer = { ready: async () => true, send: async (m) => { sent.push(m); return { id: "m1" }; } };
  const { app, call } = await buildApp({ mailer });
  t.after(() => app.close());
  const tk = (await call("key", "POST", "/api/tickets", { saas: "alpha", subject: "Fatura", customerId: "c1" })).json();

  let r = (await call("lia", "POST", `/api/tickets/${tk.id}/messages`, { text: "olhando" })).json();
  assert.equal(r.emailed, false, "toggle desligado por padrão");
  await call("key", "PUT", "/api/support/settings/alpha", { notifyCustomerByEmail: true });
  r = (await call("lia", "POST", `/api/tickets/${tk.id}/messages`, { kind: "note", text: "interno" })).json();
  assert.equal(r.emailed, false, "nota nunca vira e-mail");
  r = (await call("lia", "POST", `/api/tickets/${tk.id}/messages`, { text: "Resolvido, confere?" })).json();
  assert.equal(r.emailed, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "carla@loja.com");
  assert.match(sent[0].subject, /#1/);
  assert.ok(sent[0].text.includes(`/s/${tk.portalToken}`));
  // Link público: host local sai em http (https://localhost:8787 não abria);
  // host público sai em https.
  const local = await app.inject({ url: `/api/tickets/${tk.id}/portal-link`, headers: { "x-api-key": "test-key", host: "localhost:8787" } });
  assert.equal(local.json().url, `http://localhost:8787/s/${tk.portalToken}`);
  const pub = await app.inject({ url: `/api/tickets/${tk.id}/portal-link`, headers: { "x-api-key": "test-key", "x-forwarded-host": "cockpit.exemplo.com" } });
  assert.equal(pub.json().url, `https://cockpit.exemplo.com/s/${tk.portalToken}`);
  assert.ok(!sent[0].text.includes("interno"));
});

test("contadores do menu respeitam o escopo de suporte", async (t) => {
  const { app, call } = await buildApp();
  t.after(() => app.close());
  await call("key", "POST", "/api/tickets", { saas: "alpha", subject: "a1" });
  await call("key", "POST", "/api/tickets", { saas: "alpha", subject: "a2", assignee: "mia" });
  await call("key", "POST", "/api/tickets", { saas: "beta", subject: "b1" });
  const lia = (await call("lia", "GET", "/api/bootstrap")).json().COUNTERS;
  assert.equal(lia.alpha.tickets, 1, "sem dono conta; de outra pessoa não");
  assert.equal(lia.beta.tickets, 0, "produto fora do escopo não conta");
  const dono = (await call("dono", "GET", "/api/bootstrap")).json().COUNTERS;
  assert.equal(dono.beta.tickets, 1);
});

test("guard: rotas do suporte por tela", () => {
  assert.deepEqual(screenForRequest("POST", "/api/tickets/t1/messages"), ["tickets"]);
  assert.deepEqual(screenForRequest("PUT", "/api/support/settings/alpha"), ["support_settings"]);
  assert.deepEqual(screenForRequest("GET", "/api/support/settings/alpha"), ["support_settings", "tickets", "quick_replies"]);
  assert.deepEqual(screenForRequest("GET", "/api/support/agents"), ["support_settings", "tickets"]);
  assert.deepEqual(screenForRequest("PUT", "/api/support/agents/x"), ["support_settings"]);
});
