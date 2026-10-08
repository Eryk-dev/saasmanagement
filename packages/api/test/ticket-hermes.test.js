// Hermes no suporte (ticket-hermes.js, hermes-actions.js, routes.hermes.js):
// o ticket é o mesmo de sempre; `ticket.hermes` é o retrato do card do Linear
// (fase pelo estado, etiqueta, quem está com ele) e as ações do guia saem como
// mudança de coluna ou comentário com o comando na primeira linha.
//
// As amostras de comentário abaixo seguem o guia (Tutorial-Hermes.pdf,
// 23/09/2026). Trocar pelos textos reais do Hermes quando chegarem.

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { makeMemRepo } from "./helpers/mem-repo.js";
import { makeFakeLinear } from "./helpers/fake-linear.js";
import { makeAuthHook, hashPassword } from "../src/auth/auth.js";
import { makeScreenGuardHook } from "../src/auth/screens.js";
import { clearStateCache, clearPeopleCache, backfillHermes } from "../src/support/ticket-linear.js";
import {
  parseHermesComment, phaseByName, stateForPhase, hermesStateOf, normalizeHermesSettings, commentFor, hermesView,
} from "../src/support/ticket-hermes.js";
import { actionAllowed } from "../src/support/hermes-actions.js";
import { startLinearSync } from "../src/support/ticket-linear-runner.js";
import { publicTicket } from "../src/support/support-page.js";

const { registerRoutes } = await import("../src/routes.js");

const WEBHOOK_SECRET = "segredo-do-linear";
// Colunas do time LEV (guia, página 3).
const STATES = [
  { id: "st_backlog", name: "Backlog", type: "backlog" },
  { id: "st_wait", name: "Aguardando resposta", type: "started" },
  { id: "st_doing", name: "In Progress", type: "started" },
  { id: "st_review", name: "In Review", type: "started" },
  { id: "st_validar", name: "Validar", type: "started" },
  { id: "st_aprovado", name: "Aprovado", type: "started" },
  { id: "st_done", name: "Done", type: "completed" },
  { id: "st_cancel", name: "Canceled", type: "canceled" },
];
const HERMES = { id: "lin_hermes", name: "Hermes" };
const PEOPLE = [
  { id: "lin_hermes", name: "Hermes", email: "hermes@acme.com", active: true },
  { id: "lin_lia", name: "Lia A.", email: "lia@acme.com", active: true },
  { id: "lin_ext", name: "Dev Externo", email: "dev@acme.com", active: true },
];
const USERS = [
  { id: "yudi", name: "Yudi", roles: ["support"], supportSaas: ["alpha"], screens: ["tickets", "support_settings"] },
  { id: "lia", name: "Lia Atendente", roles: ["support"], supportSaas: ["alpha"], screens: ["tickets", "support_settings"], email: "lia@acme.com" },
  { id: "dono", name: "Dono", roles: ["admin"], screens: [] },
];

const CARD_V = (v, prova = "Anúncio de R$ 99,90 subia a **R$ 199,80** → agora sobe a **R$ 99,90**.") => `**Validar · v${v}**

**O que acontecia:** Na cópia do Mercado Livre para a Shopee, o desconto da regra era aplicado duas vezes.
**Prova:** ${prova}
**Tela:**
![ANTES](https://uploads.linear.app/antes.png) ![DEPOIS](https://uploads.linear.app/depois.png)
**Mexe no banco?** Não.
**Risco:** Baixo: 2 arquivos, só a cópia para a Shopee.
**Quando publica:** Hoje, entre 23h e 04h.
**Aviso ao cliente:** "Oi! Corrigimos o preço dobrado nas cópias para a Shopee. Pode testar replicando um anúncio?"
**Versão:** v${v}`;

