// Espelho ticket de suporte ↔ issue do Linear (ticket-linear.js + runner +
// webhook + rotas). O que está sob teste é o contrato dos dois sentidos:
// o ticket popula o projeto configurado, o que muda no Linear volta como status
// e NOTA INTERNA, e nada do que veio de lá é devolvido pra lá.

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeAuthHook, hashPassword } from "../src/auth.js";
import { makeScreenGuardHook } from "../src/screens.js";
import { normalizeSettings } from "../src/tickets-core.js";
import {
  planTicketSync, normalizeLinearSettings, issueKeyFromInput, clearStateCache,
  applyLinearIssue, applyLinearComment, LINEAR_PRIORITY,
} from "../src/ticket-linear.js";
import { startLinearSync } from "../src/ticket-linear-runner.js";
import { publicTicket } from "../src/support-page.js";

const { registerRoutes } = await import("../src/routes.js");

const WEBHOOK_SECRET = "segredo-do-linear";
const STATES = [
  { id: "st_backlog", name: "Backlog", type: "backlog" },
  { id: "st_todo", name: "Todo", type: "unstarted" },
  { id: "st_doing", name: "In Progress", type: "started" },
  { id: "st_done", name: "Done", type: "completed" },
  { id: "st_cancel", name: "Canceled", type: "canceled" },
];

// Linear de mentira: guarda issues e comentários em memória e conta as chamadas
// (é como o teste enxerga "o que foi mandado pra lá").
function makeFakeLinear({ configured = true } = {}) {
  const issues = new Map();
  const comments = [];
  const calls = { create: 0, update: 0, comment: 0 };
  let seq = 0;
  const shape = (i) => ({
    id: i.id, identifier: i.identifier, url: i.url, title: i.title, description: i.description,
    priority: i.priority, updatedAt: i.updatedAt,
    state: STATES.find((s) => s.id === i.stateId) || STATES[0],
    project: i.projectId ? { id: i.projectId, name: "Suporte" } : null,
    team: { id: "team_1", key: "ENG", name: "Engenharia" },
  });
  return {
    issues, comments, calls,
    configured: () => configured,
    catalog: async () => [{
      id: "team_1", key: "ENG", name: "Engenharia", states: STATES,
      projects: [{ id: "proj_1", name: "Suporte", state: "started" }],
    }],
    createIssue: async (input) => {
      calls.create++;
      seq += 1;
      const i = {
        id: `iss_${seq}`, identifier: `ENG-${seq}`, url: `https://linear.app/acme/issue/ENG-${seq}`,
        title: input.title, description: input.description, priority: input.priority ?? 0,
        projectId: input.projectId || "", stateId: input.stateId || "st_backlog", updatedAt: new Date().toISOString(),
      };
      issues.set(i.id, i);
      return shape(i);
    },
    updateIssue: async (id, input) => {
      calls.update++;
      const i = issues.get(id);
      if (!i) throw new Error("issue não existe");
      Object.assign(i, input, { stateId: input.stateId || i.stateId, updatedAt: new Date().toISOString() });
      return shape(i);
    },
    createComment: async (issueId, body) => {
      calls.comment++;
      const c = { id: `cmt_${comments.length + 1}`, issueId, body, createdAt: new Date().toISOString() };
      comments.push(c);
      return c;
    },
    issue: async (idOrKey) => {
      const found = [...issues.values()].find((i) => i.id === idOrKey || i.identifier === idOrKey);
      return found ? shape(found) : null;
    },
    issueWithComments: async (id) => {
      const i = issues.get(id);
      if (!i) return null;
      return {
        issue: { ...shape(i), createdAt: i.updatedAt },
        comments: comments.filter((c) => c.issueId === id)
          .map((c) => ({ id: c.id, body: c.body, createdAt: c.createdAt, url: "", user: { name: "Bot do Cockpit" } })),
      };
    },
    issuesUpdatedSince: async () => [...issues.values()].map((i) => ({ ...shape(i), comments: { nodes: [] } })),
    viewer: async () => ({ user: { id: "u1", name: "Bot do Cockpit" }, organization: { id: "o1", name: "Acme" } }),
  };
}

const USERS = [
  { id: "lia", name: "Lia Atendente", roles: ["support"], supportSaas: ["alpha"], screens: ["tickets", "support_settings"] },
  { id: "dono", name: "Dono", roles: ["admin"], screens: [] },
];

async function buildApp({ linear = makeFakeLinear() } = {}) {
  clearStateCache();
  const repo = makeMemRepo();
  for (const u of USERS) await repo.create("users", { ...u, role: "admin", passwordHash: hashPassword("1234") });
  await repo.create("products", { id: "alpha", name: "Alpha" });
  await repo.create("customers", { id: "c1", saas: "alpha", name: "Loja Alpha", contact: "Carla", email: "carla@loja.com" });
  const app = Fastify();
  await app.register(multipart);
  app.addHook("onRequest", makeAuthHook({
    apiKey: "test-key", repo,
    openPaths: new Set(["/api/auth/login"]), openPrefixes: ["/api/webhooks/"],
    providedKey: (req) => req.headers["x-api-key"] || "",
  }));
  app.addHook("onRequest", makeScreenGuardHook());
  registerRoutes(app, repo, { linear, webhooks: { linearSecret: WEBHOOK_SECRET } });
  const as = { key: { "x-api-key": "test-key" } };
  for (const u of USERS) {
    as[u.id] = { "x-api-key": (await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: u.id, password: "1234" } })).json().token };
  }
  const call = (who, method, url, payload) => app.inject({ method, url, headers: as[who], ...(payload !== undefined ? { payload } : {}) });
  // O runner fica sem timer: o teste drena/reconcilia na mão, no momento exato.
  const sync = startLinearSync(repo, { linear, autoStart: false, log: { info() {}, warn() {} } });
  return { app, repo, call, linear, sync };
}

const ligarEspelho = (call, extra = {}) =>
  call("lia", "PUT", "/api/support/settings/alpha", { linear: { enabled: true, teamId: "team_1", projectId: "proj_1", ...extra } });

const postWebhook = (app, body) => {
  const payload = JSON.stringify(body);
  return app.inject({
    method: "POST", url: "/api/webhooks/linear", payload,
    headers: {
      "content-type": "application/json",
      "linear-signature": crypto.createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex"),
    },
  });
};