async function buildApp({ linear = makeFakeLinear({ states: STATES, people: PEOPLE }) } = {}) {
  clearStateCache();
  clearPeopleCache();
  const repo = makeMemRepo();
  for (const u of USERS) await repo.create("users", { ...u, role: "admin", passwordHash: hashPassword("1234") });
  await repo.create("products", { id: "alpha", name: "Alpha" });
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
  const sync = startLinearSync(repo, { linear, autoStart: false, log: { info() {}, warn() {} } });
  return { app, repo, call, linear, sync };
}

const postWebhook = (app, body) => {
  const payload = JSON.stringify({ webhookTimestamp: Date.now(), ...body });
  return app.inject({
    method: "POST", url: "/api/webhooks/linear", payload,
    headers: { "content-type": "application/json", "linear-signature": crypto.createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex") },
  });
};

// Espelho + Hermes ligados pelo admin: Yudi aprova, ações pelo cockpit ligadas.
async function ligar(call, hermes = {}) {
  const r = await call("dono", "PUT", "/api/support/settings/alpha", {
    linear: { enabled: true, teamId: "team_1", projectId: "proj_1", hermes: { enabled: true, linearUserId: "lin_hermes", approvers: ["yudi"], actions: true, ...hermes } },
  });
  assert.equal(r.statusCode, 200, r.body);
}

// O Hermes abre o card no projeto (etiqueta Hermes) e o webhook traz pra cá.
async function cardDoHermes(app, linear, { title = "[Loja Sul] preço dobrado na Shopee" } = {}) {
  const issue = await linear.createIssue({ title, projectId: "proj_1", labels: ["Hermes", "Bug"], stateId: "st_backlog" });
  linear.calls.create = 0;
  const r = await postWebhook(app, { type: "Issue", action: "create", data: linear.shape(issue.id) });
  return { issueId: issue.id, ticketId: r.json().ticket };
}
const mover = (app, linear, issueId, patch) => {
  Object.assign(linear.issues.get(issueId), patch);
  return postWebhook(app, { type: "Issue", action: "update", data: linear.shape(issueId) });
};
const hermesComenta = (app, linear, issueId, body) => {
  const c = linear.addComment({ issueId, body, user: HERMES });
  return postWebhook(app, { type: "Comment", action: "create", data: { ...c, issueId } });
};

test("parser: card de validação em negrito, tabela e texto simples; no ar, pergunta e rascunho", () => {
  const a = parseHermesComment(CARD_V(2));
  assert.equal(a.kind, "validation");
  assert.equal(a.version, 2);
  assert.equal(a.risk, "baixo");
  assert.equal(a.touchesDb, false);
  assert.match(a.fields.problema, /aplicado duas vezes/);
  assert.match(a.fields.aviso, /Corrigimos o preço dobrado/);
  assert.deepEqual(a.images, ["https://uploads.linear.app/antes.png", "https://uploads.linear.app/depois.png"]);

  const b = parseHermesComment("| Campo | Valor |\n| --- | --- |\n| O que acontecia | desconto duplo |\n| Prova | 99,90 → 199,80 |\n| Mexe no banco? | Sim: coluna nova |\n| Risco | Alto |\n| Versão | v3 |");
  assert.equal(b.kind, "validation");
  assert.equal(b.version, 3);
  assert.equal(b.risk, "alto");
  assert.equal(b.touchesDb, true);

  const c = parseHermesComment("O que acontecia: x\nProva: y\nRisco: Médio\nVersão: v1");
  assert.equal(c.kind, "validation");
  assert.equal(c.risk, "medio");

  assert.deepEqual(parseHermesComment("No ar às 23:07 ✅"), { kind: "live", liveAt: "23:07" });
  assert.equal(parseHermesComment("Qual empresa é esse grupo?").kind, "question");
  assert.equal(parseHermesComment("Rascunho de resposta ao cliente:\n\"Oi! Isso é regra do ML.\"").draftReply, "Oi! Isso é regra do ML.");
  assert.equal(parseHermesComment("Reproduzi o erro, corrigindo.").kind, "note", "formato desconhecido não quebra");
  assert.equal(parseHermesComment("Prova: só isso").kind, "note", "um rótulo solto não é card");
});

test("fase pelo nome da coluna, de-para manual e retrato de quem está com o card", () => {
  const fases = Object.fromEntries(STATES.map((s) => [s.name, phaseByName(s)]));
  assert.deepEqual(fases, {
    Backlog: "relato", "Aguardando resposta": "pergunta", "In Progress": "trabalhando", "In Review": "revisao",
    Validar: "validar", Aprovado: "aprovado", Done: "no_ar", Canceled: "cancelado",
  });
  const cfg = normalizeHermesSettings({ enabled: true, phases: { st_review: "validar", lixo: "inventada" }, approvers: ["a", "a", ""], publishWindow: "x" });
  assert.deepEqual(cfg.phases, { st_review: "validar" }, "fase desconhecida cai fora");
  assert.deepEqual(cfg.approvers, ["a"]);
  assert.equal(cfg.publishWindow, "noite");
  assert.equal(cfg.label, "Hermes");
  assert.equal(stateForPhase("validar", STATES, cfg).id, "st_review", "o mapa manual manda");
  assert.equal(stateForPhase("aprovado", STATES, cfg).id, "st_aprovado");

  const base = { state: STATES[4], labels: ["Hermes"], assignee: null };
  assert.deepEqual(hermesStateOf(base, cfg), { labeled: true, active: true, holding: true, phase: "validar", needsHuman: true, handedTo: "" });
  const time = hermesStateOf({ ...base, assignee: { id: "lin_ext", name: "Dev Externo" } }, cfg);
  assert.equal(time.active, false, "card com alguém do time sai do Hermes");
  assert.equal(time.handedTo, "Dev Externo");
  assert.equal(hermesStateOf({ ...base, assignee: { id: "x", name: "Hermes" } }, cfg).active, true, "o próprio Hermes atribuído não é o time");
  assert.equal(hermesStateOf({ ...base, labels: undefined }, cfg, { labeled: true }).labeled, true, "payload sem etiquetas mantém o que se sabia");
  assert.equal(hermesStateOf({ ...base, state: STATES[6] }, cfg).holding, false, "no ar não é mais 'com o Hermes' na fila");

  assert.equal(actionAllowed("aprovar", { active: true, phase: "validar" }, cfg), true);
  assert.equal(actionAllowed("desistir", { active: true, phase: "aprovado" }, { publishWindow: "imediato" }), false, "LeverPrice: aprovar já publica");
  assert.equal(actionAllowed("reverter", { active: true, phase: "aprovado" }, { publishWindow: "imediato" }), true);
  assert.equal(actionAllowed("entregar", { active: true }, cfg), false);
  assert.match(commentFor("ajuste", { text: "botão maior", name: "Yudi" }), /^ajuste: botão maior\n\n— Yudi, via Cockpit$/);
});

test("acompanhar: card do Hermes vira ticket comum com a fase, o card de validação lido ao vivo e aviso só aos aprovadores", async (t) => {
  const { app, repo, call, linear, sync } = await buildApp();
  t.after(() => { sync.stop(); return app.close(); });
  await ligar(call);

  const { issueId, ticketId } = await cardDoHermes(app, linear);
  let ticket = await repo.get("tickets", ticketId);
  assert.equal(ticket.status, "new", "ticket normal, com os status de sempre");
  assert.equal(ticket.hermes.labeled, true);
  assert.equal(ticket.hermes.phase, "relato");
  assert.equal(ticket.hermes.holding, true);
  assert.equal(ticket.hermes.needsHuman, false);

  await mover(app, linear, issueId, { stateId: "st_doing" });
  await mover(app, linear, issueId, { stateId: "st_validar" });
  await hermesComenta(app, linear, issueId, CARD_V(2));
  ticket = await repo.get("tickets", ticketId);
  assert.equal(ticket.hermes.phase, "validar");
  assert.equal(ticket.hermes.needsHuman, true);
  assert.equal(ticket.hermes.version, 2);
  assert.deepEqual(ticket.hermes.history.map((h) => h.phase), ["relato", "trabalhando", "validar"]);
  assert.equal(ticket.status, "open", "In Progress tira do Novo, como qualquer card");

  const avisos = await repo.list("notifications");
  const hermes = avisos.filter((n) => n.type === "ticket_hermes");
  assert.deepEqual(hermes.map((n) => n.user), ["yudi"], "o sino chama só quem aprova");
  assert.match(hermes[0].text, /pronta para validar/);

  const eventos = (await repo.listWhere("ticket_events", { ticket: ticketId })).map((e) => e.type);
  assert.ok(eventos.includes("hermes_phase"));
  assert.ok(eventos.includes("hermes_validation"));

  // Aba Linear: o card vem do comentário lido agora, o doc não guarda o texto.
  const aba = (await call("yudi", "GET", `/api/tickets/${ticketId}/linear`)).json();
  assert.deepEqual(aba.labels, ["Hermes", "Bug"]);
  assert.equal(aba.hermes.card.version, 2);
  assert.match(aba.hermes.card.fields.prova, /199,80/);
  assert.ok(!JSON.stringify(ticket).includes("199,80"), "texto do Hermes não entra no ticket");
  assert.ok(!JSON.stringify(publicTicket(ticket)).toLowerCase().includes("hermes"), "nada do Hermes sai pelo portal");

  // Permissões pra tela: Yudi aprova, Lia só acompanha.
  const yudi = (await call("yudi", "GET", `/api/tickets/${ticketId}/hermes`)).json();
  assert.equal(yudi.approver, true);
  assert.equal(yudi.allowed.aprovar, true);
  assert.equal(yudi.allowed.entregar, false);
  const lia = (await call("lia", "GET", `/api/tickets/${ticketId}/hermes`)).json();
  assert.equal(lia.approver, false);
  assert.equal(lia.allowed.aprovar, false);
});

test("agir: aprovar presa à versão lida, ajuste com o comando na 1ª linha, desistir e só aprovador age", async (t) => {
  const { app, repo, call, linear, sync } = await buildApp();
  t.after(() => { sync.stop(); return app.close(); });
  await ligar(call);
  const { issueId, ticketId } = await cardDoHermes(app, linear);
  await mover(app, linear, issueId, { stateId: "st_validar" });
  await hermesComenta(app, linear, issueId, CARD_V(2));
  const url = `/api/tickets/${ticketId}/hermes`;

  assert.equal((await call("lia", "POST", url, { action: "aprovar", version: 2 })).statusCode, 403, "atendente que não aprova não aprova");
  assert.equal((await call("yudi", "POST", url, { action: "ajuste" })).json().code, "text_required");
  const velha = await call("yudi", "POST", url, { action: "aprovar", version: 1 });
  assert.equal(velha.statusCode, 409);
  assert.equal(velha.json().code, "version_changed", "a aprovação vale para a versão lida");
  assert.equal(linear.issues.get(issueId).stateId, "st_validar");

  const ok = await call("yudi", "POST", url, { action: "aprovar", version: 2 });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(linear.issues.get(issueId).stateId, "st_aprovado");
  const aprovado = linear.comments.at(-1);
  assert.match(aprovado.body, /^Aprovado v2 por Yudi\.\n\n— Yudi, via Cockpit$/);
  let ticket = await repo.get("tickets", ticketId);
  assert.equal(ticket.hermes.phase, "aprovado", "o retrato anda sem esperar o webhook");
  assert.equal(ticket.hermes.approvedBy, "yudi");
  assert.equal(ticket.hermes.approvedVersion, 2);
  assert.ok(ticket.linear.posted.includes(aprovado.id));

  // O eco do próprio comentário não vira aviso de comentário no Linear.
  await postWebhook(app, { type: "Comment", action: "create", data: { ...aprovado, issueId, user: { id: "u1", name: "Bot do Cockpit" } } });
  assert.equal((await repo.list("notifications")).filter((n) => n.type === "ticket_linear_comment").length, 0);

  assert.equal((await call("yudi", "POST", url, { action: "ajuste", text: "x" })).json().code, "wrong_phase", "ajuste só em Validar");

  // LeverAds: antes da janela da noite dá pra desistir (volta pra Validar).
  assert.equal((await call("yudi", "POST", url, { action: "desistir" })).statusCode, 200);
  assert.equal(linear.issues.get(issueId).stateId, "st_validar");

  const aj = await call("yudi", "POST", url, { action: "ajuste", text: "botão maior, igual ao Salvar" });
  assert.equal(aj.statusCode, 200, aj.body);
  assert.match(linear.comments.at(-1).body, /^ajuste: botão maior, igual ao Salvar\n/);
  ticket = await repo.get("tickets", ticketId);
  assert.equal(ticket.hermes.lastAction.action, "ajuste");
  const acoes = (await repo.listWhere("ticket_events", { ticket: ticketId })).filter((e) => e.type === "hermes_action").map((e) => e.data.action);
  assert.deepEqual(acoes, ["aprovar", "desistir", "ajuste"]);
});

test("ida e volta: atribuir passa pro time; entregar ao Hermes pede, o Hermes aceita pela etiqueta", async (t) => {
  const { app, repo, call, linear, sync } = await buildApp();
  t.after(() => { sync.stop(); return app.close(); });
  await ligar(call);
  const { issueId, ticketId } = await cardDoHermes(app, linear);
  await mover(app, linear, issueId, { stateId: "st_doing" });

  // Hermes → time: alguém do time pega o card (aqui, no Linear).
  await mover(app, linear, issueId, { assigneeId: "lin_ext" });
  let ticket = await repo.get("tickets", ticketId);
  assert.equal(ticket.hermes.active, false);
  assert.equal(ticket.hermes.holding, false);
  assert.equal(ticket.hermes.handoff.to, "Dev Externo");
  assert.ok((await repo.listWhere("ticket_events", { ticket: ticketId })).some((e) => e.type === "hermes_handoff"));
  assert.equal((await call("yudi", "GET", `/api/tickets/${ticketId}/hermes`)).json().allowed.perguntar, false, "com o time, as ações do Hermes somem");

  // Time → Hermes: um ticket comum (criado aqui, sem etiqueta) é entregue.
  const novo = (await call("lia", "POST", "/api/tickets", { saas: "alpha", subject: "Cópia some a variação", assignee: "lia" })).json();
  await sync.drain();
  ticket = await repo.get("tickets", novo.id);
  assert.equal(ticket.hermes, undefined, "ticket comum não ganha retrato");
  const novaIssue = ticket.linear.issueId;
  assert.equal(linear.issues.get(novaIssue).assigneeId, "lin_lia", "o espelho atribuiu a Lia");

  const ent = await call("lia", "POST", `/api/tickets/${novo.id}/hermes`, { action: "entregar", text: "cliente manda print no grupo" });
  assert.equal(ent.statusCode, 200, ent.body);
  assert.equal(linear.issues.get(novaIssue).assigneeId, null, "card sem ninguém, senão o Hermes não assume");
  assert.match(linear.comments.at(-1).body, /^hermes: assumir\n\ncliente manda print no grupo\n\n— Lia Atendente, via Cockpit$/);
  ticket = await repo.get("tickets", novo.id);
  assert.equal(ticket.hermes.requested.by, "lia");
  assert.equal(ticket.hermes.active, false, "até o Hermes aceitar, só o pedido");
  assert.equal((await call("lia", "POST", `/api/tickets/${novo.id}/hermes`, { action: "entregar" })).json().code, "wrong_phase", "pedido em aberto não repete");

  // O Hermes aceita: põe a etiqueta.
  await mover(app, linear, novaIssue, { labels: ["Hermes"], stateId: "st_doing" });
  ticket = await repo.get("tickets", novo.id);
  assert.equal(ticket.hermes.active, true);
  assert.equal(ticket.hermes.requested, null);
  assert.equal(ticket.hermes.phase, "trabalhando");
  assert.ok((await repo.listWhere("ticket_events", { ticket: novo.id })).some((e) => e.type === "hermes_accepted"));
});

test("travas: ações desligadas, aprovadores só pelo admin e acompanhamento desligado não grava nada", async (t) => {
  const { app, repo, call, linear, sync } = await buildApp();
  t.after(() => { sync.stop(); return app.close(); });
  await ligar(call, { actions: false });

  const tentou = await call("lia", "PUT", "/api/support/settings/alpha", { linear: { hermes: { approvers: ["lia", "yudi"] } } });
  assert.equal(tentou.statusCode, 403);
  assert.equal(tentou.json().code, "hermes_approvers_admin");
  const mesmo = await call("lia", "PUT", "/api/support/settings/alpha", { linear: { hermes: { approvers: ["yudi"], publishWindow: "imediato" } } });
  assert.equal(mesmo.statusCode, 200, "reenviar a mesma lista com outra mudança passa");
  assert.equal(mesmo.json().linear.hermes.publishWindow, "imediato");

  const { issueId, ticketId } = await cardDoHermes(app, linear);
  await mover(app, linear, issueId, { stateId: "st_validar" });
  const r = await call("yudi", "POST", `/api/tickets/${ticketId}/hermes`, { action: "aprovar" });
  assert.equal(r.json().code, "hermes_actions_off");
  assert.equal(linear.issues.get(issueId).stateId, "st_validar");

  // Hermes desligado no produto: card com etiqueta segue ticket sem retrato.
  await call("dono", "PUT", "/api/support/settings/alpha", { linear: { hermes: { enabled: false } } });
  const outro = await cardDoHermes(app, linear, { title: "[Loja Sul] outro" });
  assert.equal((await repo.get("tickets", outro.ticketId)).hermes, undefined);
  const view = hermesView({}, [], normalizeHermesSettings({}));
  assert.equal(view.card, null);
});

test("revisão: colunas ambíguas, eco assinado, comentário solto, aprovadores e hora do 'no ar' por ciclo", async (t) => {
  assert.equal(phaseByName({ name: "Aguardando deploy", type: "started" }), "trabalhando", "aguardar deploy não chama aprovador");
  assert.equal(phaseByName({ name: "Waiting for release", type: "completed" }), "no_ar", "tipo concluído manda");
  assert.equal(phaseByName({ name: "Aguardando resposta", type: "unstarted" }), "pergunta");

  const { app, repo, call, linear, sync } = await buildApp();
  t.after(() => { sync.stop(); return app.close(); });
  await ligar(call);

  // Aprovadores: mandar null (ou qualquer coisa) sem ser admin também é barrado.
  for (const approvers of [null, "yudi", { a: 1 }]) {
    const r = await call("lia", "PUT", "/api/support/settings/alpha", { linear: { hermes: { approvers } } });
    assert.equal(r.statusCode, 403, `approvers=${JSON.stringify(approvers)}`);
  }

  // Card comum: comentário com cara de Hermes não cria retrato.
  const comum = await linear.createIssue({ title: "[Loja Sul] dúvida", projectId: "proj_1", labels: [], stateId: "st_backlog" });
  const imp = (await postWebhook(app, { type: "Issue", action: "create", data: linear.shape(comum.id) })).json().ticket;
  await hermesComenta(app, linear, comum.id, "Qual é a loja?");
  assert.equal((await repo.get("tickets", imp)).hermes, undefined);

  // Eco do comentário assinado pelo cockpit chegando antes do `posted`.
  const { issueId, ticketId } = await cardDoHermes(app, linear);
  const eco = linear.addComment({ issueId, body: "ajuste: botão maior\n\n— Yudi, via Cockpit", user: { id: "u1", name: "Bot do Cockpit" } });
  await postWebhook(app, { type: "Comment", action: "create", data: { ...eco, issueId } });
  assert.equal((await repo.listWhere("ticket_events", { ticket: ticketId })).filter((e) => e.type === "linear_comment").length, 0);

  // No ar → revertido → no ar de novo: a hora é a do ciclo novo.
  await mover(app, linear, issueId, { stateId: "st_done" });
  await hermesComenta(app, linear, issueId, "No ar às 22:10");
  assert.equal((await repo.get("tickets", ticketId)).hermes.liveAt, "22:10");
  await mover(app, linear, issueId, { stateId: "st_validar" });
  assert.equal((await repo.get("tickets", ticketId)).hermes.liveAt, "", "voltar pra Validar zera a hora");
  await mover(app, linear, issueId, { stateId: "st_done" });
  await hermesComenta(app, linear, issueId, "No ar às 23:40");
  assert.equal((await repo.get("tickets", ticketId)).hermes.liveAt, "23:40");
  const aba = (await call("yudi", "GET", `/api/tickets/${ticketId}/linear`)).json();
  assert.equal(aba.hermes.liveAt, "23:40", "a aba mostra o 'no ar' mais recente");
});

test("aprovar sem dizer a versão lida não passa quando o card tem versão", async (t) => {
  const { app, call, linear, sync } = await buildApp();
  t.after(() => { sync.stop(); return app.close(); });
  await ligar(call);
  const { issueId, ticketId } = await cardDoHermes(app, linear);
  await mover(app, linear, issueId, { stateId: "st_validar" });
  await hermesComenta(app, linear, issueId, CARD_V(3));
  const r = await call("yudi", "POST", `/api/tickets/${ticketId}/hermes`, { action: "aprovar" });
  assert.equal(r.json().code, "version_changed");
  assert.equal(linear.issues.get(issueId).stateId, "st_validar");
});

test("ligar o Hermes relê os cards que já estavam com ele (sem esperar o card mudar)", async (t) => {
  const { app, repo, call, linear, sync } = await buildApp();
  t.after(() => { sync.stop(); return app.close(); });
  // Espelho ligado, Hermes ainda não: o card entra como ticket comum.
  await call("dono", "PUT", "/api/support/settings/alpha", { linear: { enabled: true, teamId: "team_1", projectId: "proj_1" } });
  const { issueId, ticketId } = await cardDoHermes(app, linear);
  Object.assign(linear.issues.get(issueId), { stateId: "st_validar" });
  linear.addComment({ issueId, body: CARD_V(1), user: HERMES });
  linear.addComment({ issueId, body: CARD_V(2), user: HERMES });
  const comum = await linear.createIssue({ title: "[Loja X] outro", projectId: "proj_1", labels: [], stateId: "st_doing" });
  const comumTicket = (await postWebhook(app, { type: "Issue", action: "create", data: linear.shape(comum.id) })).json().ticket;
  assert.equal((await repo.get("tickets", ticketId)).hermes, undefined);

  await ligar(call);
  const r = await backfillHermes(repo, "alpha", { linear });
  assert.equal(r.hermes, 1);
  const ticket = await repo.get("tickets", ticketId);
  assert.equal(ticket.hermes.phase, "validar");
  assert.equal(ticket.hermes.needsHuman, true);
  assert.equal(ticket.hermes.version, 2, "vale o último card de validação");
  const validacoes = (await repo.listWhere("ticket_events", { ticket: ticketId })).filter((e) => e.type === "hermes_validation");
  assert.equal(validacoes.length, 1, "o histórico antigo não vira uma enxurrada de eventos");
  assert.equal((await repo.get("tickets", comumTicket)).hermes, undefined, "card sem etiqueta continua comum");
  assert.ok((await repo.list("notifications")).some((n) => n.type === "ticket_hermes" && n.user === "yudi"), "o aprovador é avisado do que espera por ele");
  assert.deepEqual(await backfillHermes(repo, "alpha", { linear: { configured: () => false } }), { skipped: "not_configured" });
});