test("configuração e plano: de-para de prioridade/estado e só a diferença sobe", () => {
  const cfg = normalizeLinearSettings({ enabled: true, teamId: "team_1", projectId: "proj_1", stateBack: { started: "open", backlog: "lixo" } });
  assert.equal(cfg.mirrorMessages, "all");
  assert.equal(cfg.stateBack.completed, "resolved"); // padrão
  assert.equal(cfg.stateBack.started, "open");
  assert.equal(cfg.stateBack.backlog, "", "status desconhecido não pode virar de-para");

  const settings = normalizeSettings({ linear: { enabled: true, teamId: "team_1", projectId: "proj_1" } }, "alpha");
  const ticket = {
    id: "tk1", number: 7, saas: "alpha", subject: "Erro no relatório", description: "não abre",
    status: "open", priority: "high", messages: [], requester: { name: "Carla" },
  };

  const criar = planTicketSync(ticket, settings, { states: STATES, baseUrl: "https://cockpit.app" });
  assert.equal(criar.action, "create");
  assert.equal(criar.input.teamId, "team_1");
  assert.equal(criar.input.projectId, "proj_1");
  assert.equal(criar.input.priority, LINEAR_PRIORITY.high);
  assert.equal(criar.input.title, "Erro no relatório");
  assert.match(criar.input.description, /Ticket #7/);
  assert.match(criar.input.description, /cockpit\.app\/#tickets\/tk1/);
  assert.equal(criar.input.stateId, undefined, "ticket novo não força coluna no Linear");

  // Já espelhado e sem mudança: nada sobe.
  const espelhado = { ...ticket, linear: { issueId: "iss_1", projectId: "proj_1", mirror: criar.mirror } };
  assert.equal(planTicketSync(espelhado, settings, { states: STATES, baseUrl: "https://cockpit.app" }).action, "noop");

  // Resolver cruza a fronteira aberto→concluído: aí sim mexe na coluna.
  const resolvido = planTicketSync({ ...espelhado, status: "resolved" }, settings, { states: STATES, baseUrl: "https://cockpit.app" });
  assert.equal(resolvido.action, "update");
  assert.equal(resolvido.input.stateId, "st_done");
  assert.deepEqual(Object.keys(resolvido.input), ["stateId"], "só o estado mudou");

  assert.equal(issueKeyFromInput("https://linear.app/acme/issue/ENG-42/erro"), "ENG-42");
  assert.equal(issueKeyFromInput(" eng-9 "), "ENG-9");
});

test("espelho automático: ticket novo vira issue, mensagens viram comentários, resolver fecha a issue", async (t) => {
  const { app, repo, call, linear, sync } = await buildApp();
  t.after(() => { sync.stop(); return app.close(); });

  await ligarEspelho(call);
  const ticket = (await call("lia", "POST", "/api/tickets", { saas: "alpha", subject: "Relatório vazio", description: "some tudo", priority: "urgent", customerId: "c1" })).json();

  assert.equal((await repo.list("linear_outbox")).length, 1, "o ticket entra na fila na hora em que é aberto");
  await sync.drain();
  assert.equal(linear.calls.create, 1);
  assert.equal((await repo.list("linear_outbox")).length, 0, "fila drenada");

  const [issue] = [...linear.issues.values()];
  assert.equal(issue.title, "Relatório vazio");
  assert.equal(issue.priority, LINEAR_PRIORITY.urgent);
  assert.equal(issue.projectId, "proj_1", "nasce no projeto pré-configurado");
  assert.match(issue.description, /Loja Alpha/);

  const salvo = await repo.get("tickets", ticket.id);
  assert.equal(salvo.linearIssueId, issue.id, "o id da issue fica no topo do doc (é por ele que o webhook acha o ticket)");
  assert.equal(salvo.linear.identifier, "ENG-1");
  const atividade = (await call("lia", "GET", `/api/tickets/${ticket.id}/activity`)).json();
  assert.ok(atividade.some((e) => e.type === "linear_linked"), "o vínculo aparece no histórico do ticket");

  // Resposta pública e nota interna viram comentário, uma vez só.
  await call("lia", "POST", `/api/tickets/${ticket.id}/messages`, { kind: "reply", text: "Estamos olhando" });
  await call("lia", "POST", `/api/tickets/${ticket.id}/messages`, { kind: "note", text: "parece o cache" });
  await sync.drain();
  assert.equal(linear.calls.comment, 2);
  assert.match(linear.comments[0].body, /Lia Atendente → cliente/);
  assert.match(linear.comments[1].body, /nota interna/);
  await sync.drain();
  assert.equal(linear.calls.comment, 2, "drenar de novo não repete comentário");

  // Resolver aqui fecha a issue lá.
  await call("lia", "PATCH", `/api/tickets/${ticket.id}`, { status: "resolved" });
  await sync.drain();
  assert.equal(linear.issues.get(issue.id).stateId, "st_done");
});

test("ligar o espelho popula o projeto com os tickets abertos, e só com eles", async (t) => {
  const { app, repo, call, linear, sync } = await buildApp();
  t.after(() => { sync.stop(); return app.close(); });

  const aberto = (await call("lia", "POST", "/api/tickets", { saas: "alpha", subject: "Aberto" })).json();
  const velho = (await call("lia", "POST", "/api/tickets", { saas: "alpha", subject: "Antigo" })).json();
  await call("lia", "PATCH", `/api/tickets/${velho.id}`, { status: "closed" });
  assert.equal((await repo.list("linear_outbox")).length, 0, "espelho desligado não enfileira nada");

  const r = (await ligarEspelho(call)).json();
  assert.equal(r.queued, 1);
  await sync.drain();
  assert.equal(linear.calls.create, 1);
  assert.equal((await repo.get("tickets", aberto.id)).linearIssueId, "iss_1");
  assert.equal((await repo.get("tickets", velho.id)).linearIssueId, "", "ticket já encerrado não vira backlog do time");
});

test("Linear → ticket: estado vira status, comentário vira aviso (sem cópia no ticket) e nada volta pro Linear", async (t) => {
  const { app, repo, call, linear, sync } = await buildApp();
  t.after(() => { sync.stop(); return app.close(); });

  await ligarEspelho(call);
  const ticket = (await call("lia", "POST", "/api/tickets", { saas: "alpha", subject: "Erro 500", customerId: "c1" })).json();
  await sync.drain();
  const [issue] = [...linear.issues.values()];
  const antes = { ...linear.calls };

  // Comentário do dev no Linear.
  const comentario = await postWebhook(app, {
    type: "Comment", action: "create", webhookTimestamp: Date.now(),
    data: { id: "cmt_dev", body: "corrigido no deploy de hoje", issueId: issue.id, user: { id: "u9", name: "Dev Duda" } },
  });
  assert.equal(comentario.statusCode, 200);
  const avisado = await repo.get("tickets", ticket.id);
  assert.equal(avisado.messages.length, 0, "o texto do comentário não é copiado pro ticket (vive na aba Linear)");
  assert.equal(avisado.status, "new", "comentário não mexe no status");
  assert.ok((avisado.linear.seenComments || []).includes("cmt_dev"), "mas fica registrado que já passou por aqui");

  // O registro é o evento na atividade + o aviso no sino de quem acompanha.
  const atividade = (await call("lia", "GET", `/api/tickets/${ticket.id}/activity`)).json();
  const ev = atividade.find((e) => e.type === "linear_comment");
  assert.ok(ev, "a atividade guarda que houve comentário");
  assert.equal(ev.data.author, "Dev Duda");
  assert.match(ev.data.excerpt, /corrigido no deploy/);
  const avisos = (await repo.list("notifications")).filter((n) => n.type === "ticket_linear_comment");
  assert.deepEqual(avisos.map((n) => n.user), ["lia"], "quem abriu o ticket é avisado");
  assert.match(avisos[0].text, /Dev Duda comentou em ENG-1/);

  // E nada disso chega ao cliente pelo portal.
  const publico = publicTicket(avisado, { users: [], product: { name: "Alpha" } });
  assert.ok(!JSON.stringify(publico).includes("corrigido no deploy"), "conversa de engenharia não vaza no portal");

  // Issue concluída no Linear resolve o ticket.
  const fechou = await postWebhook(app, {
    type: "Issue", action: "update", webhookTimestamp: Date.now(),
    data: { id: issue.id, identifier: issue.identifier, url: issue.url, title: issue.title, priority: issue.priority, state: { id: "st_done", name: "Done", type: "completed" } },
  });
  assert.equal(fechou.statusCode, 200);
  const resolvido = await repo.get("tickets", ticket.id);
  assert.equal(resolvido.status, "resolved");
  assert.equal(resolvido.linear.stateName, "Done");

  // Anti-ping-pong: nada do que veio do Linear entrou na fila de saída.
  assert.equal((await repo.list("linear_outbox")).length, 0);
  await sync.drain();
  assert.deepEqual(linear.calls, antes, "o que veio do Linear não é devolvido pro Linear");

  // Título editado lá vira o assunto aqui.
  await postWebhook(app, {
    type: "Issue", action: "update", webhookTimestamp: Date.now(),
    data: { id: issue.id, identifier: issue.identifier, url: issue.url, title: "Erro 500 no checkout", priority: 1, state: { id: "st_done", name: "Done", type: "completed" } },
  });
  const renomeado = await repo.get("tickets", ticket.id);
  assert.equal(renomeado.subject, "Erro 500 no checkout");
  assert.equal(renomeado.priority, "urgent");
  await sync.drain();
  assert.deepEqual(linear.calls, antes, "o espelho atualizado não reenvia o que o Linear acabou de mandar");
});

test("eco do webhook não reabre nem regride um ticket já encerrado", async (t) => {
  const { app, repo, call, linear, sync } = await buildApp();
  t.after(() => { sync.stop(); return app.close(); });

  await ligarEspelho(call);
  const ticket = (await call("lia", "POST", "/api/tickets", { saas: "alpha", subject: "Já resolvido" })).json();
  await sync.drain();
  const [issue] = [...linear.issues.values()];

  // O atendente FECHA o ticket; o espelho leva a issue pra Done e o Linear
  // devolve o mesmo estado pelo webhook.
  await call("lia", "PATCH", `/api/tickets/${ticket.id}`, { status: "closed" });
  await sync.drain();
  assert.equal(linear.issues.get(issue.id).stateId, "st_done");
  await postWebhook(app, {
    type: "Issue", action: "update", webhookTimestamp: Date.now(),
    data: { id: issue.id, identifier: issue.identifier, url: issue.url, title: issue.title, priority: issue.priority, state: { id: "st_done", name: "Done", type: "completed" } },
  });
  assert.equal((await repo.get("tickets", ticket.id)).status, "closed", "Fechado não vira Resolvido no eco do que nós mesmos mandamos");

  // Reabrir no Linear (volta pra In Progress) traz o ticket de volta.
  await postWebhook(app, {
    type: "Issue", action: "update", webhookTimestamp: Date.now(),
    data: { id: issue.id, identifier: issue.identifier, url: issue.url, title: issue.title, priority: issue.priority, state: { id: "st_doing", name: "In Progress", type: "started" } },
  });
  assert.equal((await repo.get("tickets", ticket.id)).status, "closed", "sem de-para configurado para 'em andamento', nada muda");

  await call("lia", "PUT", "/api/support/settings/alpha", { linear: { stateBack: { started: "open" } } });
  await postWebhook(app, {
    type: "Issue", action: "update", webhookTimestamp: Date.now(),
    data: { id: issue.id, identifier: issue.identifier, url: issue.url, title: issue.title, priority: issue.priority, state: { id: "st_doing", name: "In Progress", type: "started" } },
  });
  assert.equal((await repo.get("tickets", ticket.id)).status, "open", "com o de-para ligado, voltar a issue reabre o atendimento");
});

test("webhook do Linear: assinatura confere, comentário repetido não duplica, issue sem ticket é ignorada", async (t) => {
  const { app, repo, call, linear, sync } = await buildApp();
  t.after(() => { sync.stop(); return app.close(); });

  await ligarEspelho(call);
  const ticket = (await call("lia", "POST", "/api/tickets", { saas: "alpha", subject: "Lentidão" })).json();
  await sync.drain();
  const [issue] = [...linear.issues.values()];

  const body = JSON.stringify({ type: "Comment", action: "create", data: { id: "cmt_x", body: "oi", issueId: issue.id, user: { name: "Dev" } } });
  const semAssinatura = await app.inject({ method: "POST", url: "/api/webhooks/linear", payload: body, headers: { "content-type": "application/json" } });
  assert.equal(semAssinatura.statusCode, 401);
  const assinaturaErrada = await app.inject({
    method: "POST", url: "/api/webhooks/linear", payload: body,
    headers: { "content-type": "application/json", "linear-signature": crypto.createHmac("sha256", "outro").update(body).digest("hex") },
  });
  assert.equal(assinaturaErrada.statusCode, 401);
  assert.equal((await repo.get("tickets", ticket.id)).messages.length, 0, "sem assinatura válida, nada entra no ticket");

  const comentarios = async () => (await repo.listWhere("ticket_events", { ticket: ticket.id })).filter((e) => e.type === "linear_comment");
  const payload = { type: "Comment", action: "create", webhookTimestamp: Date.now(), data: { id: "cmt_x", body: "oi", issueId: issue.id, user: { name: "Dev" } } };
  assert.equal((await postWebhook(app, payload)).statusCode, 200);
  assert.equal((await postWebhook(app, payload)).statusCode, 200);
  assert.equal((await comentarios()).length, 1, "o mesmo comentário só vira um aviso");

  // A memória do que já entrou vive no VÍNCULO (seenComments): nem apagando a
  // atividade o comentário volta a ser anunciado.
  const doc = await repo.get("tickets", ticket.id);
  assert.ok((doc.linear.seenComments || []).includes("cmt_x"));
  for (const e of await comentarios()) await repo.remove("ticket_events", e.id);
  assert.equal((await postWebhook(app, payload)).statusCode, 200);
  assert.equal((await comentarios()).length, 0, "comentário já visto não é anunciado de novo");

  // Issue de outro time do workspace: 200 e segue a vida.
  const estranha = await postWebhook(app, {
    type: "Issue", action: "update", webhookTimestamp: Date.now(),
    data: { id: "iss_de_outro_time", title: "nada a ver", state: { id: "st_done", name: "Done", type: "completed" } },
  });
  assert.equal(estranha.statusCode, 200);
  assert.equal(estranha.json().ticket, null);

  // Reenvio antigo não é aplicado.
  const velho = await postWebhook(app, {
    type: "Comment", action: "create", webhookTimestamp: Date.now() - 60 * 60_000,
    data: { id: "cmt_velho", body: "replay", issueId: issue.id, user: { name: "Dev" } },
  });
  assert.equal(velho.body, "stale");
  assert.equal((await comentarios()).length, 0, "replay antigo não entra");
});

test("aba Linear: descrição e comentários da issue, separados da conversa do atendimento", async (t) => {
  const { app, repo, call, linear, sync } = await buildApp();
  t.after(() => { sync.stop(); return app.close(); });

  await ligarEspelho(call);
  const ticket = (await call("lia", "POST", "/api/tickets", { saas: "alpha", subject: "Relatório vazio", description: "some tudo" })).json();
  await sync.drain();
  const [issue] = [...linear.issues.values()];
  await call("lia", "POST", `/api/tickets/${ticket.id}/messages`, { kind: "reply", text: "Estamos olhando" });
  await sync.drain();
  await postWebhook(app, {
    type: "Comment", action: "create", webhookTimestamp: Date.now(),
    data: { id: "cmt_dev", body: "é o cache", issueId: issue.id, user: { name: "Dev Duda" } },
  });

  const aba = (await call("lia", "GET", `/api/tickets/${ticket.id}/linear`)).json();
  assert.equal(aba.linked, true);
  assert.equal(aba.identifier, "ENG-1");
  assert.match(aba.issue.description, /Ticket #1/, "a aba mostra a descrição que está NO LINEAR");
  assert.equal(aba.comments.length, 1);
  assert.equal(aba.comments[0].fromCockpit, true, "comentário que saiu do cockpit vem marcado");

  // A conversa do ticket fica só com o atendimento — o comentário do dev não
  // vira mensagem, só aviso.
  const doc = await repo.get("tickets", ticket.id);
  assert.deepEqual(doc.messages.map((m) => m.kind), ["reply"]);

  // Linear fora do ar: a aba não quebra, cai pro que está gravado e avisa.
  linear.issueWithComments = async () => { throw new Error("Linear -> 500: indisponível"); };
  const caiu = (await call("lia", "GET", `/api/tickets/${ticket.id}/linear`)).json();
  assert.equal(caiu.stale, true);
  assert.match(caiu.error, /indisponível/);
  assert.equal(caiu.identifier, "ENG-1", "o vínculo continua visível");
  assert.deepEqual(caiu.comments, [], "sem cópia local, não há o que mostrar offline — a aba avisa em vez de inventar");
});

test("aba Linear em ticket sem issue: responde vazia, sem chamar o Linear", async (t) => {
  const { app, call, linear, sync } = await buildApp();
  t.after(() => { sync.stop(); return app.close(); });

  const ticket = (await call("lia", "POST", "/api/tickets", { saas: "alpha", subject: "Sem espelho" })).json();
  const aba = (await call("lia", "GET", `/api/tickets/${ticket.id}/linear`)).json();
  assert.equal(aba.linked, false);
  assert.equal(aba.issue, null);
  assert.deepEqual(aba.comments, []);
  assert.equal(linear.calls.create, 0);
});

test("vincular e desvincular uma issue que já existe", async (t) => {
  const { app, repo, call, linear, sync } = await buildApp();
  t.after(() => { sync.stop(); return app.close(); });

  await ligarEspelho(call);
  const issue = await linear.createIssue({ teamId: "team_1", title: "Bug antigo", description: "relato original do dev" });
  const ticket = (await call("lia", "POST", "/api/tickets", { saas: "alpha", subject: "Cliente relatou o bug" })).json();
  await repo.remove("linear_outbox", `lq_${ticket.id}`); // a fila do "abriu agora" sai da frente

  const vinculado = (await call("lia", "POST", `/api/tickets/${ticket.id}/linear`, { issue: `https://linear.app/acme/issue/${issue.identifier}` })).json();
  assert.equal(vinculado.linear.issueId, issue.id);
  assert.equal(vinculado.linearIssueId, issue.id);
  assert.equal(linear.calls.create, 1, "vincular não cria issue nova");

  // Vinculado: o que vem de lá cai neste ticket.
  await postWebhook(app, {
    type: "Issue", action: "update", webhookTimestamp: Date.now(),
    data: { id: issue.id, identifier: issue.identifier, url: issue.url, title: "Bug antigo", priority: 0, state: { id: "st_cancel", name: "Canceled", type: "canceled" } },
  });
  assert.equal((await repo.get("tickets", ticket.id)).status, "closed");

  // O conteúdo escrito no Linear fica de pé: vincular não é reescrever. A única
  // coisa que sobe é o projeto, porque esta issue ainda não tinha nenhum.
  await sync.drain();
  const espelhada = linear.issues.get(issue.id);
  assert.equal(espelhada.description, "relato original do dev", "vincular não pode sobrescrever a descrição da issue");
  assert.equal(espelhada.title, "Bug antigo", "nem o título escrito lá");
  assert.equal(espelhada.priority, 0, "nem a prioridade (sem prioridade continua sem prioridade)");
  assert.equal(espelhada.projectId, "proj_1", "issue sem projeto é adotada pelo projeto do suporte");
  assert.equal(linear.calls.update, 1, "uma chamada só, e só com o projeto");

  // E segue protegida depois: editar o ticket nunca reescreve a descrição de
  // uma issue adotada (o relato mora lá, não aqui).
  await call("lia", "PATCH", `/api/tickets/${ticket.id}`, { subject: "Bug antigo, com detalhe novo" });
  await sync.drain();
  assert.equal(linear.issues.get(issue.id).description, "relato original do dev", "nem depois de editar o ticket");
  assert.equal(linear.issues.get(issue.id).title, "Bug antigo, com detalhe novo", "o título, sim, acompanha o ticket");

  const solto = (await call("lia", "DELETE", `/api/tickets/${ticket.id}/linear`)).json();
  assert.deepEqual(solto.linear, {});
  assert.equal(solto.linearIssueId, "");
  assert.equal([...linear.issues.values()].length, 1, "desvincular nunca apaga issue no Linear");
  const atividade = (await call("lia", "GET", `/api/tickets/${ticket.id}/activity`)).json();
  assert.ok(atividade.some((e) => e.type === "linear_unlinked"));
});

test("sem LINEAR_API_KEY o espelho fica dormente e nada entra na fila", async (t) => {
  const { app, repo, call, sync } = await buildApp({ linear: makeFakeLinear({ configured: false }) });
  t.after(() => { sync.stop(); return app.close(); });

  assert.equal(sync.enabled, false);
  await ligarEspelho(call);
  const ticket = (await call("lia", "POST", "/api/tickets", { saas: "alpha", subject: "Sem chave" })).json();
  assert.equal((await repo.list("linear_outbox")).length, 0);
  assert.equal((await repo.get("tickets", ticket.id)).linearIssueId, "");
  const r = await call("lia", "POST", `/api/tickets/${ticket.id}/linear`, {});
  assert.equal(r.statusCode, 424, "erro de integração sai como 4xx (http-status.js)");
  assert.equal(r.json().code, "linear_not_configured");
  const catalogo = (await call("lia", "GET", "/api/support/linear/catalog")).json();
  assert.equal(catalogo.configured, false);
});

test("erro do Linear não derruba o ticket: a linha fica na fila com backoff", async (t) => {
  const linear = makeFakeLinear();
  const { app, repo, call, sync } = await buildApp({ linear });
  t.after(() => { sync.stop(); return app.close(); });

  await ligarEspelho(call);
  linear.createIssue = async () => { throw new Error("Linear -> 500: indisponível"); };
  const ticket = (await call("lia", "POST", "/api/tickets", { saas: "alpha", subject: "Cai o Linear" })).json();
  assert.equal((await call("lia", "POST", `/api/tickets/${ticket.id}/messages`, { text: "resposta" })).statusCode, 201, "o atendimento segue mesmo com o Linear fora");

  const r = await sync.drain();
  assert.equal(r.failed, 1);
  const [row] = await repo.list("linear_outbox");
  assert.equal(row.attempts, 1);
  assert.match(row.lastError, /indisponível/);
  assert.ok(row.nextAt > new Date().toISOString(), "espera o backoff antes de tentar de novo");

  // Voltou: a mesma linha sincroniza tudo que ficou pendente.
  linear.createIssue = makeFakeLinear().createIssue;
  await repo.update("linear_outbox", row.id, { nextAt: new Date(0).toISOString() });
  await sync.drain();
  assert.equal((await repo.list("linear_outbox")).length, 0);
  assert.equal((await repo.get("tickets", ticket.id)).linear.identifier, "ENG-1");
});

test("reconciliação repõe o que o webhook não entregou", async (t) => {
  const { app, repo, call, linear, sync } = await buildApp();
  t.after(() => { sync.stop(); return app.close(); });

  await ligarEspelho(call);
  const ticket = (await call("lia", "POST", "/api/tickets", { saas: "alpha", subject: "Sem webhook" })).json();
  await sync.drain();
  const [issue] = [...linear.issues.values()];

  // Mudou no Linear e a entrega se perdeu: ninguém chamou o webhook.
  issue.stateId = "st_done";
  linear.issuesUpdatedSince = async () => [{
    id: issue.id, identifier: issue.identifier, url: issue.url, title: issue.title, priority: issue.priority,
    updatedAt: new Date().toISOString(), state: STATES.find((s) => s.id === "st_done"), project: { id: "proj_1" },
    comments: { nodes: [{ id: "cmt_perdido", body: "subiu a correção", user: { name: "Dev Duda" } }] },
  }];

  const r = await sync.reconcile();
  assert.equal(r.issues, 1);
  assert.equal(r.comments, 1);
  const alcancado = await repo.get("tickets", ticket.id);
  assert.equal(alcancado.status, "resolved");
  assert.equal(alcancado.messages.length, 0, "o comentário perdido vira aviso, não mensagem");
  const evs = (await repo.listWhere("ticket_events", { ticket: ticket.id })).filter((e) => e.type === "linear_comment");
  assert.equal(evs.length, 1);
  assert.match(evs[0].data.excerpt, /subiu a correção/);

  await sync.reconcile();
  const depois = (await repo.listWhere("ticket_events", { ticket: ticket.id })).filter((e) => e.type === "linear_comment");
  assert.equal(depois.length, 1, "reconciliar de novo não duplica o aviso");
});

test("aplicar direto (sem HTTP): issue de ticket inexistente é ignorada com segurança", async () => {
  const repo = makeMemRepo();
  assert.equal(await applyLinearIssue(repo, { id: "iss_fantasma", state: { type: "completed" } }), null);
  assert.equal(await applyLinearComment(repo, { issueId: "iss_fantasma", comment: { id: "c1", body: "oi" } }), null);
});
